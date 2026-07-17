-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Real-time event-role resolution via a dirty-event queue (no cron yet).

CREATE TABLE IF NOT EXISTS public.event_role_queue (
  event_id    uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  reason      text
);
ALTER TABLE public.event_role_queue ENABLE ROW LEVEL SECURITY;

-- posts INSERT
CREATE OR REPLACE FUNCTION public.trg_enqueue_event_roles_posts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.event_role_queue (event_id, reason)
  SELECT DISTINCT event_id, 'post' FROM new_rows WHERE event_id IS NOT NULL
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NULL;
END; $$;

-- posts UPDATE (filter role-relevant columns inside; transition tables forbid UPDATE OF list)
CREATE OR REPLACE FUNCTION public.trg_enqueue_event_roles_posts_upd()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.event_role_queue (event_id, reason)
  SELECT DISTINCT n.event_id, 'post'
  FROM new_rows n JOIN old_rows o ON o.id = n.id
  WHERE n.event_id IS NOT NULL
    AND ( n.extracted_event_role IS DISTINCT FROM o.extracted_event_role
       OR n.role_confidence      IS DISTINCT FROM o.role_confidence
       OR n.role_is_speaker      IS DISTINCT FROM o.role_is_speaker
       OR n.post_type            IS DISTINCT FROM o.post_type
       OR n.company_id           IS DISTINCT FROM o.company_id
       OR n.contact_id           IS DISTINCT FROM o.contact_id )
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS enqueue_event_roles_posts_ins ON public.posts;
CREATE TRIGGER enqueue_event_roles_posts_ins
  AFTER INSERT ON public.posts
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_enqueue_event_roles_posts();

DROP TRIGGER IF EXISTS enqueue_event_roles_posts_upd ON public.posts;
CREATE TRIGGER enqueue_event_roles_posts_upd
  AFTER UPDATE ON public.posts
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_enqueue_event_roles_posts_upd();

-- contact_events INSERT
CREATE OR REPLACE FUNCTION public.trg_enqueue_event_roles_ce()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.event_role_queue (event_id, reason)
  SELECT DISTINCT event_id, 'contact_event' FROM new_rows WHERE event_id IS NOT NULL
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS enqueue_event_roles_ce_ins ON public.contact_events;
CREATE TRIGGER enqueue_event_roles_ce_ins
  AFTER INSERT ON public.contact_events
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_enqueue_event_roles_ce();

-- contacts UPDATE (company change)
CREATE OR REPLACE FUNCTION public.trg_enqueue_event_roles_contacts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.event_role_queue (event_id, reason)
  SELECT DISTINCT ce.event_id, 'contact_company'
  FROM new_rows n
  JOIN old_rows o ON o.id = n.id
  JOIN public.contact_events ce ON ce.contact_id = n.id
  WHERE n.current_company_id IS DISTINCT FROM o.current_company_id
    AND ce.event_id IS NOT NULL
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS enqueue_event_roles_contacts_upd ON public.contacts;
CREATE TRIGGER enqueue_event_roles_contacts_upd
  AFTER UPDATE ON public.contacts
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_enqueue_event_roles_contacts();

-- events UPDATE (organizer change)
CREATE OR REPLACE FUNCTION public.trg_enqueue_event_roles_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.event_role_queue (event_id, reason)
  SELECT n.id, 'organizer_change'
  FROM new_rows n JOIN old_rows o ON o.id = n.id
  WHERE n.organizer_company_id IS DISTINCT FROM o.organizer_company_id
  ON CONFLICT (event_id) DO NOTHING;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS enqueue_event_roles_events_upd ON public.events;
CREATE TRIGGER enqueue_event_roles_events_upd
  AFTER UPDATE ON public.events
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_enqueue_event_roles_events();

-- Drain function
CREATE OR REPLACE FUNCTION public.resolve_dirty_events(p_max integer DEFAULT 50)
RETURNS TABLE(events_processed integer, companies_written integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '300s'
AS $$
DECLARE
  v_event uuid; v_events int := 0; v_rows int := 0; v_cnt int;
BEGIN
  FOR v_event IN
    SELECT event_id FROM public.event_role_queue
    ORDER BY enqueued_at LIMIT p_max FOR UPDATE SKIP LOCKED
  LOOP
    SELECT count(*) INTO v_cnt FROM public.resolve_company_event_roles(v_event, true);
    PERFORM public.refresh_event_contact_facts(v_event);
    DELETE FROM public.event_role_queue WHERE event_id = v_event;
    v_events := v_events + 1;
    v_rows := v_rows + coalesce(v_cnt, 0);
  END LOOP;
  RETURN QUERY SELECT v_events, v_rows;
END; $$;

GRANT EXECUTE ON FUNCTION public.resolve_dirty_events(integer) TO service_role;

DROP FUNCTION IF EXISTS public.tag_contact_event_role(uuid, uuid, uuid, text, text, text, boolean);
