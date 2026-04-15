export type Service = {
  id: number;
  name: string;
  duration: string;
  price: number;
  active: boolean;
};

export type Client = {
  id: number;
  name: string;
  phone: string;
  notes: string;
  visits: number;
  lastVisit: string;
};

export type Appointment = {
  id: number;
  clientId: number;
  clientName: string;
  service: string;
  date: string;
  start: string;
  duration: string;
  price: number;
  phone: string;
  status: string;
  notes: string;
};

export type SupabaseClientRow = {
  id: number;
  name: string;
  phone: string;
  notes: string | null;
  visits: number | null;
  last_visit_label: string | null;
};

export type SupabaseAppointmentRow = {
  id: number;
  client_id: number;
  service: string;
  appointment_date: string;
  start_time: string;
  duration: string;
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

export type SupabaseServiceRow = {
  id: number;
  name: string;
  duration: string;
  price: number;
  active: boolean | null;
};
