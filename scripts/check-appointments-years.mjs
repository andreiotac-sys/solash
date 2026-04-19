import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Missing env vars");
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const pageSize = 1000;
let from = 0;
let all = [];

while (true) {
  const to = from + pageSize - 1;
  const { data, error } = await supabase
    .from("appointments")
    .select("appointment_date")
    .order("appointment_date", { ascending: true })
    .range(from, to);
  if (error) throw error;
  const rows = data || [];
  all = all.concat(rows);
  if (rows.length < pageSize) break;
  from += pageSize;
}

const years = {};
let min = "9999-99-99";
let max = "0000-00-00";

for (const row of all) {
  const date = row.appointment_date;
  if (!date) continue;
  const year = date.slice(0, 4);
  years[year] = (years[year] || 0) + 1;
  if (date < min) min = date;
  if (date > max) max = date;
}

console.log(
  JSON.stringify(
    {
      total: all.length,
      min,
      max,
      years,
    },
    null,
    2,
  ),
);
