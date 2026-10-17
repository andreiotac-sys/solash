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
