import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DEFAULT_ICS = "/Users/andreiotac/Desktop/Domiciliu.ics";
const DEFAULT_ALIAS_CSV = "import_map_nume_cliente_final_pentru_import.csv";

const ICS_FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : DEFAULT_ICS;
const ALIAS_FILE = process.argv[3] ? path.resolve(ROOT, process.argv[3]) : path.resolve(ROOT, DEFAULT_ALIAS_CSV);

function loadEnvLocal() {
  const envPath = path.resolve(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const txt = fs.readFileSync(envPath, "utf8");
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
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
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
      continue;
    }
    out.push(line);
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
    const left = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = left.split(";")[0];
    current[key] = value;
  }

  return events;
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
      out.push(current.trim());
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }
  out.push(current.trim());
  return out;
}

function parseAliasCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = parseCsvLine(lines[0], delimiter);

  const fullIdx = header.indexOf("nume_complet");
  const aliasIdx = header.indexOf("aliasuri_calendar");
  if (fullIdx === -1 || aliasIdx === -1) {
    throw new Error("Alias CSV invalid. Expected columns: nume_complet,aliasuri_calendar");
  }

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line, delimiter);
    return {
      fullName: (cols[fullIdx] || "").trim(),
      aliases: (cols[aliasIdx] || "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  });
}

function parseDateTime(rawValue) {
  if (!rawValue) return null;
  const value = rawValue.trim();

  const isDateOnly = /^\d{8}$/.test(value);
  if (isDateOnly) return null;

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(value);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  const jsDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  return {
    jsDate,
    isoDate: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
    hhmm: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
  };
}

function formatDurationFromMinutes(totalMinutes) {
  const m = Math.max(15, Math.round(totalMinutes / 5) * 5);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}min`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}min`;
}

function parsePrice(text) {
  const nums = [...text.matchAll(/\b(\d{2,4})\b/g)].map((m) => Number(m[1]));
  const valid = nums.filter((n) => n >= 30 && n <= 1000);
  return valid.length ? valid[valid.length - 1] : null;
}

function detectService(summary) {
  const t = normalize(summary);
  const hasSetNou = t.includes("set nou") || t.includes("set") || t.includes("new set");
  const hasIntretinere = t.includes("intretinere") || t.includes("retus") || t.includes("fill");

  if (t.includes("demont")) return "Demontare extensii";
  if (t.includes("mega")) return hasSetNou && !hasIntretinere ? "Mega Volum (set nou)" : "Mega Volum (întreținere)";
  if (t.includes("russian") || t.includes("rusian")) {
    return hasSetNou && !hasIntretinere ? "Russian Volum (set nou)" : "Russian Volum (întreținere)";
  }
  if (t.includes("natural")) return hasSetNou && !hasIntretinere ? "Natural volum (set nou)" : "Natural  volum (întreținere)";
  return "Programare importata";
}

function safeBoundary(text, alias) {
  if (!text.startsWith(alias)) return false;
  if (text.length === alias.length) return true;
  const next = text[alias.length];
  return next === " " || next === "-" || next === "," || next === "." || next === "/" || next === "(";
}

async function run() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  if (!fs.existsSync(ICS_FILE)) throw new Error(`ICS file not found: ${ICS_FILE}`);
  if (!fs.existsSync(ALIAS_FILE)) throw new Error(`Alias file not found: ${ALIAS_FILE}`);

  const icsRaw = fs.readFileSync(ICS_FILE, "utf8");
  const aliasRows = parseAliasCsv(fs.readFileSync(ALIAS_FILE, "utf8"));
  const events = parseIcsEvents(icsRaw);

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: clients, error: clientsError }, { data: services, error: servicesError }, { data: existingAppointments, error: appError }] =
    await Promise.all([
      supabase.from("clients").select("id,name,phone"),
      supabase.from("services").select("name,price"),
      supabase.from("appointments").select("client_id,appointment_date,start_time"),
    ]);

  if (clientsError) throw clientsError;
  if (servicesError) throw servicesError;
  if (appError) throw appError;

  const servicePriceMap = new Map((services || []).map((s) => [s.name, Number(s.price) || 0]));

  const clientsByNormalized = new Map();
  for (const c of clients || []) {
    clientsByNormalized.set(normalize(c.name), c);
  }

  const aliasToClient = new Map();
  for (const row of aliasRows) {
    const client = clientsByNormalized.get(normalize(row.fullName));
    if (!client) continue;

    aliasToClient.set(normalize(row.fullName), client);
    for (const alias of row.aliases) {
      aliasToClient.set(normalize(alias), client);
    }
  }

  const sortedAliases = [...aliasToClient.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  const existingKeys = new Set(
    (existingAppointments || []).map((a) => `${a.client_id}|${a.appointment_date}|${String(a.start_time).slice(0, 5)}`),
  );

  let supportsAppointmentNotes = true;
  const notesProbe = await supabase.from("appointments").select("notes").limit(1);
  if (notesProbe.error && (notesProbe.error.code === "PGRST204" || String(notesProbe.error.message || "").includes("'notes' column"))) {
    supportsAppointmentNotes = false;
  }

  const toInsert = [];
  let skippedNoSummary = 0;
  let skippedNoTime = 0;
  let skippedNoClient = 0;
  let skippedDuplicate = 0;

  const unmatchedExamples = [];

  for (const ev of events) {
    const summary = (ev.SUMMARY || "").trim();
    if (!summary) {
      skippedNoSummary += 1;
      continue;
    }

    const start = parseDateTime(ev.DTSTART || "");
    const end = parseDateTime(ev.DTEND || "");
    if (!start || !end) {
      skippedNoTime += 1;
      continue;
    }

    const summaryNorm = normalize(summary);
    let client = null;
    let matchedAlias = "";

    for (const alias of sortedAliases) {
      if (safeBoundary(summaryNorm, alias)) {
        client = aliasToClient.get(alias) || null;
        matchedAlias = alias;
        break;
      }
    }

    if (!client) {
      for (const [nName, c] of clientsByNormalized.entries()) {
        if (safeBoundary(summaryNorm, nName)) {
          client = c;
          matchedAlias = nName;
          break;
        }
      }
    }

    if (!client) {
      skippedNoClient += 1;
      if (unmatchedExamples.length < 40) unmatchedExamples.push(summary);
      continue;
    }

    const diffMinutes = Math.max(15, Math.round((end.jsDate.getTime() - start.jsDate.getTime()) / 60000));
    const duration = formatDurationFromMinutes(diffMinutes);
    const service = detectService(summary);
    const parsedPrice = parsePrice(summary);
    const fallbackPrice = servicePriceMap.get(service) ?? 0;
    const price = parsedPrice ?? fallbackPrice;

    const dedupeKey = `${client.id}|${start.isoDate}|${start.hhmm}`;
    if (existingKeys.has(dedupeKey)) {
      skippedDuplicate += 1;
      continue;
    }
    existingKeys.add(dedupeKey);

    const payload = {
      client_id: client.id,
      service,
      appointment_date: start.isoDate,
      start_time: `${start.hhmm}:00`,
      duration,
      price,
      status: "Confirmata",
    };

    if (supportsAppointmentNotes) {
      payload.notes = `Import ICS (${matchedAlias || "match nume"}): ${summary}`.slice(0, 1000);
    }

    toInsert.push(payload);
  }

  let inserted = 0;
  const chunkSize = 300;
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    let { error } = await supabase.from("appointments").insert(chunk);
    if (error && String(error.message || "").includes("'notes' column")) {
      supportsAppointmentNotes = false;
      const noNotesChunk = chunk.map((item) => {
        const copy = { ...item };
        delete copy.notes;
        return copy;
      });
      const retry = await supabase.from("appointments").insert(noNotesChunk);
      error = retry.error;
    }
    if (error) throw error;
    inserted += chunk.length;
  }

  console.log(
    JSON.stringify(
      {
        ics_file: ICS_FILE,
        alias_file: ALIAS_FILE,
        vevents_total: events.length,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_no_summary: skippedNoSummary,
        skipped_no_time: skippedNoTime,
        skipped_no_client_match: skippedNoClient,
        supports_appointment_notes: supportsAppointmentNotes,
        unmatched_examples: unmatchedExamples,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : util.inspect(error, { depth: 5, colors: false });
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
