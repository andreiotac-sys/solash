import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();

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

function timestampLabel() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const dd = `${now.getDate()}`.padStart(2, "0");
  const hh = `${now.getHours()}`.padStart(2, "0");
  const mi = `${now.getMinutes()}`.padStart(2, "0");
  const ss = `${now.getSeconds()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}-${mi}-${ss}`;
}

function csvEscape(value) {
  const v = value == null ? "" : String(value);
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, "\"\"")}"`;
  }
  return v;
}

function toCsv(rows, columns) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((col) => csvEscape(row[col])).join(","));
  return [header, ...body].join("\n");
}

async function fetchAll(supabase, table, select, orderDefs = []) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    let q = supabase.from(table).select(select);
    for (const orderDef of orderDefs) {
      q = q.order(orderDef.col, { ascending: orderDef.asc });
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
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [clients, services, appointments, appointmentsNoNotes] = await Promise.all([
    fetchAll(supabase, "clients", "id,name,phone,notes,visits,last_visit_label,created_at", [{ col: "id", asc: true }]),
    fetchAll(supabase, "services", "id,name,duration,price,active,created_at", [{ col: "id", asc: true }]),
    fetchAll(
      supabase,
      "appointments",
      "id,client_id,service,appointment_date,start_time,duration,price,status,notes,created_at",
      [{ col: "id", asc: true }],
    ).catch(() => null),
    fetchAll(
      supabase,
      "appointments",
      "id,client_id,service,appointment_date,start_time,duration,price,status,created_at",
      [{ col: "id", asc: true }],
    ),
  ]);
  const appointmentsWithClient = await fetchAll(
    supabase,
    "appointments",
    "id,client_id,service,appointment_date,start_time,duration,price,status,created_at,clients(name,phone)",
    [{ col: "id", asc: true }],
  ).catch(() => []);

  const finalAppointments = appointments ?? appointmentsNoNotes;
  const hasNotes = Boolean(appointments);

  const exportDir = path.join(ROOT, "exports", `supabase-${timestampLabel()}`);
  fs.mkdirSync(exportDir, { recursive: true });

  fs.writeFileSync(
    path.join(exportDir, "clients.csv"),
    toCsv(clients, ["id", "name", "phone", "notes", "visits", "last_visit_label", "created_at"]),
    "utf8",
  );
  fs.writeFileSync(
    path.join(exportDir, "services.csv"),
    toCsv(services, ["id", "name", "duration", "price", "active", "created_at"]),
    "utf8",
  );

  const appointmentColumns = hasNotes
    ? ["id", "client_id", "service", "appointment_date", "start_time", "duration", "price", "status", "notes", "created_at"]
    : ["id", "client_id", "service", "appointment_date", "start_time", "duration", "price", "status", "created_at"];

  fs.writeFileSync(path.join(exportDir, "appointments.csv"), toCsv(finalAppointments, appointmentColumns), "utf8");

  const apptCleanupRows = (appointmentsWithClient || []).map((row) => ({
    id: row.id,
    appointment_date: row.appointment_date,
    start_time: row.start_time,
    service: row.service,
    duration: row.duration,
    price: row.price,
    status: row.status,
    client_name: row.clients?.name ?? "",
    client_phone: row.clients?.phone ?? "",
    created_at: row.created_at,
    keep: 1,
    notes_cleanup: "",
  }));
  fs.writeFileSync(
    path.join(exportDir, "appointments_cleanup.csv"),
    toCsv(apptCleanupRows, [
      "id",
      "appointment_date",
      "start_time",
      "service",
      "duration",
      "price",
      "status",
      "client_name",
      "client_phone",
      "created_at",
      "keep",
      "notes_cleanup",
    ]),
    "utf8",
  );

  const clientCleanupRows = clients.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes ?? "",
    visits: row.visits ?? 0,
    keep: 1,
    merge_into_name: "",
    merge_into_phone: "",
    notes_cleanup: "",
  }));
  fs.writeFileSync(
    path.join(exportDir, "clients_cleanup.csv"),
    toCsv(clientCleanupRows, [
      "id",
      "name",
      "phone",
      "notes",
      "visits",
      "keep",
      "merge_into_name",
      "merge_into_phone",
      "notes_cleanup",
    ]),
    "utf8",
  );

  const summary = {
    export_dir: exportDir,
    counts: {
      clients: clients.length,
      services: services.length,
      appointments: finalAppointments.length,
    },
    has_appointments_notes_column: hasNotes,
  };

  fs.writeFileSync(path.join(exportDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
