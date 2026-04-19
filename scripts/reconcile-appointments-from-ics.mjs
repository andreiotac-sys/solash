import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const rawArgs = process.argv.slice(2);
const APPLY = rawArgs.includes("--apply");
const positional = rawArgs.filter((arg) => !arg.startsWith("--"));
const ICS_FILE = positional[0]
  ? path.resolve(ROOT, positional[0])
  : path.resolve(ROOT, "data-domiciliu.ics");
const MAP_FILE = positional[1]
  ? path.resolve(ROOT, positional[1])
  : path.resolve(ROOT, "import_map_nume_cliente_final_pentru_import.csv");

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

function parseCsvLine(line, delimiter) {
  const out = [];
  let current = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (c === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }
    if (c === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += c;
    i += 1;
  }
  out.push(current.trim());
  return out;
}

function parseMapCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = parseCsvLine(lines[0], delimiter);
  const fullIdx = header.indexOf("nume_complet");
  const aliasIdx = header.indexOf("aliasuri_calendar");
  if (fullIdx === -1 || aliasIdx === -1) {
    throw new Error("Mapping CSV must include nume_complet and aliasuri_calendar");
  }
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

function boundaryStartsWith(text, prefix) {
  if (!text.startsWith(prefix)) return false;
  if (text.length === prefix.length) return true;
  const next = text[prefix.length];
  return next === " " || next === "-" || next === "," || next === "." || next === "/" || next === "(";
}

async function fetchAll(supabase, table, select, orderDefs = []) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    let q = supabase.from(table).select(select);
    for (const def of orderDefs) {
      q = q.order(def.col, { ascending: def.asc });
    }
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function run() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");
  if (!fs.existsSync(ICS_FILE)) throw new Error(`ICS missing: ${ICS_FILE}`);
  if (!fs.existsSync(MAP_FILE)) throw new Error(`Map CSV missing: ${MAP_FILE}`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [services, clients, appointments] = await Promise.all([
    fetchAll(supabase, "services", "name,price", [{ col: "name", asc: true }]),
    fetchAll(supabase, "clients", "id,name,phone", [{ col: "name", asc: true }]),
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

  const supportsNotes = false;

  const servicePriceMap = new Map(services.map((s) => [s.name, Number(s.price) || 0]));
  const clientByNorm = new Map(clients.map((c) => [normalize(c.name), c]));

  const mapRows = parseMapCsv(fs.readFileSync(MAP_FILE, "utf8"));
  const aliasToClient = new Map();
  for (const row of mapRows) {
    const client = clientByNorm.get(normalize(row.fullName));
    if (!client) continue;
    aliasToClient.set(normalize(row.fullName), client);
    for (const alias of row.aliases) {
      aliasToClient.set(normalize(alias), client);
    }
  }
  const aliasesSorted = [...aliasToClient.keys()].filter(Boolean).sort((a, b) => b.length - a.length);

  const byKey = new Map();
  for (const appt of appointments) {
    const keyStr = `${appt.appointment_date}|${String(appt.start_time).slice(0, 5)}`;
    if (!byKey.has(keyStr)) byKey.set(keyStr, []);
    byKey.get(keyStr).push(appt);
  }

  const events = parseIcsEvents(fs.readFileSync(ICS_FILE, "utf8"));
  const expectedByKey = new Map();
  let skippedNoTime = 0;
  let ignoredBefore2023 = 0;
  let duplicateIcsSlots = 0;

  const unknownClientsToCreate = new Map();

  for (const ev of events) {
    const summary = (ev.SUMMARY || "").trim();
    const start = parseDateTime(ev.DTSTART || "");
    const end = parseDateTime(ev.DTEND || "");
    if (!start || !end) {
      skippedNoTime += 1;
      continue;
    }
    if (start.isoDate < "2023-01-01") {
      ignoredBefore2023 += 1;
      continue;
    }

    const keyStr = `${start.isoDate}|${start.hhmm}`;
    if (expectedByKey.has(keyStr)) {
      duplicateIcsSlots += 1;
      continue;
    }

    const summaryNorm = normalize(summary);
    const prefixRaw = extractNamePrefix(summary);
    const prefixNorm = normalize(prefixRaw);

    let matchedClient = null;
    if (prefixNorm && aliasToClient.has(prefixNorm)) {
      matchedClient = aliasToClient.get(prefixNorm);
    }
    if (!matchedClient && prefixNorm && clientByNorm.has(prefixNorm)) {
      matchedClient = clientByNorm.get(prefixNorm);
    }
    if (!matchedClient) {
      for (const alias of aliasesSorted) {
        if (alias.length < 4 && !alias.includes(" ")) continue;
        if (boundaryStartsWith(summaryNorm, alias)) {
          matchedClient = aliasToClient.get(alias);
          break;
        }
      }
    }
    if (!matchedClient && prefixRaw) {
      const keyName = prefixNorm || normalize(summary);
      if (keyName) {
        unknownClientsToCreate.set(keyName, prefixRaw);
      }
    }

    const minutes = Math.max(15, Math.round((end.jsDate.getTime() - start.jsDate.getTime()) / 60000));
    const duration = formatDurationFromMinutes(minutes);
    const service = detectService(summary);
    const fallbackPrice = servicePriceMap.get(service) ?? 0;
    const price = parsePrice(summary) ?? fallbackPrice;

    expectedByKey.set(keyStr, {
      keyStr,
      isoDate: start.isoDate,
      hhmm: start.hhmm,
      clientNorm: matchedClient ? normalize(matchedClient.name) : prefixNorm,
      clientId: matchedClient ? matchedClient.id : null,
      clientNameRaw: matchedClient ? matchedClient.name : prefixRaw || summary,
      service,
      duration,
      price,
      status: "Confirmata",
      summary,
    });
  }

  const createdClients = [];
  if (APPLY && unknownClientsToCreate.size > 0) {
    for (const [normKey, rawName] of unknownClientsToCreate.entries()) {
      if (clientByNorm.has(normKey)) continue;
      const payload = { name: rawName.slice(0, 120), phone: "", notes: "Creat automat din import calendar" };
      const { data, error } = await supabase.from("clients").insert(payload).select("id,name,phone").single();
      if (error) throw error;
      clientByNorm.set(normKey, data);
      createdClients.push(data);
    }

    for (const [keyStr, expected] of expectedByKey.entries()) {
      if (expected.clientId) continue;
      const norm = expected.clientNorm || normalize(expected.clientNameRaw);
      const c = clientByNorm.get(norm);
      if (c) {
        expected.clientId = c.id;
      }
      expectedByKey.set(keyStr, expected);
    }
  }

  let toInsert = 0;
  let toUpdate = 0;
  let unchanged = 0;
  let cannotMapClient = 0;
  let duplicatesInDb = 0;
  const insertRows = [];
  const updateRows = [];
  const badExamples = [];

  for (const [keyStr, expected] of expectedByKey.entries()) {
    const existing = byKey.get(keyStr) || [];
    if (!expected.clientId) {
      cannotMapClient += 1;
      if (badExamples.length < 30) badExamples.push({ key: keyStr, summary: expected.summary, reason: "no_client" });
      continue;
    }

    if (existing.length === 0) {
      toInsert += 1;
      const payload = {
        client_id: expected.clientId,
        service: expected.service,
        appointment_date: expected.isoDate,
        start_time: `${expected.hhmm}:00`,
        duration: expected.duration,
        price: expected.price,
        status: expected.status,
      };
      if (supportsNotes) {
        payload.notes = `Import ICS: ${expected.summary}`.slice(0, 1000);
      }
      insertRows.push(payload);
      continue;
    }

    if (existing.length > 1) {
      duplicatesInDb += existing.length - 1;
    }

    let chosen = existing.find((x) => Number(x.client_id) === Number(expected.clientId)) || existing[0];
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
      updateRows.push({ id: chosen.id, patch });
    }
  }

  if (APPLY) {
    const chunk = 200;
    for (let i = 0; i < insertRows.length; i += chunk) {
      const part = insertRows.slice(i, i + chunk);
      if (part.length === 0) continue;
      const { error } = await supabase.from("appointments").insert(part);
      if (error) throw error;
    }
    for (const row of updateRows) {
      const { error } = await supabase.from("appointments").update(row.patch).eq("id", row.id);
      if (error) throw error;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        files: { ics: ICS_FILE, map: MAP_FILE },
        calendar_events_total: events.length,
        expected_slots_after_filters: expectedByKey.size,
        skipped_no_time: skippedNoTime,
        ignored_before_2023: ignoredBefore2023,
        duplicate_slots_in_ics: duplicateIcsSlots,
        supports_notes_column: supportsNotes,
        unknown_clients_created: createdClients.length,
        cannot_map_client: cannotMapClient,
        to_insert: toInsert,
        to_update: toUpdate,
        unchanged: unchanged,
        duplicate_rows_detected_in_db: duplicatesInDb,
        examples: badExamples,
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
