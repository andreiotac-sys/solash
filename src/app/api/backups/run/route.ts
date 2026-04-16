import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { getServerSupabase } from "@/lib/push-server";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const backupBucket = process.env.BACKUP_BUCKET ?? "solash-backups";

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

  const [clientsResponse, appointmentsResponse, servicesResponse] = await Promise.all([
    supabase.from("clients").select("*").order("name", { ascending: true }),
    supabase
      .from("appointments")
      .select(
        "id, service, appointment_date, start_time, duration, price, status, notes, clients(name, phone)"
      )
      .order("appointment_date", { ascending: true })
      .order("start_time", { ascending: true }),
    supabase.from("services").select("*").order("name", { ascending: true }),
  ]);

  if (clientsResponse.error || appointmentsResponse.error || servicesResponse.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to load data for backup." },
      { status: 500 }
    );
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(clientsResponse.data),
    "Cliente"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(appointmentsResponse.data),
    "Programari"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(servicesResponse.data),
    "Servicii"
  );

  const fileBuffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const bucketResult = await supabase.storage.createBucket(backupBucket, {
    public: false,
  });
  if (
    bucketResult.error &&
    !bucketResult.error.message.toLowerCase().includes("already exists")
  ) {
    return NextResponse.json(
      { ok: false, error: `Nu am putut crea bucket-ul ${backupBucket}.` },
      { status: 500 }
    );
  }

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

  return NextResponse.json({
    ok: true,
    bucket: backupBucket,
    path,
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
