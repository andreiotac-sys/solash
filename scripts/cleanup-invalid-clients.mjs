import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const INVALID_NAME_RULES = [
  /lei/i,
  /^programare\b/i,
  /\bbuletin\b/i,
  /\bunghii\b/i,
  /\bmanichi(?:ura|ură)?\b/i,
  /\btaiere\s+mot\b/i,
  /\bcurs\b/i,
  /\bpedi\b/i,
  /\bmani\s*peri\b/i,
];

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const rows = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const row of rows) {
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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAllClients() {
  let from = 0;
  const pageSize = 1000;
  const out = [];
  while (true) {
    const { data, error } = await supabase.from("clients").select("id,name").order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function isInvalid(name) {
  const n = (name || "").trim();
  if (!n) return true;
  return INVALID_NAME_RULES.some((rule) => rule.test(n));
}

async function run() {
  const clients = await fetchAllClients();
  const invalidClients = clients.filter((c) => isInvalid(c.name));
  const invalidIds = invalidClients.map((c) => Number(c.id));

  let appointmentCount = 0;
  if (invalidIds.length > 0) {
    const { count, error } = await supabase.from("appointments").select("id", { count: "exact", head: true }).in("client_id", invalidIds);
    if (error) throw error;
    appointmentCount = count ?? 0;
  }

  if (APPLY && invalidIds.length > 0) {
    const chunk = 300;
    for (let i = 0; i < invalidIds.length; i += chunk) {
      const part = invalidIds.slice(i, i + chunk);
      const { error } = await supabase.from("clients").delete().in("id", part);
      if (error) throw error;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        invalid_clients_count: invalidClients.length,
        invalid_appointments_count: appointmentCount,
        invalid_clients: invalidClients.slice(0, 100),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  const msg = error instanceof Error ? error.message : util.inspect(error, { depth: 5, colors: false });
  console.error(`ERROR: ${msg}`);
  process.exit(1);
});
