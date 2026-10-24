import type { Appointment } from "./types";

export const isPersonalBlock = (appointment: Appointment) =>
  appointment.service === "Blocaj personal" ||
  appointment.notes.includes("[solash-personal-block]");

// Personal time belongs to the calendar, not customer visits or average tickets.
// Keep cancelled customer entries so cancellation reports retain their history.
export const getCustomerReportingAppointments = (appointments: Appointment[]) =>
  appointments.filter(
    (appointment) =>
      appointment.date >= "2023-01-01" && !isPersonalBlock(appointment),
  );

export type ReportPeriod = "day" | "week" | "month";
export type ReportRange = { start: string; end: string };

const calendarDate = (iso: string) => {
  const date = new Date(`${iso}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error("Invalid report date");
  }
  return date;
};
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

// UTC is used only for calendar arithmetic, independent of host timezone/DST.
// Appointment dates remain their stored local YYYY-MM-DD values.
export function getReportRange(period: ReportPeriod, anchor: string): ReportRange {
  const start = calendarDate(anchor);
  if (period === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (period === "month") start.setUTCDate(1);
  const end = new Date(start);
  if (period === "week") end.setUTCDate(end.getUTCDate() + 6);
  if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { start: dateKey(start), end: dateKey(end) };
}

export function selectReportMonth(anchor: string, month: string) {
  const day = calendarDate(anchor).getUTCDate();
  const first = calendarDate(`${month}-01`);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  first.setUTCDate(Math.min(day, last.getUTCDate()));
  return dateKey(first);
}

export function shiftReportDate(anchor: string, period: ReportPeriod, offset: number) {
  const date = calendarDate(anchor);
  if (period === "month") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return selectReportMonth(anchor, dateKey(date).slice(0, 7));
  }
  date.setUTCDate(date.getUTCDate() + offset * (period === "week" ? 7 : 1));
  return dateKey(date);
}

export function summarizeReportAppointments(source: Appointment[], range: ReportRange) {
  const appointments = getCustomerReportingAppointments(source)
    .filter((item) => item.date >= range.start && item.date <= range.end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const nonCancelled = appointments.filter((item) => item.status !== "Anulata");
  const totalRevenue = nonCancelled.reduce((sum, item) => sum + item.price, 0);
  const daily = [];
  for (const date = calendarDate(range.start); dateKey(date) <= range.end; date.setUTCDate(date.getUTCDate() + 1)) {
    daily.push({ date: dateKey(date), count: 0, cancelled: 0, revenue: 0 });
  }
  const byDate = new Map(daily.map((day) => [day.date, day]));
  for (const item of appointments) {
    const day = byDate.get(item.date)!;
    if (item.status === "Anulata") day.cancelled += 1;
    else { day.count += 1; day.revenue += item.price; }
  }
  return {
    appointments, nonCancelled, totalRevenue, daily,
    uniqueClients: new Set(nonCancelled.map((item) => item.clientId)).size,
    avgTicket: nonCancelled.length ? Math.round(totalRevenue / nonCancelled.length) : 0,
  };
}
