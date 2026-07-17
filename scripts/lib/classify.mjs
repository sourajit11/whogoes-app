/**
 * Pure, dependency-free classifiers for WhoGoes pre-unlock filtering (Phase 1).
 *
 * Used by the backfill script AND mirrored in the n8n enrichment/qualifying
 * workflows (Phase 2). No DB, no network, no LLM here: deterministic rules only.
 * The function classifier exposes a `headlineFallback` path the caller uses when
 * the title alone is ambiguous; an LLM fallback (if ever needed) lives in the
 * caller, not in this lib.
 *
 *   classifySeniority(title)            -> C-Suite | Owner/Founder | VP | Director | Manager | IC | Other | null
 *   classifyFunction(title, headline)   -> { bucket, confidence }
 *   classifySize(sizeRange, employeeCount) -> 1-10 | 11-50 | 51-200 | 201-500 | 501-1000 | 1001-5000 | 5000+ | null
 *   classifyIndustry(rawIndustry)       -> one of the 47 buckets | null (null = needs LLM fallback)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Industry ---------------------------------------------------------------

const INDUSTRY = JSON.parse(
  readFileSync(join(__dirname, "../company-industry-mapping.json"), "utf8")
);
const INDUSTRY_MAP = new Map(
  Object.entries(INDUSTRY.map).map(([k, v]) => [k.toLowerCase().trim(), v])
);
export const INDUSTRY_CATEGORIES = INDUSTRY.categories;

export function classifyIndustry(rawIndustry) {
  if (!rawIndustry) return null;
  return INDUSTRY_MAP.get(String(rawIndustry).toLowerCase().trim()) ?? null;
}

// --- Helpers ----------------------------------------------------------------

// Pad with spaces and normalise separators so \b word matches are reliable.
function norm(s) {
  return ` ${String(s).toLowerCase().replace(/[._/|,&-]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

// "Partner" only counts as a firm/equity partner (C-Suite), not "HR Business
// Partner", "Channel Partner", "Partner Manager", etc.
function isFirmPartner(t) {
  if (!/\bpartner\b/.test(t)) return false;
  if (/\b(business|channel|sales|marketing|it|hr|account|alliance|technology|implementation|delivery|solution|solutions)\s+partner\b/.test(t)) return false;
  if (/\bpartner\s+(manager|management|marketing|success|account|development|relations|engineer|engineering)\b/.test(t)) return false;
  return true;
}

// --- Seniority --------------------------------------------------------------
// Precedence: Owner/Founder is most defining (a founder is a founder), then the
// executive tiers downward. Filters are multi-select, so a founder-CEO landing
// in Owner/Founder rather than C-Suite is fine.

// Multilingual seniority fallback (DE/FR/ES/ZH), same precedence as English.
const ML_SENIORITY = [
  ["Owner/Founder", ["inhaber", "gründer", "gruender", "fondateur", "fondatrice", "fundador", "propietario", "propriétaire", "proprietaire", "dueño", "创始人", "老板", "东主"]],
  ["C-Suite", ["geschäftsführer", "geschaeftsfuehrer", "directeur général", "directeur general", "gérant", "gerant", "président", "gerente general", "presidente", "vorstand", "prokurist", "总经理", "总裁", "董事长"]],
  ["VP", ["vice-président", "vice président", "vicepresidente", "副总裁", "副总"]],
  ["Director", ["directeur", "directrice", "direktor", "director", "directora", "总监"]],
  ["Manager", ["leiter", "leiterin", "teamleiter", "produktmanager", "responsable", "chef de", "gerente", "jefe", "jefa", "经理", "主管"]],
  ["IC", ["mitarbeiter", "ingenieur", "techniker", "sachbearbeiter", "berater", "spezialist", "kaufmann", "kauffrau", "ingénieur", "technicien", "commercial", "consultant", "chargé", "ingeniero", "técnico", "tecnico", "representante", "especialista", "consultor", "专员", "代表", "工程师", "技术员"]],
];

function englishSeniority(t) {
  if (/\b(founder|co founder|cofounder|owner|proprietor|self employed)\b/.test(t)) return "Owner/Founder";
  // VP before C-Suite so "Vice President" is not caught by the "president" rule.
  if (/\b(vp|svp|evp|avp|vice president|head of|global head|group head)\b/.test(t)) return "VP";
  if (
    /\bchief\b/.test(t) ||
    /\bc[efmotirpdhsxa]o\b/.test(t) ||           // ceo cfo coo cto cmo cro cio cpo cdo cho cso cxo cao ...
    /\b(president|managing director|managing partner|founding partner|general partner|senior partner|chairman|chairwoman|chairperson|board member|board of directors|managing board)\b/.test(t) ||
    isFirmPartner(t)
  ) return "C-Suite";
  if (/\bdirector\b/.test(t)) return "Director";
  if (/\b(manager|mgr|lead|principal|supervisor|foreman|head)\b/.test(t)) return "Manager";
  if (/\b(engineer|developer|programmer|analyst|specialist|coordinator|associate|executive|representative|rep|consultant|designer|officer|administrator|assistant|technician|scientist|strategist|architect|advisor|adviser|agent|buyer|planner|accountant|recruiter|counsel|partner|nurse|teacher|professor|researcher|writer|editor|operator|copywriter|creative|producer|creator|intern|faculty)\b/.test(t)) return "IC";
  return "Other";
}

function seniorityFromText(t) {
  const eng = englishSeniority(t);
  if (eng !== "Other") return eng;
  for (const [bucket, terms] of ML_SENIORITY) if (inclAny(t, terms)) return bucket;
  return "Other";
}

// Ambiguous leadership words ("X Leader"), used ONLY as a last resort after strong
// title and headline signals fail, so a clear higher level in the headline (e.g.
// "Director") still wins. "leader" -> Manager is the conservative default.
function weakSeniority(t) {
  if (/\bleader\b/.test(t)) return "Manager";
  return null;
}

// Tries the title first, then falls back to the LinkedIn headline (which often
// carries the real level, e.g. title "Global Impact Leader" but headline
// "Director, Sustainability..."). Returns the bucket + where it came from.
function seniorityDetail(title, headline) {
  const hasTitle = title && String(title).trim();
  const hasHeadline = headline && String(headline).trim();
  if (hasTitle) {
    const b = seniorityFromText(norm(title));
    if (b !== "Other") return { bucket: b, source: "title" };
  }
  if (hasHeadline) {
    const b = seniorityFromText(norm(headline));
    if (b !== "Other") return { bucket: b, source: "headline" };
  }
  // Weak fallback: ambiguous "X Leader" titles, only after strong signals fail.
  if (hasTitle) {
    const w = weakSeniority(norm(title));
    if (w) return { bucket: w, source: "title-weak" };
  }
  if (hasHeadline) {
    const w = weakSeniority(norm(headline));
    if (w) return { bucket: w, source: "headline-weak" };
  }
  return { bucket: hasTitle || hasHeadline ? "Other" : null, source: null };
}

export function classifySeniority(title, headline) {
  return seniorityDetail(title, headline).bucket;
}

// --- Function / Department --------------------------------------------------
// First-match-wins over an ordered rule list. Order is deliberate: e.g. Sales
// is checked before Operations so "Sales Operations" -> Sales; Marketing before
// Product so "Product Marketing" -> Marketing. Bare leadership titles with no
// functional keyword fall to Executive/General Mgmt; anything else -> Other.

const FUNCTION_RULES = [
  ["Legal/Compliance", /\b(legal|counsel|attorney|lawyer|solicitor|compliance|regulatory|paralegal|clo)\b/],
  ["Finance", /\b(finance|financial|accounting|accountant|controller|treasury|treasurer|audit|auditor|fp&a|cfo|bookkeep|tax|actuar)\b/],
  ["HR/People", /\b(human resources|hr|hrbp|talent|recruit|recruiter|recruiting|people|chro|payroll|l&d|culture|workforce|compensation)\b/],
  ["Procurement/Supply Chain", /\b(procurement|purchasing|sourcing|supply chain|logistics|warehouse|warehousing|fulfillment|buyer|inventory|vendor management)\b/],
  ["Customer Success", /\b(customer success|customer support|customer experience|customer service|client services|client success|client experience|cx|csm|support engineer|technical support|help desk)\b/],
  ["Marketing", /\b(marketing|brand|growth|demand gen|demand generation|communications|comms|public relations|pr|social media|seo|sem|advertising|cmo|events|community manager)\b/],
  ["Product", /\b(product manager|product owner|product management|product lead|head of product|chief product|product officer|product director|product analyst|product designer)\b/],
  // Creative & Content sits after Marketing (so "Content Marketing" -> Marketing) and
  // after Product (so "Product Designer" -> Product), catching creative/editorial ICs.
  ["Creative & Content", /\b(creative|copywriter|copywrit|content|art director|graphic designer|graphic|designer|producer|videographer|photographer|illustrator|animator|video editor|editor|editorial)\b/],
  ["Engineering/Technical", /\b(engineer|engineering|cto|chief technology|technology officer|r&d|mechanical|electrical|civil|chemical|technical|technician|hardware|firmware|manufacturing|quality assurance|qa|architect|machinist|fabricat|welder|electrician)\b/],
  ["IT/Data", /\b(information technology|it|data|analytics|systems|network|infrastructure|database|devops|cyber|security|cio|ciso|chief information|information officer|software|developer|programmer|cloud|sysadmin|machine learning|ai)\b/],
  ["Sales/BD", /\b(sales|business development|account executive|account manager|account director|account representative|account rep|key account|revenue|commercial|cro|bdr|sdr|partnerships|go to market|gtm|territory|inside sales|field sales|export)\b/],
  ["Operations", /\b(operations|ops|operational|coo|chief operating|operating officer|process|project manager|program manager|pmo|delivery|service delivery|production|plant manager|facilities)\b/],
  ["Executive/General Mgmt", /\b(ceo|chief executive|chief business|business officer|founder|owner|proprietor|president|managing director|managing partner|general manager|gm|country manager|country leader|partner|principal|board|chairman|chairwoman|director|head of)\b/],
];

// Multilingual fallback (DE/FR/ES/ZH), substring-matched because non-ASCII word
// boundaries are unreliable. Checked in the same precedence as the English rules.
const ML_FUNCTION = [
  ["Sales/BD", ["vertrieb", "verkauf", "gebietsverkaufsleiter", "accountmanager", "directeur commercial", "commercial", "ingénieur commercial", "técnico comercial", "tecnico comercial", "comercial", "ventas", "销售", "业务"]],
  ["Procurement/Supply Chain", ["einkauf", "einkäufer", "achat", "acheteur", "compras", "beschaffung", "采购"]],
  ["HR/People", ["personalleiter", "personalreferent", "ressources humaines", "recursos humanos", "人力资源", "人事"]],
  ["Finance", ["finanzen", "finanzas", "comptable", "contabilidad", "财务", "会计"]],
  ["Marketing", ["marktführer", "mercadotecnia", "市场", "市场营销"]],
  ["Product", ["produktmanager", "produktmanagement", "chef de produit", "产品"]],
  ["Engineering/Technical", ["ingenieur", "ingénieur", "ingeniero", "techniker", "technicien", "工程师", "技术"]],
  ["IT/Data", ["informatik", "informatique", "informática", "数据", "信息技术"]],
  ["Operations", ["betriebsleiter", "produktionsleiter", "logistikleiter", "projektmanager", "projektleiter", "responsable d'exploitation", "operaciones", "运营", "生产"]],
  ["Executive/General Mgmt", ["geschäftsführer", "geschaeftsfuehrer", "inhaber", "gründer", "gerant", "gérant", "directeur général", "directeur general", "président", "fondateur", "gerente general", "presidente", "fundador", "propietario", "总经理", "总裁", "董事长", "董事", "创始人"]],
];

function inclAny(t, terms) {
  for (const w of terms) if (t.includes(w)) return true;
  return false;
}

function functionFromText(t) {
  for (const [bucket, re] of FUNCTION_RULES) {
    if (re.test(t)) return bucket;
  }
  for (const [bucket, terms] of ML_FUNCTION) {
    if (inclAny(t, terms)) return bucket;
  }
  return null;
}

function functionDetail(title, headline) {
  if (title && String(title).trim()) {
    const b = functionFromText(norm(title));
    if (b) return { bucket: b, source: "title" };
  }
  if (headline && String(headline).trim()) {
    const b = functionFromText(norm(headline));
    if (b) return { bucket: b, source: "headline" };
  }
  return { bucket: "Other", source: null };
}

export function classifyFunction(title, headline) {
  const d = functionDetail(title, headline);
  const confidence = d.source === "title" ? "high" : d.source === "headline" ? "medium" : "low";
  return { bucket: d.bucket, confidence };
}

// --- Company size -----------------------------------------------------------

function bandFromCount(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 500) return "201-500";
  if (n <= 1000) return "501-1000";
  if (n <= 5000) return "1001-5000";
  return "5000+";
}

export function classifySize(sizeRange, employeeCount) {
  // Prefer the clean integer when present.
  const byCount = bandFromCount(Number(employeeCount));
  if (byCount) return byCount;

  if (sizeRange == null || String(sizeRange).trim() === "") return null;
  // Parse the lower bound of the (often messy) range: "2-10", "11-50",
  // "10001-null", "10001+", bare "17", "0-1".
  const lower = parseInt(String(sizeRange), 10);
  if (Number.isNaN(lower)) return null;
  if (lower === 0) return "1-10"; // "0-1"
  return bandFromCount(lower);
}

// --- Convenience wrappers ---------------------------------------------------

export function classifyContact(title, headline) {
  const sen = seniorityDetail(title, headline);
  const fn = functionDetail(title, headline);
  // Confidence reflects the strongest signal source across both dimensions.
  const sources = [sen.source, fn.source];
  // Strong title signal = high; any other resolved signal (headline or weak) = medium.
  const confidence = sources.includes("title")
    ? "high"
    : sources.some(Boolean)
      ? "medium"
      : "low";
  return {
    seniority_bucket: sen.bucket,
    function_bucket: fn.bucket,
    classification_confidence: confidence,
  };
}

export function classifyCompany({ industry, size_range, employee_count }) {
  return {
    industry_bucket: classifyIndustry(industry),
    size_bucket: classifySize(size_range, employee_count),
  };
}

// --- Self-test (node classify.mjs) -----------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cases = [
    ["Chief Executive Officer", "C-Suite", "Executive/General Mgmt"],
    ["CEO", "C-Suite", "Executive/General Mgmt"],
    ["Founder & CEO", "Owner/Founder", "Executive/General Mgmt"],
    ["Co-Founder", "Owner/Founder", "Executive/General Mgmt"],
    ["Owner", "Owner/Founder", "Executive/General Mgmt"],
    ["Managing Director", "C-Suite", "Executive/General Mgmt"],
    ["Managing Partner", "C-Suite", "Executive/General Mgmt"],
    ["President", "C-Suite", "Executive/General Mgmt"],
    ["Chief Marketing Officer", "C-Suite", "Marketing"],
    ["CFO", "C-Suite", "Finance"],
    ["VP of Sales", "VP", "Sales/BD"],
    ["Vice President, Marketing", "VP", "Marketing"],
    ["Head of Product", "VP", "Product"],
    ["Sales Director", "Director", "Sales/BD"],
    ["Director of Business Development", "Director", "Sales/BD"],
    ["Director", "Director", "Executive/General Mgmt"],
    ["Marketing Manager", "Manager", "Marketing"],
    ["Sales Manager", "Manager", "Sales/BD"],
    ["Regional Sales Manager", "Manager", "Sales/BD"],
    ["Project Manager", "Manager", "Operations"],
    ["Account Executive", "IC", "Sales/BD"],
    ["Enterprise Account Executive", "IC", "Sales/BD"],
    ["Key Account Manager", "Manager", "Sales/BD"],
    ["Software Engineer", "IC", "Engineering/Technical"],
    ["Data Scientist", "IC", "IT/Data"],
    ["Product Marketing Manager", "Manager", "Marketing"],
    ["Product Manager", "Manager", "Product"],
    ["HR Business Partner", "IC", "HR/People"],
    ["General Counsel", "IC", "Legal/Compliance"],
    ["Procurement Specialist", "IC", "Procurement/Supply Chain"],
    ["Customer Success Manager", "Manager", "Customer Success"],
    ["Partner", "C-Suite", "Executive/General Mgmt"],
    ["Chief Operating Officer", "C-Suite", "Operations"],
    ["Chief Technology Officer", "C-Suite", "Engineering/Technical"],
    ["Board Member", "C-Suite", "Executive/General Mgmt"],
    ["Geschäftsführer", "C-Suite", "Executive/General Mgmt"],
    ["Directeur commercial", "Director", "Sales/BD"],
    ["Vertriebsingenieur", "IC", "Sales/BD"],
    ["销售经理", "Manager", "Sales/BD"],
    ["Export Manager", "Manager", "Sales/BD"],
    ["Sales Leader", "Manager", "Sales/BD"],
    ["Country Leader", "Manager", "Executive/General Mgmt"],
    ["Copywriter", "IC", "Creative & Content"],
    ["Creative Director", "Director", "Creative & Content"],
    ["Graphic Designer", "IC", "Creative & Content"],
    ["Producer", "IC", "Creative & Content"],
    ["Content Marketing Manager", "Manager", "Marketing"],
    ["Product Designer", "IC", "Product"],
  ];
  let pass = 0;
  for (const [title, expSen, expFn] of cases) {
    const sen = classifySeniority(title);
    const fn = classifyFunction(title).bucket;
    const ok = sen === expSen && fn === expFn;
    if (ok) pass++;
    else console.log(`MISS  ${title.padEnd(34)} sen=${sen} (exp ${expSen})  fn=${fn} (exp ${expFn})`);
  }
  console.log(`\nseniority+function self-test: ${pass}/${cases.length} passed`);

  const sizes = [["2-10", null, "1-10"], ["0-1", null, "1-10"], ["11-50", null, "11-50"], ["51-200", null, "51-200"], ["1001-5000", null, "1001-5000"], ["10001-null", null, "5000+"], ["10001+", null, "5000+"], ["17", null, "11-50"], [null, 4200, "1001-5000"], [null, 7, "1-10"]];
  let sp = 0;
  for (const [sr, ec, exp] of sizes) {
    const got = classifySize(sr, ec);
    if (got === exp) sp++; else console.log(`SIZE MISS  range=${sr} count=${ec} -> ${got} (exp ${exp})`);
  }
  console.log(`size self-test: ${sp}/${sizes.length} passed`);
}
