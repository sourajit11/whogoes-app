-- GO-LIVE (APPLIED 2026-06-21, with Vercel deploy f4cf083): activate the 2-tier (identity + email)
-- unlock pricing. From now on a normal unlock charges 1 credit for IDENTITY ONLY; the verified email
-- is revealed separately for +1 credit via reveal_event_emails / the My Events "Reveal" button.
-- Everything already unlocked stays grandfathered (email_unlocked=true) and is unaffected.
alter table customer_contact_access alter column email_unlocked set default false;
