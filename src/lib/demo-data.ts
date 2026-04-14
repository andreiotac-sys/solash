import type {
  Appointment,
  Client,
  Service,
  SupabaseAppointmentRow,
  SupabaseClientRow,
} from "@/lib/types";

export const baseServices: Service[] = [
  { name: "Mega Volum", duration: "3h", price: 350 },
  { name: "Russian Volum", duration: "2h 30m", price: 300 },
  { name: "Intretinere", duration: "2h", price: 220 },
];

export const initialClients: Client[] = [
  {
    id: 1,
    name: "Bianca T.",
    phone: "+40742111222",
    notes: "Prefera programari de dimineata.",
    visits: 12,
    lastVisit: "ieri",
  },
  {
    id: 2,
    name: "Andreea P.",
    phone: "+40743123456",
    notes: "Vrea confirmare pe WhatsApp.",
    visits: 7,
    lastVisit: "acum 2 sapt.",
  },
  {
    id: 3,
    name: "Ioana M.",
    phone: "+40744199887",
    notes: "Prima vizita.",
    visits: 1,
    lastVisit: "azi",
  },
];

export const initialAppointments: Appointment[] = [
  {
    id: 1,
    clientId: 1,
    clientName: "Bianca T.",
    service: "Mega Volum",
    date: "2026-04-14",
    start: "09:30",
    duration: "3h",
    price: 350,
    phone: "+40742111222",
    status: "Confirmata",
  },
  {
    id: 2,
    clientId: 2,
    clientName: "Andreea P.",
    service: "Russian Volum",
    date: "2026-04-14",
    start: "13:30",
    duration: "2h 30m",
    price: 300,
    phone: "+40743123456",
    status: "Reminder maine",
  },
  {
    id: 3,
    clientId: 3,
    clientName: "Ioana M.",
    service: "Intretinere",
    date: "2026-04-14",
    start: "17:00",
    duration: "2h",
    price: 220,
    phone: "+40744199887",
    status: "Noua",
  },
];

export const formatPrice = (price: number) => `${price} lei`;

export const mapClientRow = (row: SupabaseClientRow): Client => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  notes: row.notes ?? "",
  visits: row.visits ?? 0,
  lastVisit: row.last_visit_label ?? "noua",
});

export const mapAppointmentRow = (
  row: SupabaseAppointmentRow
): Appointment => {
  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;

  return {
    id: row.id,
    clientId: row.client_id,
    clientName: client?.name ?? "Clienta",
    service: row.service,
    date: row.appointment_date,
    start: row.start_time.slice(0, 5),
    duration: row.duration,
    price: row.price,
    phone: client?.phone ?? "",
    status: row.status,
  };
};
