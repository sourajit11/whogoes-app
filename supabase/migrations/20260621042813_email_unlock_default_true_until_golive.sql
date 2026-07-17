-- Transition safety: the 2-tier email pricing is not live until the My Events "Reveal email" UI
-- ships. Until then, new unlocks must keep granting the email (so the current production UI shows
-- it, no regression). Default email_unlocked = true for now. GO-LIVE STEP (deploy WITH the reveal
-- UI): a follow-up migration flips this default back to false so unlock becomes identity-only.
alter table customer_contact_access alter column email_unlocked set default true;
