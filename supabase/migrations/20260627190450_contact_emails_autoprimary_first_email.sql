-- Prevent the "email but no primary" drift from recurring. When an email is inserted for a
-- contact that has no primary email yet, mark the new one primary. Keeps the canonical
-- "with email" count (any non-empty email) and the is_primary-based breakdown count in
-- agreement automatically, so every email-bearing contact stays counted everywhere.
CREATE OR REPLACE FUNCTION public.trg_contact_emails_autoprimary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' AND COALESCE(NEW.is_primary, false) = false THEN
    IF NOT EXISTS (
      SELECT 1 FROM contact_emails em
      WHERE em.contact_id = NEW.contact_id
        AND em.is_primary
        AND em.email IS NOT NULL AND em.email <> ''
    ) THEN
      NEW.is_primary := true;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_emails_autoprimary ON public.contact_emails;
CREATE TRIGGER trg_contact_emails_autoprimary
BEFORE INSERT ON public.contact_emails
FOR EACH ROW EXECUTE FUNCTION public.trg_contact_emails_autoprimary();
