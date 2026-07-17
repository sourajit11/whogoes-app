-- Second extension of the company-industry translator (see
-- 20260705120000_extend_company_industry_bucket_map.sql for the pattern).
--
-- These raw strings were still falling through bucket_company_industry() to
-- 'Other / Unknown' after the daily enrichment introduced them. Two systemic
-- sources show up here:
--   1. HTML-entity-encoded duplicates of strings already in the map, e.g.
--      'Food &amp; Beverages' vs the seeded 'Food & Beverage' — the exact-match
--      lookup treats '&amp;' and '&' as different, so the encoded form misses.
--   2. Localized (non-English) LinkedIn taxonomy strings (German, French,
--      Spanish, Filipino) that map cleanly to existing buckets.
--
-- Idempotent: on conflict updates the bucket, so re-running is safe.

insert into public.company_industry_bucket_map (raw_industry, bucket) values
  ('Information Technology &amp; Services', 'Software & IT Services'),
  ('Leisure, Travel &amp; Tourism', 'Hospitality, Travel & Leisure'),
  ('Fabrication de produits informatiques et électroniques', 'Electrical & Electronics Manufacturing'),
  ('Veranstaltungsdienste', 'Marketing, Advertising & PR'),
  ('Transport, logistique, chaîne logistique et stockage', 'Transportation & Logistics'),
  ('Commercial and Industrial Equipment Rental', 'Industrial Machinery & Automation'),
  ('Veterinary Services', 'Healthcare & Hospitals'),
  ('Satellite Telecommunications', 'Telecommunications'),
  ('Flight Training', 'Aviation & Aerospace'),
  ('Mas Mataas na Edukasyon', 'Education'),
  ('Producción y distribución audiovisual', 'Media & Entertainment'),
  ('Technologie, Information und Medien', 'Software & IT Services'),
  ('Informationsdienste', 'Publishing & Information Services'),
  ('Parts Distribution', 'Retail & Wholesale'),
  ('Air, Water, and Waste Program Management', 'Renewable Energy & Environment'),
  ('Food &amp; Beverages', 'Food & Beverage'),
  ('Business Supplies &amp; Equipment', 'Manufacturing - Other'),
  ('Fabrication de produits chimiques', 'Chemicals & Plastics'),
  ('Renewables &amp; Environment', 'Renewable Energy & Environment'),
  ('Animal Feed Manufacturing', 'Agriculture, Farming & Fishing'),
  ('Forschungsdienstleistungen', 'Research & Development'),
  ('Herstellung medizinischer Geräte', 'Medical Devices')
on conflict (raw_industry) do update set bucket = excluded.bucket;
