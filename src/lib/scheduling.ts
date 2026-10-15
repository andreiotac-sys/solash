import type { Appointment } from "./types";

export type DayBusinessSettings = {
  enabled: boolean;
  hasBreak: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
};

export type BusinessSettings = {
  schedule: Record<number, DayBusinessSettings>;
  daysOff: string[];
};

export type WorkWindow = { start: number; end: number };

export const parseDurationToMinutes = (value: string): number => {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|m))?$/);
  if (match && (match[1] || match[2])) {
    return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
};

export const timeToMinutes = (time: string): number => {
  const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : Number.NaN;
};

export const dateToWeekdayKey = (isoDate: string): number => {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return Number.NaN;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== isoDate) return Number.NaN;
  return (date.getUTCDay() + 6) % 7;
};

export const getWorkWindowsForDate = (date: string, settings: BusinessSettings): WorkWindow[] => {
  if (settings.daysOff.includes(date)) return [];
  const day = settings.schedule[dateToWeekdayKey(date)];
  if (!day?.enabled) return [];
  const start = timeToMinutes(day.start);
  const end = timeToMinutes(day.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const breakStart = timeToMinutes(day.breakStart);
  const breakEnd = timeToMinutes(day.breakEnd);
  if (!day.hasBreak || !(breakStart > start && breakEnd > breakStart && breakEnd < end)) {
    return [{ start, end }];
  }
  return [{ start, end: breakStart }, { start: breakEnd, end }];
};

export type BookingCheck =
  | { kind: "valid" }
  | { kind: "invalid" }
  | { kind: "conflict"; appointmentId: number }
  | { kind: "outside_hours"; windows: WorkWindow[] };

export const checkBooking = (input: {
  date: string;
  start: string;
  duration: string;
  editingId?: number | null;
  appointments: Appointment[];
  settings: BusinessSettings;
}): BookingCheck => {
  const start = timeToMinutes(input.start);
  const duration = parseDurationToMinutes(input.duration);
  const end = start + duration;
  if (
    !Number.isFinite(dateToWeekdayKey(input.date)) ||
    !Number.isFinite(start) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    end > 24 * 60
  ) return { kind: "invalid" };

  const conflict = input.appointments.find((appointment) => {
    if (
      appointment.date !== input.date ||
      appointment.id === input.editingId ||
      appointment.status === "Anulata"
    ) return false;
    const otherStart = timeToMinutes(appointment.start);
    const otherEnd = otherStart + parseDurationToMinutes(appointment.duration);
    return start < otherEnd && end > otherStart;
  });
  if (conflict) return { kind: "conflict", appointmentId: conflict.id };

  const windows = getWorkWindowsForDate(input.date, input.settings);
  if (!windows.some((window) => start >= window.start && end <= window.end)) {
    return { kind: "outside_hours", windows };
  }
  return { kind: "valid" };
};
