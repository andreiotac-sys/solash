import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const rawArgs = process.argv.slice(2);
const APPLY = rawArgs.includes("--apply");
const positional = rawArgs.filter((arg) => !arg.startsWith("--"));
const CLIENTS_CSV = positional[0];
const APPOINTMENTS_CSV = positional[1];

if (!CLIENTS_CSV || !APPOINTMENTS_CSV) {
  console.error("Usage: node scripts/reset-and-import-from-clean-csv.mjs <clients_cleanup.csv> <appointments_cleanup.csv> [--apply]");
  process.exit(1);
}

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
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

function normPhone(value) {
  const d = (value || "").replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("4") && d.length === 10) return d;
  if (d.startsWith("40") && d.length === 11) return d.slice(1);
  if (d.length === 9) return `4${d}`;
  if (d.length > 10) return d.slice(-10);
  return d;
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

function parseCsv(filePath) {
  const abs = path.resolve(ROOT, filePath);
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = parseCsvLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line, delimiter);
    const row = {};
    for (let i = 0; i < header.length; i += 1) row[header[i]] = cols[i] ?? "";
    return row;
  });
}

async function run() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars.");

  const clientRowsRaw = parseCsv(CLIENTS_CSV);
  const apptRowsRaw = parseCsv(APPOINTMENTS_CSV);

  const keptClientRows = clientRowsRaw.filter((row) => String(row.keep || "1").trim() !== "0");
  const keptApptRows = apptRowsRaw.filter((row) => String(row.keep || "1").trim() !== "0");

  const mergedClients = [];
  const byKey = new Map();
  for (const row of keptClientRows) {
    const srcName = (row.name || "").trim();
    const srcPhone = normPhone(row.phone || "");
    const targetName = (row.merge_into_name || "").trim() || srcName;
    const targetPhone = normPhone((row.merge_into_phone || "").trim() || srcPhone);
    if (!targetName) continue;
    const key = `${normalize(targetName)}|${targetPhone}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        name: targetName,
        phone: targetPhone || "",
        notes: (row.notes || "").trim(),
      });
    } else {
      const prev = byKey.get(key);
      if (!prev.phone && targetPhone) prev.phone = targetPhone;
      if (row.notes && !prev.notes.includes(row.notes)) {
        prev.notes = prev.notes ? `${prev.notes} | ${row.notes}` : row.notes;
      }
      byKey.set(key, prev);
    }
  }
  mergedClients.push(...byKey.values());

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const apptNotesProbe = await supabase.from("appointments").select("notes").limit(1);
  const supportsApptNotes = !apptNotesProbe.error;

  if (!APPLY) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          input_counts: { clients_rows: clientRowsRaw.length, appointments_rows: apptRowsRaw.length },
          kept_counts: { clients: keptClientRows.length, appointments: keptApptRows.length },
          deduped_clients: mergedClients.length,
          supports_appointments_notes: supportsApptNotes,
        },
        null,
        2,
      ),
    );
    return;
  }

  // 1) wipe appointments then clients
  let deletedAppointments = 0;
  while (true) {
    const { data, error } = await supabase.from("appointments").select("id").range(0, 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    const ids = data.map((r) => r.id);
    const del = await supabase.from("appointments").delete().in("id", ids);
    if (del.error) throw del.error;
    deletedAppointments += ids.length;
  }

  let deletedClients = 0;
  while (true) {
    const { data, error } = await supabase.from("clients").select("id").range(0, 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    const ids = data.map((r) => r.id);
    const del = await supabase.from("clients").delete().in("id", ids);
    if (del.error) throw del.error;
    deletedClients += ids.length;
  }

  // 2) insert clients
  const insertedClients = [];
  const chunk = 300;
  for (let i = 0; i < mergedClients.length; i += chunk) {
    const part = mergedClients.slice(i, i + chunk).map((c) => ({
      name: c.name,
      phone: c.phone || "",
      notes: c.notes || "",
    }));
    const ins = await supabase.from("clients").insert(part).select("id,name,phone");
    if (ins.error) throw ins.error;
    insertedClients.push(...(ins.data || []));
  }

  const clientMapByNamePhone = new Map();
  const clientMapByName = new Map();
  for (const c of insertedClients) {
    const key = `${normalize(c.name)}|${normPhone(c.phone)}`;
    clientMapByNamePhone.set(key, c);
    if (!clientMapByName.has(normalize(c.name))) clientMapByName.set(normalize(c.name), c);
  }

  // 3) insert appointments
  const apptsToInsert = [];
  let skippedNoClient = 0;
  for (const row of keptApptRows) {
    const date = (row.appointment_date || "").trim();
    const time = (row.start_time || "").trim();
    const service = (row.service || "").trim();
    const duration = (row.duration || "").trim();
    const status = (row.status || "").trim() || "Confirmata";
    const price = Number((row.price || "0").toString().replace(",", "."));
    const clientName = (row.client_name || "").trim();
    const clientPhone = normPhone((row.client_phone || "").trim());
    if (!date || !time || !service || !duration || !clientName) continue;

    const key = `${normalize(clientName)}|${clientPhone}`;
    const client = clientMapByNamePhone.get(key) || clientMapByName.get(normalize(clientName));
    if (!client) {
      skippedNoClient += 1;
      continue;
    }

    const payload = {
      client_id: client.id,
      service,
      appointment_date: date,
      start_time: time.length === 5 ? `${time}:00` : time,
      duration,
      price: Number.isFinite(price) ? Math.round(price) : 0,
      status,
    };
    if (supportsApptNotes && row.notes) payload.notes = row.notes;
    apptsToInsert.push(payload);
  }

  let insertedAppointments = 0;
  for (let i = 0; i < apptsToInsert.length; i += chunk) {
    const part = apptsToInsert.slice(i, i + chunk);
    const ins = await supabase.from("appointments").insert(part);
    if (ins.error) throw ins.error;
    insertedAppointments += part.length;
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        deleted: { appointments: deletedAppointments, clients: deletedClients },
        inserted: { clients: insertedClients.length, appointments: insertedAppointments },
        skipped_appointments_without_client_match: skippedNoClient,
        supports_appointments_notes: supportsApptNotes,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : util.inspect(error, { depth: 5, colors: false }));
  process.exit(1);
});
