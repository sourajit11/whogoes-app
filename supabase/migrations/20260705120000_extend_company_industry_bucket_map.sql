-- Teach the deterministic company-industry translator the Apollo/Moltsets-style
-- taxonomy strings it was never seeded with. These raw values were arriving from
-- newer enrichment sources (Title Case combined names) and falling through the
-- lookup in bucket_company_industry() to 'Other / Unknown', even though they map
-- cleanly to existing buckets.
--
-- Without this, the BEFORE-write trigger (trg_companies_set_buckets, see
-- 20260621033836_company_bucket_trigger.sql) keeps stamping these companies
-- 'Other / Unknown' on every enrich, and any manual backfill of them gets reset
-- the next time their `industry` field is rewritten.
--
-- Idempotent: on conflict updates the bucket, so re-running is safe.

insert into public.company_industry_bucket_map (raw_industry, bucket) values
  ('Information Technology', 'Software & IT Services'),
  ('IT System Operations and Maintenance', 'Software & IT Services'),
  ('Professional and Business Services', 'Management Consulting & Business Services'),
  ('Corporate Services', 'Management Consulting & Business Services'),
  ('Equipment Rental Services', 'Management Consulting & Business Services'),
  ('Repair and Maintenance', 'Management Consulting & Business Services'),
  ('Creative Arts and Entertainment', 'Media & Entertainment'),
  ('Media and Publishing', 'Media & Entertainment'),
  ('Non-Profit and Social Services', 'Nonprofit, NGO & Associations'),
  ('nonprofit organization management', 'Nonprofit, NGO & Associations'),
  ('fund-raising', 'Nonprofit, NGO & Associations'),
  ('medical devices', 'Medical Devices'),
  ('Finance and Banking', 'Financial Services & Banking'),
  ('Health and Pharmaceuticals', 'Healthcare & Hospitals'),
  ('Pharmaceuticals and Biotechnology', 'Pharmaceuticals'),
  ('Tourism and Hospitality', 'Hospitality, Travel & Leisure'),
  ('Hotels and Motels', 'Hospitality, Travel & Leisure'),
  ('electrical/electronic manufacturing', 'Electrical & Electronics Manufacturing'),
  ('Government and Public Administration', 'Government & Public Sector'),
  ('Government', 'Government & Public Sector'),
  ('Transportation and Logistics', 'Transportation & Logistics'),
  ('Food and Beverage', 'Food & Beverage'),
  ('Wholesale Food and Beverage', 'Food & Beverage'),
  ('Energy', 'Oil, Gas & Utilities'),
  ('Chemical Raw Materials Manufacturing', 'Chemicals & Plastics'),
  ('Plastics and Rubber Product Manufacturing', 'Chemicals & Plastics'),
  ('Paint, Coating, and Adhesive Manufacturing', 'Chemicals & Plastics'),
  ('Metalworking Machinery Manufacturing', 'Industrial Machinery & Automation'),
  ('Glass Product Manufacturing', 'Manufacturing - Other'),
  ('Transportation Equipment Manufacturing', 'Manufacturing - Other'),
  ('Wholesale Metals and Minerals', 'Mining & Metals'),
  ('Retail Recyclable Materials & Used Merchandise', 'Retail & Wholesale'),
  ('Soap and Cleaning Product Manufacturing', 'Consumer Goods'),
  ('Wholesale Apparel and Sewing Supplies', 'Apparel, Fashion & Luxury'),
  ('Wholesale Luxury Goods and Jewelry', 'Apparel, Fashion & Luxury'),
  ('Cosmetology and Barber Schools', 'Education'),
  ('Housing and Community Development', 'Real Estate'),
  ('Agriculture', 'Agriculture, Farming & Fishing'),
  ('Specialty Trade Contractors', 'Construction & Building Materials')
on conflict (raw_industry) do update set bucket = excluded.bucket;
