import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const exportDir = process.argv[2]
  ? path.resolve(ROOT, process.argv[2])
  : path.resolve(ROOT, "exports/supabase-2026-04-20-00-35-21");

const clientsFile = path.join(exportDir, "clients_cleanup.csv");
const appointmentsFile = path.join(exportDir, "appointments_cleanup.csv");

const NON_LASH_PATTERNS = [
  /\btuns\b/i,
  /\bvopsit\b/i,
  /\bcoafat\b/i,
  /\bspal(at|at)\b/i,
  /\bunghii\b/i,
  /\bmani\b/i,
  /\bpedi\b/i,
  /\bmanichiur(a|ă)\b/i,
  /\bsprancene\b/i,
  /\bsprâncene\b/i,
  /\bpensat\b/i,
  /\bbuletin\b/i,
  /\blensa\b/i,
  /\bepilat\b/i,
  /\bmachiaj\b/i,
  /\bcurs\b/i,
  /\btaiere\s+mot\b/i,
  /\btăiere\s+moț\b/i,
  /\btratament\s+par\b/i,
  /\btratament\s+păr\b/i,
  /\bpar\b/i,
  /\bpăr\b/i,
];

const LASH_PATTERNS = [
  /\bgene\b/i,
  /\bvolum\b/i,
  /\bmega\b/i,
  /\brussian\b/i,
  /\brusian\b/i,
  /\bnatural\b/i,
  /\bintretinere\b/i,
  /\bîntreținere\b/i,
  /\bretus\b/i,
  /\bdemontare\b/i,
  /\bextensii\b/i,
  /\blash\b/i,
];

function normalize(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

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
  if (lines.length === 0) return { header: [], rows: [], delimiter: "," };
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

function isMoneyLike(value) {
  const s = normalize(value);
  return /^\d[\d\s.,]*\s*(lei)?$/.test(s) || (/lei/.test(s) && /\d/.test(s));
}

function classifyNonLash(text) {
  const n = normalize(text);
  const hasNonLash = NON_LASH_PATTERNS.some((re) => re.test(n));
  const hasLash = LASH_PATTERNS.some((re) => re.test(n));
  return {
    high: /^(\s*eu\b|\s*programare\b)/i.test(n) || isMoneyLike(n) || (hasNonLash && !hasLash),
    review: hasNonLash && hasLash,
  };
}

function ensureBackup(filePath) {
  const backup = `${filePath}.bak-before-auto-clean`;
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(filePath, backup);
  }
}

function run() {
  if (!fs.existsSync(clientsFile) || !fs.existsSync(appointmentsFile)) {
    throw new Error(`Missing cleanup files in ${exportDir}`);
  }

  ensureBackup(clientsFile);
  ensureBackup(appointmentsFile);

  const clientsCsv = parseCsv(clientsFile);
  const appointmentsCsv = parseCsv(appointmentsFile);

  const eveExists = clientsCsv.rows.some((r) => normalize(r.name) === "eve");

  let clientsKeep0 = 0;
  let clientsReview = 0;
  for (const row of clientsCsv.rows) {
    const name = row.name || "";
    const nonLash = classifyNonLash(name);
    if (normalize(name) === "mama eve") {
      if (eveExists) {
        row.keep = "0";
        row.merge_into_name = "Eve";
        row.notes_cleanup = "auto: merge Mama Eve -> Eve";
        clientsKeep0 += 1;
      } else {
        row.name = "Eve";
        row.notes_cleanup = "auto: rename Mama Eve -> Eve";
      }
      continue;
    }
    if (nonLash.high) {
      row.keep = "0";
      row.notes_cleanup = row.notes_cleanup || "auto: non-lash candidate";
      clientsKeep0 += 1;
    } else if (nonLash.review) {
      row.notes_cleanup = row.notes_cleanup || "review: mixed lash/non-lash terms";
      clientsReview += 1;
    }
  }

  let apptKeep0 = 0;
  let apptReview = 0;
  for (const row of appointmentsCsv.rows) {
    const hay = `${row.client_name || ""} ${row.service || ""}`;
    const nonLash = classifyNonLash(hay);
    if (nonLash.high) {
      row.keep = "0";
      row.notes_cleanup = row.notes_cleanup || "auto: non-lash appointment";
      apptKeep0 += 1;
    } else if (nonLash.review) {
      row.notes_cleanup = row.notes_cleanup || "review: mixed lash/non-lash terms";
      apptReview += 1;
    }
    if (normalize(row.client_name) === "mama eve") {
      row.client_name = "Eve";
      if (!row.notes_cleanup) row.notes_cleanup = "auto: normalize client name Eve";
    }
  }

  writeCsv(clientsFile, clientsCsv.header, clientsCsv.rows, clientsCsv.delimiter);
  writeCsv(appointmentsFile, appointmentsCsv.header, appointmentsCsv.rows, appointmentsCsv.delimiter);

  const summary = {
    export_dir: exportDir,
    files_updated: {
      clients_cleanup: clientsFile,
      appointments_cleanup: appointmentsFile,
    },
    backups: {
      clients: `${clientsFile}.bak-before-auto-clean`,
      appointments: `${appointmentsFile}.bak-before-auto-clean`,
    },
    changes: {
      clients_keep_0_set: clientsKeep0,
      clients_review_flagged: clientsReview,
      appointments_keep_0_set: apptKeep0,
      appointments_review_flagged: apptReview,
    },
  };

  fs.writeFileSync(path.join(exportDir, "auto_cleanup_summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
