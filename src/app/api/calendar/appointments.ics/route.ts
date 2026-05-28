import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "Europe/Bucharest";
const FEED_DAYS = 370;
const PERSONAL_BLOCK_MARKER = "[solash-personal-block]";
const PERSONAL_BLOCK_SERVICE = "Blocaj personal";
const LEGACY_PERSONAL_BLOCK_PRESETS = new Set(["Eu gene", "Eu par", "Eu unghii"]);

type AppointmentRow = {
  id: number;
  appointment_date: string;
  start_time: string;
  duration: string;
  service: string;
  price: number;
  status: string;
  notes: string | null;
  clients:
    | {
        name: string;
        phone: string;
      }[]
    | {
        name: string;
        phone: string;
      }
    | null;
};

const getDateInTz = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${read("year")}-${read("month")}-${read("day")}`;
};

const addDaysIso = (isoDate: string, days: number) => {
  const base = new Date(`${isoDate}T12:00:00`);
  base.setDate(base.getDate() + days);
  const year = base.getFullYear();
  const month = `${base.getMonth() + 1}`.padStart(2, "0");
  const day = `${base.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDurationToMinutes = (value: string) => {
  const normalized = value.trim().toLowerCase();
  const hourMatch = normalized.match(/(\d+)\s*h/);
  const minuteMatch = normalized.match(/(\d+)\s*m/);

  if (hourMatch || minuteMatch) {
    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    return hours * 60 + minutes;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
};

const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesToCompactTime = (total: number) => {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${`${hours}`.padStart(2, "0")}${`${minutes}`.padStart(2, "0")}00`;
};

const toIcsLocalDateTime = (date: string, time: string) => {
  const compactTime = time.includes(":")
    ? `${time.slice(0, 5).replace(":", "")}00`
    : time.padEnd(6, "0").slice(0, 6);
  return `${date.replaceAll("-", "")}T${compactTime}`;
};

const toIcsStamp = (date: Date) =>
  date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const escapeIcsText = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");

const foldIcsLine = (line: string) => {
  const chunks: string[] = [];
  let remaining = line;

  while (remaining.length > 73) {
    chunks.push(remaining.slice(0, 73));
    remaining = remaining.slice(73);
  }

  chunks.push(remaining);
  return chunks.join("\r\n ");
};

const getClient = (clients: AppointmentRow["clients"]) => {
  if (!clients) {
    return { name: "Clienta", phone: "" };
  }
  if (Array.isArray(clients)) {
    return clients[0] ?? { name: "Clienta", phone: "" };
  }
  return clients;
};

const getPersonalBlockTitle = (notes: string | null) => {
  const title = notes?.replace(PERSONAL_BLOCK_MARKER, "").trim();
  return title || "Blocaj personal";
};

const getSummary = (appointment: AppointmentRow) => {
  if (
    appointment.service === PERSONAL_BLOCK_SERVICE ||
    appointment.notes?.includes(PERSONAL_BLOCK_MARKER)
  ) {
    const title = getPersonalBlockTitle(appointment.notes);
    const clientName = getClient(appointment.clients).name;
    if (
      title === PERSONAL_BLOCK_SERVICE &&
      clientName &&
      clientName !== "Clienta" &&
      !LEGACY_PERSONAL_BLOCK_PRESETS.has(clientName)
    ) {
      return clientName;
    }
    return title;
  }

  return getClient(appointment.clients).name;
};

const buildDescription = (appointment: AppointmentRow) => {
  const client = getClient(appointment.clients);
  const parts = [
    `Clienta: ${client.name}`,
    client.phone ? `Telefon: ${client.phone}` : "",
    `Serviciu: ${appointment.service}`,
    `Durata: ${appointment.duration}`,
    appointment.price ? `Pret: ${appointment.price} lei` : "",
    `Status: ${appointment.status}`,
    appointment.notes ? `Notite: ${appointment.notes}` : "",
  ].filter(Boolean);

  return parts.join("\n");
};

const buildCalendar = (appointments: AppointmentRow[]) => {
  const stamp = toIcsStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SoLash//Appointments Calendar//RO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:SoLash Programari",
    `X-WR-TIMEZONE:${TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
    "X-PUBLISHED-TTL:PT30M",
  ];

  for (const appointment of appointments) {
    const startMinutes = timeToMinutes(appointment.start_time);
    const durationMinutes = parseDurationToMinutes(appointment.duration) || 60;
    const endMinutes = startMinutes + durationMinutes;
    const endDate =
      endMinutes >= 24 * 60
        ? addDaysIso(appointment.appointment_date, Math.floor(endMinutes / (24 * 60)))
        : appointment.appointment_date;
    const endTime = minutesToCompactTime(endMinutes % (24 * 60));

    lines.push(
      "BEGIN:VEVENT",
      `UID:solash-appointment-${appointment.id}@solash`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${TZ}:${toIcsLocalDateTime(
        appointment.appointment_date,
        appointment.start_time
      )}`,
      `DTEND;TZID=${TZ}:${toIcsLocalDateTime(endDate, endTime)}`,
      `SUMMARY:${escapeIcsText(getSummary(appointment))}`,
      `DESCRIPTION:${escapeIcsText(buildDescription(appointment))}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
};

export async function GET(request: Request) {
  const feedToken = process.env.CALENDAR_FEED_TOKEN;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!feedToken) {
    return NextResponse.json(
      { ok: false, error: "Calendar feed token missing." },
      { status: 500 }
    );
  }

  if (token !== feedToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role missing." },
      { status: 500 }
    );
  }

  const today = getDateInTz(new Date());
  const endDate = addDaysIso(today, FEED_DAYS);
  const appointmentsWithNotesResponse = await supabase
    .from("appointments")
    .select(
      "id, appointment_date, start_time, duration, service, price, status, notes, clients(name, phone)"
    )
    .gte("appointment_date", today)
    .lte("appointment_date", endDate)
    .not("status", "in", "(Anulata,Finalizata)")
    .order("appointment_date", { ascending: true })
    .order("start_time", { ascending: true });

  const appointmentsResponse = appointmentsWithNotesResponse.error
    ? await supabase
        .from("appointments")
        .select(
          "id, appointment_date, start_time, duration, service, price, status, clients(name, phone)"
        )
        .gte("appointment_date", today)
        .lte("appointment_date", endDate)
        .not("status", "in", "(Anulata,Finalizata)")
        .order("appointment_date", { ascending: true })
        .order("start_time", { ascending: true })
    : appointmentsWithNotesResponse;

  if (appointmentsResponse.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to load appointments." },
      { status: 500 }
    );
  }

  const appointments = (appointmentsResponse.data as Partial<AppointmentRow>[]).map(
    (appointment) => ({
      notes: null,
      ...appointment,
    })
  ) as AppointmentRow[];

  return new Response(buildCalendar(appointments), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="solash-programari.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}
