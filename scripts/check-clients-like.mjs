import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const term = process.argv[2];
if (!term) {
  console.error("Usage: node scripts/check-clients-like.mjs <term>");
  process.exit(1);
}

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

const { data, error } = await supabase
  .from("clients")
  .select("id,name,phone")
  .ilike("name", `%${term}%`)
  .order("id", { ascending: true });
if (error) throw error;

for (const client of data || []) {
  const countRes = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id);
  if (countRes.error) throw countRes.error;
  console.log(`${client.id}\t${client.name}\t${client.phone}\tappointments=${countRes.count ?? 0}`);
}
