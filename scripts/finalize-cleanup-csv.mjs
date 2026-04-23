import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const exportDir = process.argv[2]
  ? path.resolve(ROOT, process.argv[2])
  : path.resolve(ROOT, "exports/supabase-2026-04-20-00-35-21");

const clientsFile = path.join(exportDir, "clients_cleanup.csv");
const appointmentsFile = path.join(exportDir, "appointments_cleanup.csv");

const NON_CLIENT_PATTERNS = [
  /\bbuletin\b/i,
  /\bcurs\b/i,
  /\btaiere\s+mot\b/i,
  /\btăiere\s+moț\b/i,
  /\bmot\b/i,
  /\bunghii\b/i,
  /\bmani\b/i,
  /\bpedi\b/i,
  /\bmanichiur(a|ă)\b/i,
  /\btuns\b/i,
  /\bvopsit\b/i,
  /\btratament\s+par\b/i,
  /\btratament\s+păr\b/i,
  /^\s*eu\b/i,
  /^\s*programare\b/i,
];

const LASH_HINTS = [
  /\bgene\b/i,
  /\bvolum\b/i,
  /\brussian\b/i,
  /\brusian\b/i,
  /\bnatural\b/i,
  /\bretus\b/i,
  /\bîntreținere\b/i,
  /\bintretinere\b/i,
  /\bdemontare\b/i,
  /\bextensii\b/i,
];

function parseCsvLine(line, delimiter) {
  const out = [];
  let current = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  out.push(current);
  return out;
}

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return { header: [], rows: [], delimiter: "," };
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = parseCsvLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line, delimiter);
    const row = {};
    for (let i = 0; i < header.length; i += 1) row[header[i]] = cols[i] ?? "";
    return row;
  });
  return { header, rows, delimiter };
}

function csvEscape(value, delimiter) {
  const v = value == null ? "" : String(value);
  if (v.includes("\"") || v.includes("\n") || v.includes(delimiter)) {
    return `"${v.replace(/"/g, "\"\"")}"`;
  }
  return v;
}

function writeCsv(filePath, header, rows, delimiter) {
  const out = [
    header.join(delimiter),
    ...rows.map((row) => header.map((h) => csvEscape(row[h] ?? "", delimiter)).join(delimiter)),
  ].join("\n");
  fs.writeFileSync(filePath, out, "utf8");
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

function titleCase(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((w) => `${w.charAt(0).toUpperCase()}${w.slice(1).toLowerCase()}`)
    .join(" ");
}

function hasLetters(value) {
  return /[a-zA-ZăâîșțĂÂÎȘȚ]/.test(value || "");
}

function cleanClientName(raw) {
  let value = (raw || "").trim();
  value = value.replace(/\\,/g, ",");
  value = value.replace(/\(.*?\)/g, " ");
  value = value.replace(/\+.*$/g, " ");
  value = value.replace(/\b\d{2,4}\s*lei\b/gi, " ");
  value = value.replace(/\b(set|nou|retus|intretinere|întreținere|russian|rusian|natural|mega|demontare|volum|gene)\b.*$/i, " ");
  value = value.replace(/[^\p{L}\s'-]/gu, " ");
  value = value.replace(/\s+/g, " ").trim();
  return value;
}

function isNonClientLabel(name) {
  const label = (name || "").trim();
  if (!label) return true;
  if (!hasLetters(label)) return true;
  if (/^\d[\d\s.,]*\s*(lei)?$/i.test(label)) return true;
  const hits = NON_CLIENT_PATTERNS.some((re) => re.test(label));
  const lash = LASH_HINTS.some((re) => re.test(label));
  if (hits && !lash) return true;
  return false;
}

function durationToMinutes(duration) {
  const t = (duration || "").toLowerCase();
  const h = t.match(/(\d+)\s*h/);
  const m = t.match(/(\d+)\s*m/);
  const hh = h ? Number(h[1]) : 0;
  const mm = m ? Number(m[1]) : 0;
  if (hh || mm) return hh * 60 + mm;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function extractPriceFromText(text) {
  const nums = [...(text || "").matchAll(/\b(\d{2,4})\b/g)].map((m) => Number(m[1]));
  const valid = nums.filter((n) => n >= 40 && n <= 1000);
  return valid.length ? valid[valid.length - 1] : null;
}

function inferPrice(service, duration, existingPrice) {
  const priceNow = Number(existingPrice || 0);
  if (priceNow > 0) return Math.round(priceNow);

  const priceFromService = extractPriceFromText(service || "");
  if (priceFromService) return priceFromService;

  const min = durationToMinutes(duration);
  if (min <= 35) return 60;
  if (min <= 75) return 150;
  if (min <= 105) return 220;
  if (min <= 135) return 250;
  if (min <= 165) return 300;
  return 330;
}

function backup(filePath) {
  const bak = `${filePath}.bak-before-finalize`;
  if (!fs.existsSync(bak)) fs.copyFileSync(filePath, bak);
}

function run() {
  if (!fs.existsSync(clientsFile) || !fs.existsSync(appointmentsFile)) {
    throw new Error(`Missing cleanup files in ${exportDir}`);
  }
  backup(clientsFile);
  backup(appointmentsFile);

  const clientsCsv = parseCsv(clientsFile);
  const apptsCsv = parseCsv(appointmentsFile);

  // 1) Normalize clients and mark non-client rows
  let clientsAutoDrop = 0;
  let clientsMerged = 0;
  const canonicalByNorm = new Map();

  for (const row of clientsCsv.rows) {
    const original = row.name || "";
    const cleaned = cleanClientName(original);
    const normalized = normalize(cleaned);
    if (!cleaned || isNonClientLabel(original)) {
      row.keep = "0";
      row.notes_cleanup = row.notes_cleanup || "auto: non-client row";
      clientsAutoDrop += 1;
      continue;
    }

    row.name = titleCase(cleaned);
    if (normalize(original) === "mama eve") {
      row.name = "Eve";
      row.notes_cleanup = row.notes_cleanup || "auto: normalize Mama Eve -> Eve";
    }

    if (!normalized) {
      row.keep = "0";
      row.notes_cleanup = row.notes_cleanup || "auto: empty after cleanup";
      clientsAutoDrop += 1;
      continue;
    }

    if (!canonicalByNorm.has(normalized)) {
      canonicalByNorm.set(normalized, row.name);
    } else if (canonicalByNorm.get(normalized) !== row.name) {
      row.merge_into_name = canonicalByNorm.get(normalized);
      row.keep = "0";
      row.notes_cleanup = row.notes_cleanup || `auto: merged into ${row.merge_into_name}`;
      clientsMerged += 1;
    }
  }

  // 2) Normalize appointments and mark non-client appointments
  let apptsAutoDrop = 0;
  let apptsPriceUpdated = 0;

  for (const row of apptsCsv.rows) {
    const originalName = row.client_name || "";
    const cleanedName = cleanClientName(originalName);

    if (!cleanedName || isNonClientLabel(originalName)) {
      row.keep = "0";
      row.notes_cleanup = row.notes_cleanup || "auto: non-client appointment";
      apptsAutoDrop += 1;
      continue;
    }

    const fixedName = normalize(originalName) === "mama eve" ? "Eve" : titleCase(cleanedName);
    row.client_name = fixedName;

    const inferred = inferPrice(row.service, row.duration, row.price);
    if (Number(row.price || 0) !== inferred) {
      row.price = String(inferred);
      apptsPriceUpdated += 1;
      if (!row.notes_cleanup) row.notes_cleanup = "auto: inferred/normalized price";
    }
  }

  writeCsv(clientsFile, clientsCsv.header, clientsCsv.rows, clientsCsv.delimiter);
  writeCsv(appointmentsFile, apptsCsv.header, apptsCsv.rows, apptsCsv.delimiter);

  const summary = {
    export_dir: exportDir,
    backups: {
      clients: `${clientsFile}.bak-before-finalize`,
      appointments: `${appointmentsFile}.bak-before-finalize`,
    },
    changes: {
      clients_auto_drop: clientsAutoDrop,
      clients_merged: clientsMerged,
      appointments_auto_drop: apptsAutoDrop,
      appointments_price_updated: apptsPriceUpdated,
    },
  };
  fs.writeFileSync(path.join(exportDir, "finalize_cleanup_summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
