import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ICS_FILE = process.argv[2]
  ? path.resolve(ROOT, process.argv[2])
  : path.resolve(ROOT, "data-domiciliu.ics");
const OUT_CSV = process.argv[3]
  ? path.resolve(ROOT, process.argv[3])
  : path.resolve(ROOT, "exports/unresolved_ics_entries.csv");

function loadEnvLocal() {
  const envPath = path.resolve(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const txt = fs.readFileSync(envPath, "utf8");
  for (const row of txt.split(/\r?\n/)) {
    const line = row.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalize(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unfoldIcsLines(raw) {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function parseIcsEvents(raw) {
  const lines = unfoldIcsLines(raw);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).split(";")[0];
    current[key] = line.slice(idx + 1);
  }
  return events;
}

function parseDateTime(rawValue) {
  if (!rawValue) return null;
  const value = rawValue.trim();
  if (/^\d{8}$/.test(value)) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(value);
  if (!m) return null;
  return {
    isoDate: `${m[1]}-${m[2]}-${m[3]}`,
    hhmm: `${m[4]}:${m[5]}`,
  };
}

function extractNamePrefix(summary) {
  const cleaned = summary.replace(/\\,/g, ",").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const tokens = cleaned.split(" ");
  const stop = new Set([
    "set",
    "nou",
    "retus",
    "intretinere",
    "întreținere",
    "mega",
    "natural",
    "russian",
    "rusian",
    "volum",
    "gene",
    "demontare",
    "lei",
    "card",
    "mani",
    "pedi",
    "ora",
    "+",
  ]);
  const out = [];
  for (const token of tokens) {
    const n = normalize(token);
    if (!n) continue;
    if (/\d/.test(token) || stop.has(n)) break;
    out.push(token);
  }
  if (out.length === 0) return cleaned;
  return out.join(" ");
}

function csvEscape(value) {
  const v = value == null ? "" : String(value);
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, "\"\"")}"`;
  return v;
}

function isNonClientLike(summary) {
  const s = normalize(summary);
  if (!s) return true;
  if (/^\d[\d\s.,/:-]*(lei)?$/.test(s)) return true;
  if (/\b\d[\d\s.,/:-]{2,}\s*lei\b/.test(s) && !/[a-z]/.test(s.replace(/\blei\b/g, ""))) return true;
  if (/\bluna\b/.test(s) && /\blei\b/.test(s)) return true;
  const bad = [
    "eu gene",
    "eu mani",
    "par",
    "anpc",
    "programare",
    "buletin",
    "curs",
    "demontare",
    "pedi",
    "unghii",
  ];
  return bad.some((x) => s.includes(x));
}

async function run() {
  if (!fs.existsSync(ICS_FILE)) throw new Error(`ICS missing: ${ICS_FILE}`);
  loadEnvLocal();
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const clients = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from("clients").select("id,name").range(from, from + 999);
    if (error) throw error;
    const rows = data || [];
    clients.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  const clientNormSet = new Set(clients.map((c) => normalize(c.name)));

  const events = parseIcsEvents(fs.readFileSync(ICS_FILE, "utf8"));
  const unresolved = [];
  for (const ev of events) {
    const summary = (ev.SUMMARY || "").trim();
    const start = parseDateTime(ev.DTSTART || "");
    if (!summary || !start) continue;
    if (start.isoDate < "2023-01-01") continue;
    const extracted = extractNamePrefix(summary).trim();
    if (!extracted) continue;
    const n = normalize(extracted);
    if (!n || clientNormSet.has(n)) continue;
    unresolved.push({
      date: start.isoDate,
      time: start.hhmm,
      summary,
      extracted_name: extracted,
      reason: isNonClientLike(summary) ? "non_client_like" : "possibly_client",
      decide_keep: "",
      corrected_name: "",
      note: "",
    });
  }

  unresolved.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  const header = ["date", "time", "summary", "extracted_name", "reason", "decide_keep", "corrected_name", "note"];
  const csv = [header.join(",")]
    .concat(unresolved.map((row) => header.map((h) => csvEscape(row[h])).join(",")))
    .join("\n");
  fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
  fs.writeFileSync(OUT_CSV, csv, "utf8");

  const counts = unresolved.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.reason] = (acc[row.reason] || 0) + 1;
      return acc;
    },
    { total: 0, non_client_like: 0, possibly_client: 0 },
  );
  console.log(JSON.stringify({ out_csv: OUT_CSV, counts }, null, 2));
}

run().catch((e) => {
  console.error(e.message || String(e));
  process.exit(1);
});
