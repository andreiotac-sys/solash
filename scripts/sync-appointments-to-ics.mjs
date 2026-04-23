import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const rawArgs = process.argv.slice(2);
const APPLY = rawArgs.includes("--apply");
const CLEAN_SLOT_DUPLICATES = rawArgs.includes("--clean-slot-duplicates");
const positional = rawArgs.filter((arg) => !arg.startsWith("--"));
const ICS_FILE = positional[0] ? path.resolve(ROOT, positional[0]) : path.resolve(ROOT, "data-domiciliu.ics");
const MAP_FILE = positional[1]
  ? path.resolve(ROOT, positional[1])
  : path.resolve(ROOT, "import_map_nume_cliente_final_pentru_import.csv");
const FROM_DATE = "2023-01-01";
const CLIENT_NAME_OVERRIDES = new Map([
  ["mama eve", "eve"],
  ["eve", "eve"],
]);

const INVALID_SUMMARY_PATTERNS = [
  /\bprogramare\s+buletin\b/i,
  /\bbuletin\b/i,
  /\bunghii\b/i,
  /\bmanichi(?:ura|ură)?\b/i,
  /\btaiere\s+mot\b/i,
  /\bmot\b/i,
  /\bcurs\b/i,
  /\bpedi\b/i,
  /\bmani\s*peri\b/i,
  /\bluna\s+[a-zăâîșț]+/i,
  /\b(11\s*590|11\s*440|14\s*925|14\s*990|12\s*720)\b/i,
  /^\s*\d[\d\s.,]*\s*lei\b/i,
];

const INVALID_CLIENT_PATTERNS = [
  /^\s*\d[\d\s.,]*\s*(lei)?\s*$/i,
  /\blei\b/i,
  /\bprogramare\b/i,
  /\bbuletin\b/i,
  /\bunghii\b/i,
  /\bmanichi(?:ura|ură)?\b/i,
  /\btaiere\s+mot\b/i,
  /\bcurs\b/i,
  /\bpedi\b/i,
  /\bmani\s*peri\b/i,
];

function loadEnvLocal() {
  const envPath = path.resolve(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const row of text.split(/\r?\n/)) {
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
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
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

function parseAliasMapCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = parseCsvLine(lines[0], delimiter);
  const fullIdx = header.indexOf("nume_complet");
  const aliasIdx = header.indexOf("aliasuri_calendar");
  if (fullIdx === -1 || aliasIdx === -1) return [];
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line, delimiter);
    return {
      fullName: (cols[fullIdx] || "").trim(),
      aliases: (cols[aliasIdx] || "")
        .split("|")
        .map((a) => a.trim())
        .filter(Boolean),
    };
  });
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
    const value = line.slice(idx + 1);
    current[key] = value;
  }
  return events;
}

function parseDateTime(rawValue) {
  if (!rawValue) return null;
  const value = rawValue.trim();
  if (/^\d{8}$/.test(value)) return null;
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
    isoDate: `${m[1]}-${m[2]}-${m[3]}`,
    hhmm: `${m[4]}:${m[5]}`,
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

function extractNamePrefix(summary) {
  const cleaned = summary.replace(/\\,/g, ",").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const tokens = cleaned.split(" ");
  const stop = new Set([
    "set",
    "nou",
    "retus",
    "intretinere",
    "intreținere",
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

function hasLetters(value) {
  return /[a-zA-ZăâîșțĂÂÎȘȚ]/.test(value);
}

function isInvalidSummary(summary) {
  const cleaned = (summary || "").trim();
  if (!cleaned) return true;
  if (!hasLetters(cleaned)) return true;
  return INVALID_SUMMARY_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function isInvalidClientName(name) {
  const cleaned = (name || "").trim();
  if (!cleaned) return true;
  if (!hasLetters(cleaned)) return true;
  return INVALID_CLIENT_PATTERNS.some((pattern) => pattern.test(cleaned));
}

async function fetchAll(supabase, table, select, orderDefs = []) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  while (true) {
    let q = supabase.from(table).select(select);
    for (const orderDef of orderDefs) {
      q = q.order(orderDef.col, { ascending: orderDef.asc });
    }
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function run() {
  loadEnvLocal();
  if (!fs.existsSync(ICS_FILE)) throw new Error(`ICS missing: ${ICS_FILE}`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env.");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [services, clients, appointments] = await Promise.all([
    fetchAll(supabase, "services", "name,price", [{ col: "name", asc: true }]),
    fetchAll(supabase, "clients", "id,name,phone,notes", [{ col: "name", asc: true }]),
    fetchAll(
      supabase,
      "appointments",
      "id,client_id,service,appointment_date,start_time,duration,price,status",
      [
        { col: "appointment_date", asc: true },
        { col: "start_time", asc: true },
      ],
    ),
  ]);

  const servicePriceMap = new Map(services.map((s) => [s.name, Number(s.price) || 0]));
  const clientByNorm = new Map(clients.map((c) => [normalize(c.name), c]));
  const aliasToCanonical = new Map();
  if (fs.existsSync(MAP_FILE)) {
    const aliasRows = parseAliasMapCsv(fs.readFileSync(MAP_FILE, "utf8"));
    for (const row of aliasRows) {
      const canonical = normalize(row.fullName);
      if (!canonical) continue;
      aliasToCanonical.set(canonical, canonical);
      for (const alias of row.aliases) {
        const a = normalize(alias);
        if (!a) continue;
        aliasToCanonical.set(a, canonical);
      }
    }
  }

  const events = parseIcsEvents(fs.readFileSync(ICS_FILE, "utf8"));
  const expectedBySlot = new Map();
  const invalidSlotSummaries = new Map();

  let skippedNoTime = 0;
  let skippedBeforeRange = 0;
  let skippedNonClientRows = 0;
  let dupInIcs = 0;
  const clientsToCreate = new Map();

  for (const ev of events) {
    const summary = (ev.SUMMARY || "").trim();
    const start = parseDateTime(ev.DTSTART || "");
    const end = parseDateTime(ev.DTEND || "");
    if (!start || !end) {
      skippedNoTime += 1;
      continue;
    }
    if (start.isoDate < FROM_DATE) {
      skippedBeforeRange += 1;
      continue;
    }

    if (isInvalidSummary(summary)) {
      const slotKey = `${start.isoDate}|${start.hhmm}`;
      invalidSlotSummaries.set(slotKey, summary);
      skippedNonClientRows += 1;
      continue;
    }

    const slotKey = `${start.isoDate}|${start.hhmm}`;
    if (expectedBySlot.has(slotKey)) {
      dupInIcs += 1;
      continue;
    }

    const rawClientName = extractNamePrefix(summary).trim();
    if (!rawClientName || !hasLetters(rawClientName)) {
      skippedNonClientRows += 1;
      continue;
    }

    const durationMins = Math.max(15, Math.round((end.jsDate.getTime() - start.jsDate.getTime()) / 60000));
    const duration = formatDurationFromMinutes(durationMins);
    const service = detectService(summary);
    const price = parsePrice(summary) ?? (servicePriceMap.get(service) ?? 0);

    let parsedNorm = normalize(rawClientName);
    const directOverride = CLIENT_NAME_OVERRIDES.get(parsedNorm);
    const hasForcedOverride = Boolean(directOverride);
    if (directOverride) {
      parsedNorm = directOverride;
    }
    if (parsedNorm.startsWith("mama ") || parsedNorm.startsWith("tata ")) {
      const stripped = parsedNorm.replace(/^(mama|tata)\s+/, "").trim();
      if (stripped && clientByNorm.has(stripped)) {
        parsedNorm = stripped;
      }
    }
    const canonicalNorm = hasForcedOverride
      ? parsedNorm
      : aliasToCanonical.get(parsedNorm) ?? parsedNorm;
    const targetNorm = clientByNorm.has(canonicalNorm) ? canonicalNorm : parsedNorm;
    const existingClient = clientByNorm.get(targetNorm) ?? null;
    if (!existingClient) clientsToCreate.set(targetNorm, rawClientName);

    expectedBySlot.set(slotKey, {
      slotKey,
      isoDate: start.isoDate,
      hhmm: start.hhmm,
      clientNorm: targetNorm,
      rawClientName,
      clientId: existingClient?.id ?? null,
      service,
      duration,
      price,
      status: "Confirmata",
      summary,
    });
  }

  const createdClients = [];
  if (APPLY && clientsToCreate.size > 0) {
    for (const [normKey, rawName] of clientsToCreate.entries()) {
      if (clientByNorm.has(normKey)) continue;
      const payload = { name: rawName.slice(0, 120), phone: "", notes: "Creat automat din calendar (sync)" };
      const { data, error } = await supabase.from("clients").insert(payload).select("id,name,phone,notes").single();
      if (error) throw error;
      clientByNorm.set(normKey, data);
      createdClients.push(data.name);
    }
  }

  for (const [slotKey, expected] of expectedBySlot.entries()) {
    if (!expected.clientId) {
      const c = clientByNorm.get(expected.clientNorm);
      if (c) expected.clientId = c.id;
    }
    expectedBySlot.set(slotKey, expected);
  }

  const bySlot = new Map();
  for (const appt of appointments) {
    if (appt.appointment_date < FROM_DATE) continue;
    const slotKey = `${appt.appointment_date}|${String(appt.start_time).slice(0, 5)}`;
    if (!bySlot.has(slotKey)) bySlot.set(slotKey, []);
    bySlot.get(slotKey).push(appt);
  }

  let toInsert = 0;
  let toUpdate = 0;
  let unchanged = 0;
  let stillNoClient = 0;
  let slotDuplicateRows = 0;
  let toDeleteSlotExtras = 0;
  const insertRows = [];
  const updates = [];
  const deleteIds = [];
  const invalidAppointmentDeleteIds = [];
  const invalidAppointmentExamples = [];
  const mismatchExamples = [];

  for (const [slotKey, summary] of invalidSlotSummaries.entries()) {
    const rows = bySlot.get(slotKey) || [];
    for (const row of rows) {
      invalidAppointmentDeleteIds.push(row.id);
    }
    if (rows.length > 0 && invalidAppointmentExamples.length < 30) {
      invalidAppointmentExamples.push({ slot: slotKey, summary, deleted_rows: rows.length });
    }
  }

  for (const [slotKey, expected] of expectedBySlot.entries()) {
    const rows = bySlot.get(slotKey) || [];
    if (!expected.clientId) {
      stillNoClient += 1;
      if (mismatchExamples.length < 30) mismatchExamples.push({ slot: slotKey, reason: "client_not_resolved", summary: expected.summary });
      continue;
    }

    if (rows.length === 0) {
      toInsert += 1;
      insertRows.push({
        client_id: expected.clientId,
        service: expected.service,
        appointment_date: expected.isoDate,
        start_time: `${expected.hhmm}:00`,
        duration: expected.duration,
        price: expected.price,
        status: expected.status,
      });
      continue;
    }

    if (rows.length > 1) {
      slotDuplicateRows += rows.length - 1;
    }

    const chosen = rows.find((r) => Number(r.client_id) === Number(expected.clientId)) || rows[0];
    const patch = {};
    if (Number(chosen.client_id) !== Number(expected.clientId)) patch.client_id = expected.clientId;
    if ((chosen.service || "") !== expected.service) patch.service = expected.service;
    if ((chosen.duration || "") !== expected.duration) patch.duration = expected.duration;
    if (Number(chosen.price || 0) !== Number(expected.price || 0)) patch.price = expected.price;
    if ((chosen.status || "") !== expected.status) patch.status = expected.status;

    if (Object.keys(patch).length === 0) {
      unchanged += 1;
    } else {
      toUpdate += 1;
      updates.push({ id: chosen.id, patch });
      if (mismatchExamples.length < 30) mismatchExamples.push({ slot: slotKey, reason: "field_mismatch", summary: expected.summary, patch });
    }

    if (CLEAN_SLOT_DUPLICATES && rows.length > 1) {
      for (const row of rows) {
        if (row.id === chosen.id) continue;
        toDeleteSlotExtras += 1;
        deleteIds.push(row.id);
      }
    }
  }

  if (APPLY) {
    const chunk = 300;
    for (let i = 0; i < insertRows.length; i += chunk) {
      const part = insertRows.slice(i, i + chunk);
      if (part.length === 0) continue;
      const { error } = await supabase.from("appointments").insert(part);
      if (error) throw error;
    }
    for (const u of updates) {
      const { error } = await supabase.from("appointments").update(u.patch).eq("id", u.id);
      if (error) throw error;
    }
    if (CLEAN_SLOT_DUPLICATES) {
      for (let i = 0; i < deleteIds.length; i += chunk) {
        const part = deleteIds.slice(i, i + chunk);
        if (part.length === 0) continue;
        const { error } = await supabase.from("appointments").delete().in("id", part);
        if (error) throw error;
      }
    }

    if (invalidAppointmentDeleteIds.length > 0) {
      const chunk = 300;
      for (let i = 0; i < invalidAppointmentDeleteIds.length; i += chunk) {
        const part = invalidAppointmentDeleteIds.slice(i, i + chunk);
        if (part.length === 0) continue;
        const { error } = await supabase.from("appointments").delete().in("id", part);
        if (error) throw error;
      }
    }

    const allAppointmentsAfter = await fetchAll(supabase, "appointments", "id,client_id,appointment_date", [
      { col: "appointment_date", asc: true },
    ]);
    const activeClientIds = new Set(allAppointmentsAfter.map((row) => Number(row.client_id)));
    const invalidClientIds = clients
      .filter((client) => isInvalidClientName(client.name))
      .filter((client) => !activeClientIds.has(Number(client.id)))
      .map((client) => Number(client.id));

    if (invalidClientIds.length > 0) {
      const chunk = 300;
      for (let i = 0; i < invalidClientIds.length; i += chunk) {
        const part = invalidClientIds.slice(i, i + chunk);
        const { error } = await supabase.from("clients").delete().in("id", part);
        if (error) throw error;
      }
    }
  }

  let invalidClientsWithoutAppointments = 0;
  if (!APPLY) {
    const allAppointmentsAfter = appointments.filter((row) => row.appointment_date >= FROM_DATE);
    const activeClientIds = new Set(allAppointmentsAfter.map((row) => Number(row.client_id)));
    invalidClientsWithoutAppointments = clients
      .filter((client) => isInvalidClientName(client.name))
      .filter((client) => !activeClientIds.has(Number(client.id))).length;
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        clean_slot_duplicates: CLEAN_SLOT_DUPLICATES,
        ics_file: ICS_FILE,
        range_from: FROM_DATE,
        calendar_events_total: events.length,
        expected_slots: expectedBySlot.size,
        skipped_no_time: skippedNoTime,
        skipped_before_range: skippedBeforeRange,
        skipped_non_client_rows: skippedNonClientRows,
        duplicate_slots_in_ics: dupInIcs,
        invalid_slots_marked_for_delete: invalidSlotSummaries.size,
        invalid_appointments_to_delete: invalidAppointmentDeleteIds.length,
        unknown_clients_created: createdClients.length,
        still_no_client_after_create: stillNoClient,
        to_insert: toInsert,
        to_update: toUpdate,
        unchanged: unchanged,
        slot_duplicate_rows_detected: slotDuplicateRows,
        to_delete_slot_extras: toDeleteSlotExtras,
        invalid_clients_without_appointments:
          APPLY ? "applied_cleanup" : invalidClientsWithoutAppointments,
        invalid_appointment_examples: invalidAppointmentExamples,
        mismatch_examples: mismatchExamples,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : util.inspect(error, { depth: 6, colors: false });
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
