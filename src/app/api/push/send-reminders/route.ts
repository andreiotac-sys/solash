import { NextResponse } from "next/server";
import { getServerSupabase, isPushConfigured, sendPush } from "@/lib/push-server";

export const runtime = "nodejs";

const TZ = "Europe/Bucharest";
const REMINDER_HOUR = 20;
const REMINDER_MINUTE = 30;

const getDatePartsInTz = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
};

const addDaysIso = (isoDate: string, days: number) => {
  const base = new Date(`${isoDate}T12:00:00`);
  base.setDate(base.getDate() + days);
  const year = base.getFullYear();
  const month = `${base.getMonth() + 1}`.padStart(2, "0");
  const day = `${base.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isPushConfigured) {
    return NextResponse.json(
      { ok: false, error: "Push config missing." },
      { status: 500 }
    );
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role missing." },
      { status: 500 }
    );
  }

  const now = getDatePartsInTz(new Date());
  if (
    now.hour !== REMINDER_HOUR ||
    now.minute < REMINDER_MINUTE ||
    now.minute > REMINDER_MINUTE + 29
  ) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Not reminder time" });
  }

  const todayIso = `${now.year}-${now.month}-${now.day}`;
  const runKey = `${todayIso}-${REMINDER_HOUR}:${`${REMINDER_MINUTE}`.padStart(2, "0")}`;
  const runInsert = await supabase.from("push_notification_runs").insert({
    run_key: runKey,
  });
  if (runInsert.error) {
    if (runInsert.error.code === "23505") {
      return NextResponse.json({ ok: true, skipped: true, reason: "Already sent" });
    }
    return NextResponse.json(
      { ok: false, error: "Failed to register reminder run." },
      { status: 500 }
    );
  }

  const tomorrowIso = addDaysIso(todayIso, 1);
  const appointmentsResponse = await supabase
    .from("appointments")
    .select("id")
    .eq("appointment_date", tomorrowIso)
    .not("status", "in", "(Anulata,Finalizata)");

  if (appointmentsResponse.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to load appointments." },
      { status: 500 }
    );
  }

  const count = appointmentsResponse.data.length;
  if (count === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: "No appointments tomorrow" });
  }

  const subscriptionsResponse = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("active", true);

  if (subscriptionsResponse.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to load subscriptions." },
      { status: 500 }
    );
  }

  let sent = 0;
  const deactivated: string[] = [];

  for (const row of subscriptionsResponse.data) {
    try {
      await sendPush(
        {
          endpoint: row.endpoint,
          expirationTime: null,
          keys: {
            p256dh: row.p256dh,
            auth: row.auth,
          },
        },
        {
          title: "SoLash",
          body: `Ai ${count} programari maine. Trimite confirmarile acum.`,
          url: "/",
        }
      );
      sent += 1;
    } catch (error) {
      const statusCode =
        typeof error === "object" &&
        error &&
        "statusCode" in error &&
        typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : null;

      if (statusCode === 404 || statusCode === 410) {
        await supabase
          .from("push_subscriptions")
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq("endpoint", row.endpoint);
        deactivated.push(row.endpoint);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    appointmentsTomorrow: count,
    deactivated: deactivated.length,
  });
}
