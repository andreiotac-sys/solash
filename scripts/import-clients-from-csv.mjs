import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DEFAULT_FILE = "import_map_nume_cliente_final_pentru_import.csv";
const CSV_FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : path.resolve(ROOT, DEFAULT_FILE);

function loadEnvLocal() {
  const envPath = path.resolve(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const txt = fs.readFileSync(envPath, "utf8");
  for (const lineRaw of txt.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function normalizeName(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhone(value) {
  const digits = (value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("4") && digits.length === 10) return digits;
  if (digits.startsWith("40") && digits.length === 11) return digits.slice(1);
  if (digits.length === 9) return `4${digits}`;
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function parseCsvLine(line, delimiter) {
  const out = [];
  let current = "";
  let i = 0;
  let inQuotes = false;

  while (i < line.length) {
    const char = line[i];
    if (char === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  out.push(current.trim());
  return out;
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = parseCsvLine(lines[0], delimiter);

  const idxShort =
    header.indexOf("nume_scurt_calendar") !== -1 ? header.indexOf("nume_scurt_calendar") : header.indexOf("aliasuri_calendar");
  const idxFull =
    header.indexOf("nume_complet_final") !== -1 ? header.indexOf("nume_complet_final") : header.indexOf("nume_complet");
  const idxPhone = header.indexOf("telefon_final") !== -1 ? header.indexOf("telefon_final") : header.indexOf("telefon");

  if (idxFull === -1 || idxPhone === -1 || idxShort === -1) {
    throw new Error(
      "CSV header invalid. Expected either nume_scurt_calendar;nume_complet_final;telefon_final or nume_complet,telefon,aliasuri_calendar",
    );
  }

  return lines.slice(1).map((line) => {
    const parts = parseCsvLine(line, delimiter);
    const shortName = (parts[idxShort] || "").trim();
    const fullName = (parts[idxFull] || "").trim();
    const phone = normalizePhone((parts[idxPhone] || "").trim());
    return {
      shortName,
      fullName,
      phone: phone || null,
      note: shortName ? `Import ICS (${shortName})` : "Import ICS",
    };
  });
}

async function run() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  }

  if (!fs.existsSync(CSV_FILE)) {
    throw new Error(`CSV not found: ${CSV_FILE}`);
  }

  const csvRaw = fs.readFileSync(CSV_FILE, "utf8");
  const incoming = parseCsv(csvRaw).filter((row) => row.fullName);

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: existingError } = await supabase.from("clients").select("id,name,phone,notes");
  if (existingError) throw existingError;

  const byPhone = new Map();
  const byName = new Map();
  for (const row of existing || []) {
    const p = normalizePhone(row.phone || "");
    const n = normalizeName(row.name || "");
    if (p && !byPhone.has(p)) byPhone.set(p, row);
    if (n && !byName.has(n)) byName.set(n, row);
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of incoming) {
    try {
      const normalizedPhone = normalizePhone(row.phone || "");
      const normalizedName = normalizeName(row.fullName);
      const found = (normalizedPhone && byPhone.get(normalizedPhone)) || byName.get(normalizedName);

      if (found) {
        const patch = {};
        if (!found.phone && row.phone) patch.phone = row.phone;
        if (row.note && !(found.notes || "").includes("Import ICS")) {
          patch.notes = (found.notes ? `${found.notes} | ${row.note}` : row.note).slice(0, 800);
        }

        if (Object.keys(patch).length === 0) {
          skipped += 1;
          continue;
        }

        const { data: updatedRow, error: updateError } = await supabase
          .from("clients")
          .update(patch)
          .eq("id", found.id)
          .select("id,name,phone,notes")
          .single();

        if (updateError) throw updateError;
        updated += 1;

        if (updatedRow) {
          const p = normalizePhone(updatedRow.phone || "");
          const n = normalizeName(updatedRow.name || "");
          if (p) byPhone.set(p, updatedRow);
          if (n) byName.set(n, updatedRow);
        }
      } else {
        const payload = {
          name: row.fullName,
          phone: row.phone,
          notes: row.note,
        };

        const { data: insertedRow, error: insertError } = await supabase
          .from("clients")
          .insert(payload)
          .select("id,name,phone,notes")
          .single();

        if (insertError) throw insertError;
        inserted += 1;

        if (insertedRow) {
          const p = normalizePhone(insertedRow.phone || "");
          const n = normalizeName(insertedRow.name || "");
          if (p) byPhone.set(p, insertedRow);
          if (n) byName.set(n, insertedRow);
        }
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`ROW_FAIL ${row.fullName}: ${message}`);
    }
  }

  const { count, error: countError } = await supabase.from("clients").select("id", { head: true, count: "exact" });
  if (countError) throw countError;

  console.log(
    JSON.stringify(
      {
        csv_file: CSV_FILE,
        incoming: incoming.length,
        inserted,
        updated,
        skipped,
        failed,
        total_clients_after: count ?? null,
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
