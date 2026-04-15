import { NextResponse } from "next/server";
import { getServerSupabase, isPushConfigured, sendPush } from "@/lib/push-server";

export const runtime = "nodejs";

const TZ = "Europe/Bucharest";

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
    hour: read("hour"),
    minute: read("minute"),
  };
};

const toLocalDate = (parts: ReturnType<typeof getDatePartsInTz>) =>
  `${parts.year}-${parts.month}-${parts.day}`;

const toLocalDateTime = (parts: ReturnType<typeof getDatePartsInTz>) =>
  `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;

type AppointmentRow = {
  id: number;
  appointment_date: string;
  start_time: string;
  service: string;
  status: string;
  clients:
    | {
        name: string;
      }[]
    | {
        name: string;
      }
    | null;
};

const getClientName = (clients: AppointmentRow["clients"]) => {
  if (!clients) {
    return "Clienta";
  }
  if (Array.isArray(clients)) {
    return clients[0]?.name ?? "Clienta";
  }
  return clients.name ?? "Clienta";
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const authHeader = request.headers.get("authorization");
  const isAuthorized =
    Boolean(cronSecret) &&
    (authHeader === `Bearer ${cronSecret}` || key === cronSecret);
  if (!isAuthorized) {
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

  const now = new Date();
  const startParts = getDatePartsInTz(new Date(now.getTime() + 15 * 60 * 1000));
  const endParts = getDatePartsInTz(new Date(now.getTime() + 20 * 60 * 1000));
  const startDate = toLocalDate(startParts);
  const endDate = toLocalDate(endParts);
  const startDateTime = toLocalDateTime(startParts);
  const endDateTime = toLocalDateTime(endParts);

  const appointmentsResponse = await supabase
    .from("appointments")
    .select("id, appointment_date, start_time, service, status, clients(name)")
    .gte("appointment_date", startDate)
    .lte("appointment_date", endDate)
    .not("status", "in", "(Anulata,Finalizata)");

  if (appointmentsResponse.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to load appointments." },
      { status: 500 }
    );
  }

  const dueAppointments = (appointmentsResponse.data as AppointmentRow[]).filter((item) => {
    const startTime = item.start_time.slice(0, 5);
    const appointmentDateTime = `${item.appointment_date}T${startTime}`;
    return appointmentDateTime >= startDateTime && appointmentDateTime <= endDateTime;
  });

  if (dueAppointments.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: "No appointments in 15-20 min" });
  }

  const uniqueAppointments: AppointmentRow[] = [];
  for (const appointment of dueAppointments) {
    const reminderKey = `${appointment.id}-${appointment.appointment_date}-${appointment.start_time.slice(0, 5)}-t15`;
    const insertResult = await supabase
      .from("push_appointment_reminders")
      .insert({
        reminder_key: reminderKey,
        appointment_id: appointment.id,
      });

    if (!insertResult.error) {
      uniqueAppointments.push(appointment);
      continue;
    }

    if (insertResult.error.code !== "23505") {
      return NextResponse.json(
        { ok: false, error: "Failed to save reminder state." },
        { status: 500 }
      );
    }
  }

  if (uniqueAppointments.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: "Already reminded" });
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

  const summary = uniqueAppointments
    .slice(0, 3)
    .map((appointment) => {
      const startTime = appointment.start_time.slice(0, 5);
      return `${getClientName(appointment.clients)} ${startTime}`;
    })
    .join(", ");
  const extra = uniqueAppointments.length > 3 ? ` +${uniqueAppointments.length - 3}` : "";
  const message =
    uniqueAppointments.length === 1
      ? `In 15-20 min: ${summary}.`
      : `In 15-20 min: ${summary}${extra}.`;

  let sent = 0;
  let deactivated = 0;

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
          title: "SoLash Reminder",
          body: message,
          url: "/?tab=month",
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
        deactivated += 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    reminders: uniqueAppointments.length,
    sent,
    deactivated,
    message,
  });
}
