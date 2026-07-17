-- The qualifying agent now writes posts.role_is_speaker at qualification time. Fold a speaker
-- sync into the per-event resolver so the nightly job (and any manual resolve) also propagates
-- posts.role_is_speaker -> contact_events.is_speaker. Keeps speaker tagging current for new posts
-- with no extra workflow. Preserves the statement_timeout raised earlier.
create or replace function public.resolve_company_event_roles(p_event_id uuid, p_write boolean default false)
returns table(company_id uuid, role text, confidence text, evidence_post_id uuid, n_posts integer)
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $$
begin
  if p_write then
    delete from company_event_roles where event_id = p_event_id;
    insert into company_event_roles (event_id, company_id, role, confidence, evidence_post_id, computed_at)
    select p_event_id, x.company_id, x.role, x.confidence, x.evidence_post_id, now()
    from public._resolve_event_roles_calc(p_event_id) x;

    -- speaker sync: any qualified post flagged role_is_speaker marks its author's contact_event.
    update contact_events ce
    set is_speaker = true
    from posts p
    where p.event_id = p_event_id
      and p.role_is_speaker = true
      and p.contact_id = ce.contact_id
      and ce.event_id = p_event_id
      and ce.is_speaker is distinct from true;
  end if;
  return query select * from public._resolve_event_roles_calc(p_event_id);
end;
$$;
