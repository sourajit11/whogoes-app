#!/usr/bin/env python3
"""Import an Apollo accounts export into the companies table with source='apollo'.

Decisions (2026-07-04):
  - Skip existing: only insert companies whose normalized LinkedIn URL is not
    already in the table. Existing rows are left completely untouched.
  - Mark imported rows is_enriched=true (Apollo already gives description /
    website / industry / employees), so the LinkedIn enrichment pipeline skips
    them.
  - normalized_linkedin_url is a generated column, so we do NOT send it; the DB
    computes it on insert.
  - normalized_name is NOT generated (it is set by the app on the normal insert
    path, which this raw REST insert bypasses). After running with --commit,
    backfill it in Studio:
        UPDATE companies
        SET normalized_name = lower(trim(regexp_replace(name, '\\s+', ' ', 'g')))
        WHERE source = 'apollo' AND normalized_name IS NULL;

Usage:
  python3 import_apollo_companies.py "/path/to/apollo-accounts-export (1).csv"            # dry run
  python3 import_apollo_companies.py "/path/to/apollo-accounts-export (1).csv" --commit
"""
import csv
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

REF = "citrznhubxqvsfhjkssg"
BASE = f"https://{REF}.supabase.co/rest/v1"


def load_key():
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if key:
        return key
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(env_path) as fh:
        for line in fh:
            if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("SUPABASE_SERVICE_ROLE_KEY not found")


KEY = load_key()
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def normalize_linkedin(url):
    """Mirror public.normalize_linkedin_company_url()."""
    if not url:
        return None
    u = url.strip()
    u = re.sub(r"/+$", "", u)
    u = re.sub(r"/(posts|about|jobs|people|life|videos|events)/?$", "", u)
    u = re.sub(r"\?.*$", "", u)
    u = re.sub(r"^https?://(www\.)?", "https://www.", u)
    return u


def fetch_existing_urls():
    seen = set()
    page = 1000
    start = 0
    while True:
        req = urllib.request.Request(
            f"{BASE}/companies?select=normalized_linkedin_url&normalized_linkedin_url=not.is.null",
            headers={**HEADERS, "Range": f"{start}-{start + page - 1}"},
        )
        with urllib.request.urlopen(req) as resp:
            rows = json.load(resp)
        for r in rows:
            v = r.get("normalized_linkedin_url")
            if v:
                seen.add(v.lower())
        if len(rows) < page:
            break
        start += page
    return seen


def map_row(row):
    city = (row.get("Company City") or "").strip()
    state = (row.get("Company State") or "").strip()
    hq = ", ".join([p for p in (city, state) if p]) or None
    emp_raw = (row.get("# Employees") or "").strip()
    emp = int(emp_raw) if emp_raw.isdigit() else None
    year_raw = (row.get("Founded Year") or "").strip()
    year = int(year_raw) if re.fullmatch(r"\d{4}", year_raw or "") else None
    return {
        "name": (row.get("Company Name") or "").strip() or None,
        "linkedin_url": (row.get("Company Linkedin Url") or "").strip() or None,
        "website": (row.get("Website") or "").strip() or None,
        "industry": (row.get("Industry") or "").strip() or None,
        "employee_count": emp,
        "headquarters_city": city or None,
        "headquarters_country": (row.get("Company Country") or "").strip() or None,
        "headquarters": hq,
        "description": (row.get("Short Description") or "").strip() or None,
        "founded_year": year,
        "source": "apollo",
        "is_enriched": True,
        "enriched_at": datetime.now(timezone.utc).isoformat(),
    }


def insert_batch(rows):
    data = json.dumps(rows).encode()
    req = urllib.request.Request(
        f"{BASE}/companies", data=data,
        headers={**HEADERS, "Prefer": "return=minimal"}, method="POST",
    )
    urllib.request.urlopen(req)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("pass the CSV path as the first argument")
    csv_path = sys.argv[1]
    commit = "--commit" in sys.argv

    with open(csv_path, newline="", encoding="utf-8") as fh:
        records = list(csv.DictReader(fh))
    print(f"CSV rows: {len(records)}")

    print("Fetching existing normalized LinkedIn URLs from DB...")
    existing = fetch_existing_urls()
    print(f"Existing companies with a LinkedIn URL: {len(existing)}")

    to_insert = []
    skipped_existing = 0
    skipped_no_url = 0
    seen_in_batch = set()
    for row in records:
        url = (row.get("Company Linkedin Url") or "").strip()
        key = normalize_linkedin(url)
        key = key.lower() if key else None
        if not key:
            skipped_no_url += 1
            continue
        if key in existing or key in seen_in_batch:
            skipped_existing += 1
            continue
        seen_in_batch.add(key)
        to_insert.append(map_row(row))

    print("--- Plan ---")
    print(f"Net-new to insert : {len(to_insert)}")
    print(f"Skipped (existing): {skipped_existing}")
    print(f"Skipped (no URL)  : {skipped_no_url}")

    if not commit:
        print("\nDRY RUN. Re-run with --commit to insert.")
        if to_insert:
            print("Sample row:", json.dumps(to_insert[0], indent=2))
        return

    print("\nInserting...")
    chunk = 500
    for i in range(0, len(to_insert), chunk):
        insert_batch(to_insert[i : i + chunk])
        print(f"  inserted {min(i + chunk, len(to_insert))} / {len(to_insert)}")
    print("Done.")


if __name__ == "__main__":
    main()
