// organizer-judgments-manual.mjs
// Encodes organizer calls (world knowledge) keyed by event NAME, then attaches the real eventId
// from the evidence file so no UUID is transcribed by hand. Events not in the map -> confidence "low"
// (they land in the human-review queue). Output feeds organizer-apply.mjs.
//
//   node scripts/organizer-judgments-manual.mjs --evidence=scripts/output/org-evidence-live.json \
//        --out=scripts/output/org-judgments-live.json

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const h = process.argv.find(x => x.startsWith(`--${n}=`)); return h ? h.split("=").slice(1).join("=") : d; };

// name -> { org, domain, conf, why }.  domain should be the organizer's real root domain,
// preferring the one that appears in the event's contact emails when the host is present.
const MAP = {
  // ---- Confident HOST-PRESENT (domain shows up in the event's contact emails / real share) ----
  "Middle East Energy": { org: "Informa Markets", domain: "informamarkets.com", conf: "high", why: "Informa Markets is the organizer of Middle East Energy" },
  "SEG AAPG IMAGE 2026": { org: "SEG", domain: "seg.org", conf: "high", why: "Society of Exploration Geophysicists co-hosts IMAGE" },
  "The Business Show Asia": { org: "The Business Show Asia", domain: "asiabusinessshow.com", conf: "high", why: "run by the Business Show / event's own org present" },
  "CDAO Chicago": { org: "Corinium Global Intelligence", domain: "coriniumintelligence.com", conf: "high", why: "CDAO series is run by Corinium, present at 42%" },
  "Future Proof Festival 2026": { org: "Future Proof", domain: "futureproofhq.com", conf: "high", why: "Future Proof (Advisor Circle) hosts the festival" },
  "LABScon": { org: "SentinelOne", domain: "sentinelone.com", conf: "high", why: "LABScon is organized by SentinelOne (SentinelLabs)" },
  "Autumn Fair 2026": { org: "Hyve Group", domain: "hyve.group", conf: "high", why: "Hyve Group organizes Autumn Fair, present at 49%" },
  "Glee 2026": { org: "Hyve Group", domain: "hyve.group", conf: "high", why: "Hyve Group organizes Glee, present at 54%" },
  "Unbounded 2026": { org: "UNBOUNDED", domain: "unboundedglobal.com", conf: "high", why: "event's own organizer UNBOUNDED Global present" },
  "London Packaging Week": { org: "Easyfairs", domain: "easyfairs.com", conf: "high", why: "Easyfairs organizes London Packaging Week" },
  "Texas Pharmacy Association Conference 2026": { org: "Texas Pharmacy Association", domain: "texaspharmacy.org", conf: "high", why: "TPA hosts its own conference, present 43%" },
  "CreatorFest Europe 2026": { org: "Hello Partner", domain: "hellopartner.com", conf: "high", why: "Hello Partner (Influencer Marketing) runs CreatorFest" },
  "FHCA Annual Conference 2026": { org: "Florida Health Care Association", domain: "fhca.org", conf: "high", why: "FHCA hosts its own annual conference" },
  "World Water Week": { org: "SIWI", domain: "siwi.org", conf: "high", why: "Stockholm International Water Institute organizes World Water Week" },
  "ILTACON": { org: "International Legal Technology Association (ILTA)", domain: "iltanet.org", conf: "high", why: "ILTA hosts ILTACON, present pp1" },
  "IBC": { org: "IBC", domain: "ibc.org", conf: "high", why: "IBC organizes its own convention, present pp1" },
  "AFAC": { org: "AFAC", domain: "afac.com.au", conf: "high", why: "AFAC (with Hannover Fairs) hosts the conference" },
  "Newtopia Now 2026": { org: "New Hope Network", domain: "newhope.com", conf: "high", why: "New Hope Network (Informa) runs Newtopia Now, emails present" },
  "CEDIA Expo": { org: "Emerald", domain: "emeraldx.com", conf: "high", why: "Emerald co-produces CEDIA Expo, present" },
  "Gartner Procurement Conference": { org: "Gartner", domain: "gartner.com", conf: "high", why: "Gartner hosts, 98% of contacts are Gartner" },
  "Groceryshop 2026": { org: "Shoptalk", domain: "shoptalk.com", conf: "high", why: "Groceryshop is run by Shoptalk (Hyve), present 45%" },
  "IFT FIRST 2026": { org: "Institute of Food Technologists (IFT)", domain: "ift.org", conf: "high", why: "IFT hosts IFT FIRST, present pp1" },
  "ADLM Clinical Lab Expo 2026": { org: "Association for Diagnostics & Laboratory Medicine", domain: "myadlm.org", conf: "high", why: "ADLM hosts its own Clinical Lab Expo" },
  "Esri User Conference 2026": { org: "Esri", domain: "esri.com", conf: "high", why: "Esri hosts, 96 esri.com contact emails" },
  "INFORMS Healthcare 2026": { org: "INFORMS", domain: "informs.org", conf: "high", why: "INFORMS hosts, present 22% pp1" },
  "CAMX": { org: "American Composites Manufacturers Association", domain: "acmanet.org", conf: "high", why: "ACMA (with SAMPE) hosts CAMX, present pp1" },
  "Billington Cybersecurity Summit": { org: "Billington CyberSecurity", domain: "billingtoncybersecurity.com", conf: "high", why: "Billington hosts its own summit, present 44%" },
  "Accountex Summit Manchester": { org: "Diversified Communications UK", domain: "divcom.co.uk", conf: "high", why: "Diversified Communications UK organizes Accountex, present" },
  "MoneyLIVE North America": { org: "Marketforce", domain: "marketforcelive.com", conf: "high", why: "MoneyLIVE is run by Marketforce, present 44%" },
  "Fintech Devcon": { org: "Moov", domain: "moov.io", conf: "high", why: "Fintech Devcon is organized by Moov, present 17%" },
  "PCBC": { org: "California Building Industry Association", domain: "cbia.org", conf: "high", why: "CBIA produces PCBC, present" },
  "ILM Offenbach 2026": { org: "Messe Offenbach", domain: "messe-offenbach.de", conf: "high", why: "Messe Offenbach hosts ILM, present 28%" },
  "Wood Products & Technology": { org: "Svenska Massan", domain: "svenskamassan.se", conf: "high", why: "Svenska Massan (Swedish Exhibition Centre) hosts it" },
  "Formex Stockholm 2026": { org: "Stockholmsmassan", domain: "stockholmsmassan.se", conf: "high", why: "Stockholmsmassan organizes Formex" },
  "Kind + Jugend 2026": { org: "Koelnmesse", domain: "koelnmesse.com", conf: "high", why: "Koelnmesse organizes Kind + Jugend, present 18%" },
  "NY NOW 2026": { org: "ANDMORE", domain: "andmore.com", conf: "high", why: "ANDMORE (formerly IMC) owns and runs NY NOW" },
  "RE+ Mid-Atlantic 2026": { org: "RE+ Events", domain: "re-plus.events", conf: "high", why: "RE+ Events produces the RE+ regional shows" },
  "Munich Fabric Start 2026": { org: "Munich Fabric Start", domain: "munichfabricstart.com", conf: "high", why: "event's own organizer, emails present" },
  "Formland 2026": { org: "MCH Group", domain: "mch.dk", conf: "high", why: "MCH (Messecenter Herning) hosts Formland, emails present" },
  "Leap Conference": { org: "Tahaluf", domain: "tahaluf.com", conf: "high", why: "LEAP is organized by Tahaluf (Informa/SELA), emails present" },
  "Yotta 2026": { org: "Uptime Institute", domain: "uptimeinstitute.com", conf: "high", why: "Yotta is presented by Uptime Institute, present pp1" },
  "Trendz showUP 2026": { org: "Easyfairs", domain: "easyfairs.com", conf: "high", why: "Easyfairs Netherlands organizes Trendz, present" },
  "Solarplaza Summit Italy 2026": { org: "Solarplaza", domain: "solarplaza.com", conf: "high", why: "Solarplaza runs its summits (host not among attendees)" },
  "The World Biogas Expo": { org: "World Biogas Association", domain: "worldbiogasassociation.org", conf: "high", why: "WBA / ADBA organizes the World Biogas Expo (external)" },

  // ---- Confident EXTERNAL organizers (host has no/low contact presence -> expected to land in review) ----
  "Home & Gift 2026": { org: "Clarion Events", domain: "clarionevents.com", conf: "high", why: "Clarion Events organizes Home & Gift" },
  "IFA Berlin 2026": { org: "Messe Berlin", domain: "messe-berlin.de", conf: "high", why: "Messe Berlin (with gfu) organizes IFA" },
  "Nordstil Summer 2026": { org: "Messe Frankfurt", domain: "messefrankfurt.com", conf: "high", why: "Messe Frankfurt organizes Nordstil" },
  "Techtextil North America 2026": { org: "Messe Frankfurt", domain: "messefrankfurt.com", conf: "high", why: "Messe Frankfurt North America organizes Techtextil NA" },
  "EuroBLECH 2026": { org: "RX Global", domain: "rxglobal.com", conf: "high", why: "Mack Brooks / RX organizes EuroBLECH" },
  "Farm Progress Show": { org: "Farm Progress", domain: "farmprogress.com", conf: "high", why: "Farm Progress (Informa) organizes the show" },
  "PACK EXPO International": { org: "PMMI", domain: "pmmi.org", conf: "high", why: "PMMI organizes PACK EXPO" },
  "Cosmoprof North America 2026": { org: "Informa Markets", domain: "informamarkets.com", conf: "high", why: "Cosmoprof NA is produced by Informa Markets + BolognaFiere" },
  "Affiliate Summit East 2026": { org: "Clarion Events", domain: "clarionevents.com", conf: "high", why: "Affiliate Summit is a Clarion Events brand" },
  "SIGGRAPH 2026": { org: "ACM SIGGRAPH", domain: "siggraph.org", conf: "high", why: "ACM SIGGRAPH organizes the conference" },
  "IAA Transportation 2026": { org: "VDA", domain: "vda.de", conf: "high", why: "VDA organizes IAA" },
  "DEF CON 34": { org: "DEF CON Communications", domain: "defcon.org", conf: "high", why: "DEF CON runs its own conference" },
  "Black Hat USA 2026": { org: "Informa Tech", domain: "informatech.com", conf: "high", why: "Black Hat is an Informa Tech event" },
  "SEMA Show 2026": { org: "SEMA", domain: "sema.org", conf: "high", why: "Specialty Equipment Market Association hosts SEMA Show" },
  "IMTS 2026": { org: "AMT - The Association For Manufacturing Technology", domain: "amtonline.org", conf: "high", why: "AMT owns and produces IMTS" },
  "IMEX Frankfurt 2026": { org: "IMEX Group", domain: "imexexhibitions.com", conf: "high", why: "IMEX Group organizes IMEX" },
  "Commercial UAV Expo Americas": { org: "Diversified Communications", domain: "divcom.com", conf: "high", why: "Diversified Communications organizes Commercial UAV Expo" },
  "Fine Food Australia": { org: "Diversified Communications", domain: "divcom.net.au", conf: "high", why: "Diversified Communications Australia organizes Fine Food, emails present" },
  "ESC Congress 2026": { org: "European Society of Cardiology", domain: "escardio.org", conf: "high", why: "ESC hosts its own congress" },
  "ISUOG World Congress": { org: "ISUOG", domain: "isuog.org", conf: "high", why: "ISUOG hosts its own world congress" },
  "SuperZoo": { org: "World Pet Association (WPA)", domain: "worldpetassociation.org", conf: "high", why: "WPA organizes SuperZoo" },
  "Elmia Lastbil": { org: "Elmia", domain: "elmia.se", conf: "high", why: "Elmia AB organizes the show" },
  "Momad Metropolis 2026": { org: "IFEMA", domain: "ifema.es", conf: "high", why: "IFEMA Madrid organizes Momad" },
  "Kind + Jugend 2026 ": { org: "Koelnmesse", domain: "koelnmesse.com", conf: "high", why: "duplicate guard" },
  "MAGIC Las Vegas 2026": { org: "Informa Markets", domain: "informamarkets.com", conf: "high", why: "MAGIC is an Informa Markets fashion show" },
  "Saudi Industrial Expo": { org: "dmg events", domain: "dmgevents.com", conf: "high", why: "dmg events organizes it, present" },
  "all about automation Zurich": { org: "untitled exhibitions", domain: "untitledexhibitions.com", conf: "low", why: "untitled exhibitions runs it; Easyfairs presence is likely exhibitors, verify" },
  "Autumn Fair 2026 ": { org: "Hyve Group", domain: "hyve.group", conf: "high", why: "duplicate guard" },
};

const evidence = JSON.parse(readFileSync(join(__dirname, "..", arg("evidence")), "utf8"));
const out = [];
let mapped = 0;
for (const ev of evidence) {
  const m = MAP[ev.name];
  if (m) { mapped++; out.push({ eventId: ev.eventId, name: ev.name, organizerName: m.org, organizerDomain: m.domain || null, matchesCandidateId: null, confidence: m.conf, reasoning: m.why }); }
  else { out.push({ eventId: ev.eventId, name: ev.name, organizerName: null, organizerDomain: null, matchesCandidateId: null, confidence: "low", reasoning: "organizer not yet identified - needs human check" }); }
}
writeFileSync(join(__dirname, "..", arg("out", "scripts/output/org-judgments-live.json")), JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} judgments (${mapped} identified, ${out.length - mapped} left low for review) -> ${arg("out", "scripts/output/org-judgments-live.json")}`);
