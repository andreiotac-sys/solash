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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const totalRes = await supabase.from("appointments").select("id", { count: "exact", head: true });
if (totalRes.error) throw totalRes.error;
const zeroRes = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("price", 0);
if (zeroRes.error) throw zeroRes.error;

console.log(
  JSON.stringify(
    {
      total_appointments: totalRes.count ?? 0,
      zero_price_appointments: zeroRes.count ?? 0,
      non_zero_price_appointments: Math.max(0, (totalRes.count ?? 0) - (zeroRes.count ?? 0)),
    },
    null,
    2,
  ),
);
