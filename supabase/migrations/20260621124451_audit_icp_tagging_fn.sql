-- Read-only audit for the ICP filtering / role-tagging / 2-tier-pricing feature. Returns one json
-- with global coverage + pricing integrity + improvement signals, and (when p_event_id is given)
-- per-event role/guardrail/facet checks. Pure SELECTs, never writes. Used by /audit-icp-tagging.
create or replace function public.audit_icp_tagging(p_event_id uuid default null)
returns json
language sql
stable
security definer
set search_path = public
set statement_timeout = '120s'
as $$
  select json_build_object(
    'generated_at', now(),
    'scope', case when p_event_id is null then 'global' else 'event:'||p_event_id::text end,

    'coverage', json_build_object(
      'contacts_total', (select count(*) from contacts),
      'contacts_seniority', (select count(*) from contacts where seniority_bucket is not null),
      'contacts_function', (select count(*) from contacts where function_bucket is not null),
      'companies_total', (select count(*) from companies),
      'companies_industry_bucketed', (select count(*) from companies where industry_bucket is not null),
      'companies_size_bucketed', (select count(*) from companies where size_bucket is not null),
      'companies_with_industry_unmapped',
        (select count(*) from companies where industry is not null and btrim(industry)<>'' and industry_bucket is null),
      'events_with_organizer', (select count(*) from events where organizer_company_id is not null),
      'company_event_role_rows', (select count(*) from company_event_roles)
    ),

    'pricing', json_build_object(
      'email_unlocked_default',
        (select pg_get_expr(d.adbin, d.adrelid)
         from pg_attrdef d
         join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
         join pg_class c on c.oid=d.adrelid
         where c.relname='customer_contact_access' and a.attname='email_unlocked'),
      'cca_total', (select count(*) from customer_contact_access),
      'cca_email_unlocked', (select count(*) from customer_contact_access where email_unlocked),
      'cca_charged_but_no_valid_email',
        (select count(*) from customer_contact_access cca
         where cca.email_charged_at is not null
           and not exists (select 1 from contact_emails e where e.contact_id=cca.contact_id
                           and e.status='valid' and e.email is not null and e.email<>''))
    ),

    'improvement', json_build_object(
      'top_titles_seniority_other', (select coalesce(json_agg(json_build_object('title',t,'n',n) order by n desc),'[]'::json)
        from (select current_title t, count(*) n from contacts where seniority_bucket='Other' and current_title is not null group by 1 order by 2 desc limit 10) x),
      'top_unmapped_industries', (select coalesce(json_agg(json_build_object('industry',i,'n',n) order by n desc),'[]'::json)
        from (select industry i, count(*) n from companies where industry is not null and btrim(industry)<>'' and industry_bucket is null group by 1 order by 2 desc limit 10) x)
    ),

    'event', case when p_event_id is null then null else (
      select json_build_object(
        'name', (select name from events where id=p_event_id),
        'organizer_company_id', (select organizer_company_id from events where id=p_event_id),
        'role_distribution', (select coalesce(json_object_agg(role, n),'{}'::json)
          from (select role, count(*) n from company_event_roles where event_id=p_event_id group by 1) x),
        'guardrail_violations', (
          select count(*) from company_event_roles cer
          join posts p on p.id=cer.evidence_post_id
          left join contact_events cea on cea.post_id=p.id and (cea.contact_id=p.contact_id or p.contact_id is null)
          where cer.event_id=p_event_id and cer.role in ('sponsor','exhibitor')
            and p.extracted_event_role is null
            and coalesce(cea.source_type,'') in ('mentioned','repost')),
        'sponsor_evidence_missing_keyword', (
          select count(*) from company_event_roles cer
          join posts p on p.id=cer.evidence_post_id
          where cer.event_id=p_event_id and cer.role='sponsor'
            and p.extracted_event_role is null and p.content !~* '\msponsor'),
        'organizer_rows_not_brandmatch', (
          select count(*) from company_event_roles cer
          where cer.event_id=p_event_id and cer.role='organizer'
            and cer.company_id is distinct from (select organizer_company_id from events where id=p_event_id)),
        'companies_in_posts_without_role', (
          select count(*) from (
            select distinct coalesce(po.company_id, c.current_company_id) cid
            from posts po left join contacts c on c.id=po.contact_id
            where po.event_id=p_event_id and po.post_type is not null and po.post_type not like '%rejected%'
              and coalesce(po.company_id,c.current_company_id) is not null
          ) u where not exists (select 1 from company_event_roles cer where cer.event_id=p_event_id and cer.company_id=u.cid)),
        'facet_matched', ((get_event_filter_facets(p_event_id, '{}'::jsonb))->>'matched')::int,
        'helper_rows', (select count(*) from event_filtered_contact_ids(p_event_id, '{}'::jsonb)),
        'speakers', (select count(*) from contact_events where event_id=p_event_id and is_speaker)
      )
    ) end
  );
$$;

grant execute on function public.audit_icp_tagging(uuid) to authenticated, service_role;
