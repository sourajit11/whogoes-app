-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Sets an org aside when MoltSets genuinely has no record of it (all searches 404 not_found),
-- so spd_list_targets_needing_contacts (which filters contacts_status IS NULL) stops returning it.
create or replace function public.spd_mark_org_no_coverage(p_organizer_id uuid)
returns json
language plpgsql
security definer
set search_path to 'shootday_partners_discovery','public','pg_temp'
as $function$
begin
  if p_organizer_id is not null then
    update shootday_partners_discovery.organizers
       set contacts_status     = 'no_coverage',
           contacts_fetched_at = now(),
           updated_at          = now()
     where id = p_organizer_id
       and contacts_status is null;   -- never overwrite a real 'processed'
  end if;
  return json_build_object('organizer_id', p_organizer_id, 'contacts_status', 'no_coverage');
end;
$function$;

grant execute on function public.spd_mark_org_no_coverage(uuid) to service_role;
