import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { getServerSupabase } from "@/lib/push-server";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const backupBucket = process.env.BACKUP_BUCKET ?? "solash-backups";
const pageSize = 500;
const backupTables = [
  ["clients", "Cliente"],
  ["appointments", "Programari"],
  ["services", "Servicii"],
  ["push_subscriptions", "Push subscriptions"],
  ["push_notification_runs", "Push runs"],
  ["push_appointment_reminders", "Push reminders"],
  ["push_delivery_logs", "Push logs"],
] as const;

const formatNowForFilename = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  const hour = `${now.getHours()}`.padStart(2, "0");
  const minute = `${now.getMinutes()}`.padStart(2, "0");
  const second = `${now.getSeconds()}`.padStart(2, "0");
  const ms = `${now.getMilliseconds()}`.padStart(3, "0");
  return `${year}-${month}-${day}-${hour}-${minute}-${second}-${ms}`;
};

const isCronAuthorized = (request: Request) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
};

const isUserAuthorized = async (request: Request) => {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return false;
  }

  const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userResponse = await authSupabase.auth.getUser(token);
  return Boolean(userResponse.data.user && !userResponse.error);
};

const runBackup = async () => {
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role missing." },
      { status: 500 }
    );
  }

  const buckets = await supabase.storage.listBuckets();
  const bucket = buckets.data?.find((item) => item.name === backupBucket);
  if (buckets.error || !bucket || bucket.public) {
    return NextResponse.json(
      { ok: false, error: "Private backup bucket is unavailable." },
      { status: 500 }
    );
  }

  const rowsByTable: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const [table] of backupTables) {
    const countResult = await supabase.from(table).select("id", { head: true, count: "exact" });
    if (countResult.error || countResult.count === null) {
      return NextResponse.json({ ok: false, error: `Could not count ${table}.` }, { status: 500 });
    }
    counts[table] = countResult.count;
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < countResult.count; offset += pageSize) {
      const page = await supabase.from(table).select("*").order("id").range(offset, offset + pageSize - 1);
      if (page.error || !page.data) {
        return NextResponse.json({ ok: false, error: `Could not export ${table}.` }, { status: 500 });
      }
      rows.push(...page.data);
    }
    if (rows.length !== countResult.count || new Set(rows.map((row) => row.id)).size !== rows.length) {
      return NextResponse.json({ ok: false, error: `Incomplete export for ${table}.` }, { status: 500 });
    }
    rowsByTable[table] = rows;
  }

  const clientIds = new Set(rowsByTable.clients.map((row) => row.id));
  const appointmentIds = new Set(rowsByTable.appointments.map((row) => row.id));
  if (
    rowsByTable.appointments.some((row) => !clientIds.has(row.client_id)) ||
    rowsByTable.push_appointment_reminders.some((row) => !appointmentIds.has(row.appointment_id))
  ) {
    return NextResponse.json({ ok: false, error: "Backup relationship check failed." }, { status: 500 });
  }

  for (const [table] of backupTables) {
    const countResult = await supabase.from(table).select("id", { head: true, count: "exact" });
    if (countResult.error || countResult.count !== counts[table]) {
      return NextResponse.json({ ok: false, error: `Records changed during ${table} export.` }, { status: 503 });
    }
  }

  const workbook = XLSX.utils.book_new();
  for (const [table, sheet] of backupTables) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rowsByTable[table]), sheet);
  }

  const fileBuffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const path = `daily/solash-backup-${formatNowForFilename()}.xlsx`;
  const uploadResponse = await supabase.storage
    .from(backupBucket)
    .upload(path, fileBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

  if (uploadResponse.error) {
    return NextResponse.json(
      {
        ok: false,
        error: `Nu am putut urca fisierul de backup (${uploadResponse.error.message}).`,
      },
      { status: 500 }
    );
  }

  const downloaded = await supabase.storage.from(backupBucket).download(path);
  if (downloaded.error || !downloaded.data) {
    return NextResponse.json({ ok: false, error: "Could not verify uploaded backup." }, { status: 500 });
  }
  const uploadedHash = createHash("sha256").update(fileBuffer).digest("hex");
  const downloadedHash = createHash("sha256")
    .update(Buffer.from(await downloaded.data.arrayBuffer()))
    .digest("hex");
  if (uploadedHash !== downloadedHash) {
    return NextResponse.json({ ok: false, error: "Uploaded backup checksum mismatch." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    bucket: backupBucket,
    path,
    counts,
    sha256: uploadedHash,
  });
};

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return runBackup();
}

export async function POST(request: Request) {
  const authorized = await isUserAuthorized(request);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return runBackup();
}
