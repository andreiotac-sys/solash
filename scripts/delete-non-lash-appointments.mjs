import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const AGGRESSIVE = process.argv.includes("--aggressive");

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
  return (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
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

async function fetchAllAppointments(supabase) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  while (true) {
    const { data, error } = await supabase
      .from("appointments")
      .select("id,appointment_date,start_time,service,status,clients(name)")
      .order("appointment_date", { ascending: true })
      .order("start_time", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function matchesNonLash(row) {
  const clientName = row.clients?.name ?? "";
  const hay = normalize(`${row.service || ""} ${clientName}`);

  const hasNonLash = NON_LASH_PATTERNS.some((re) => re.test(hay));
  const hasLash = LASH_PATTERNS.some((re) => re.test(hay));
  const startsWithMeta = /^\s*(eu|programare)\b/.test(hay);
  const moneyLike = /\b\d{3,}\b/.test(hay) && /\blei\b/.test(hay);
  const noLetters = !/[a-zA-ZăâîșțĂÂÎȘȚ]/.test(clientName || "");

  const highConfidence =
    noLetters ||
    startsWithMeta ||
    moneyLike ||
    (hasNonLash && !hasLash);

  const reviewOnly = hasNonLash && hasLash;

  if (AGGRESSIVE) {
    return highConfidence || reviewOnly;
  }
  return highConfidence;
}

async function run() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env vars.");
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = await fetchAllAppointments(supabase);
  const targets = rows.filter(matchesNonLash);
  const ids = targets.map((r) => r.id);

  if (APPLY && ids.length > 0) {
    const chunk = 300;
    for (let i = 0; i < ids.length; i += chunk) {
      const part = ids.slice(i, i + chunk);
      const { error } = await supabase.from("appointments").delete().in("id", part);
      if (error) throw error;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "apply" : "dry-run",
        aggressive: AGGRESSIVE,
        targets_count: ids.length,
        examples: targets.slice(0, 80).map((r) => ({
          id: r.id,
          appointment_date: r.appointment_date,
          start_time: r.start_time,
          client_name: r.clients?.name ?? "",
          service: r.service,
        })),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
