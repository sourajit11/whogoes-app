-- ============================================
-- WhoGoes Phase 1B: Event Slugs for SEO
-- Run this in Supabase SQL Editor
-- ============================================
-- This migration:
-- 1. Adds a 'slug' column to the events table
-- 2. Backfills slugs from event name (+ year if not already in name)
-- 3. Handles duplicate slugs by appending a suffix
-- 4. Adds NOT NULL + unique index constraints
-- 5. Creates get_event_by_slug() RPC for the public event detail page

-- Step 1: Add slug column (nullable initially for backfill)
ALTER TABLE events ADD COLUMN IF NOT EXISTS slug TEXT;

-- Step 2: Backfill slugs with smart year handling
-- If the event name already contains the year, use name only
-- Otherwise, append the year (e.g., "CES" + 2026 → "ces-2026")
DO $$
DECLARE
  rec RECORD;
  raw_name TEXT;
  new_slug TEXT;
  suffix INTEGER;
BEGIN
  FOR rec IN
    SELECT id, name, year, start_date
    FROM events
    WHERE slug IS NULL
    ORDER BY start_date DESC NULLS LAST
  LOOP
    -- If name contains the year, use name only; otherwise append year
    IF trim(rec.name) LIKE '%' || rec.year::text || '%' THEN
      raw_name := trim(rec.name);
    ELSE
      raw_name := trim(rec.name) || '-' || rec.year::text;
    END IF;

    new_slug := lower(
      regexp_replace(
        regexp_replace(
          regexp_replace(raw_name, '[^a-zA-Z0-9\s-]', '', 'g'),
          '\s+', '-', 'g'
        ),
        '-+', '-', 'g'
      )
    );

    -- Handle duplicate slugs by appending a suffix
    IF EXISTS (SELECT 1 FROM events WHERE slug = new_slug AND id != rec.id) THEN
      suffix := 2;
      WHILE EXISTS (SELECT 1 FROM events WHERE slug = new_slug || '-' || suffix AND id != rec.id) LOOP
        suffix := suffix + 1;
      END LOOP;
      new_slug := new_slug || '-' || suffix;
    END IF;

    UPDATE events SET slug = new_slug WHERE id = rec.id;
  END LOOP;
END $$;

-- Step 3: Add constraints
ALTER TABLE events ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug ON events (slug);

-- Step 4: Create RPC to look up an event by slug
-- Returns the same shape as BrowsableEvent + event_slug
CREATE OR REPLACE FUNCTION get_event_by_slug(p_slug TEXT)
RETURNS TABLE (
  event_id UUID,
  event_name TEXT,
  event_year INTEGER,
  event_region TEXT,
  event_location TEXT,
  event_start_date DATE,
  event_slug TEXT,
  is_active BOOLEAN,
  total_contacts BIGINT,
  contacts_with_email BIGINT,
  is_subscribed BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.year AS event_year,
    e.region AS event_region,
    e.location AS event_location,
    e.start_date AS event_start_date,
    e.slug AS event_slug,
    e.is_active,
    (SELECT COUNT(DISTINCT ce.contact_id)
     FROM contact_events ce WHERE ce.event_id = e.id
    ) AS total_contacts,
    (SELECT COUNT(DISTINCT ce.contact_id)
     FROM contact_events ce
     JOIN contact_emails em ON em.contact_id = ce.contact_id AND em.is_primary = true
     WHERE ce.event_id = e.id AND em.email IS NOT NULL AND em.email != ''
    ) AS contacts_with_email,
    COALESCE(
      (SELECT true FROM customer_event_subscriptions ces
       WHERE ces.user_id = auth.uid() AND ces.event_id = e.id),
      false
    ) AS is_subscribed
  FROM events e
  WHERE e.slug = p_slug;
END;
$$;
