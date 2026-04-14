"use client";

import { useEffect, useMemo, useState } from "react";
import {
  baseServices,
  formatPrice,
  initialAppointments,
  initialClients,
  mapAppointmentRow,
  mapClientRow,
} from "@/lib/demo-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Appointment, Client } from "@/lib/types";

const STORAGE_KEY = "solash-demo-store";
const TODAY = "2026-04-14";

type LocalStore = {
  appointments: Appointment[];
  clients: Client[];
};

const readLocalStore = (): LocalStore => {
  if (typeof window === "undefined") {
    return {
      appointments: initialAppointments,
      clients: initialClients,
    };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      appointments: initialAppointments,
      clients: initialClients,
    };
  }

  try {
    return JSON.parse(raw) as LocalStore;
  } catch {
    return {
      appointments: initialAppointments,
      clients: initialClients,
    };
  }
};

const writeLocalStore = (store: LocalStore) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

export default function Home() {
  const [clients, setClients] = useState<Client[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [activePanel, setActivePanel] = useState<"appointment" | "client">(
    "appointment"
  );
  const [selectedClientId, setSelectedClientId] = useState<number>(0);
  const [selectedService, setSelectedService] = useState(baseServices[0].name);
  const [appointmentDate, setAppointmentDate] = useState(TODAY);
  const [appointmentTime, setAppointmentTime] = useState("10:00");
  const [appointmentDuration, setAppointmentDuration] = useState(
    baseServices[0].duration
  );
  const [appointmentPrice, setAppointmentPrice] = useState(baseServices[0].price);
  const [appointmentStatus, setAppointmentStatus] = useState("Noua");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientNotes, setClientNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [isSavingAppointment, setIsSavingAppointment] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);

      if (!isSupabaseConfigured || !supabase) {
        const local = readLocalStore();
        setClients(local.clients);
        setAppointments(local.appointments);
        setSelectedClientId(local.clients[0]?.id ?? 0);
        setMessage(
          "Mod demo activ. Pentru salvare reala, completeaza cheile Supabase."
        );
        setIsLoading(false);
        return;
      }

      const [clientsResponse, appointmentsResponse] = await Promise.all([
        supabase.from("clients").select("*").order("id", { ascending: false }),
        supabase
          .from("appointments")
          .select(
            "id, client_id, service, appointment_date, start_time, duration, price, status, clients(name, phone)"
          )
          .order("appointment_date", { ascending: false })
          .order("start_time", { ascending: true }),
      ]);

      if (clientsResponse.error || appointmentsResponse.error) {

        console.error("Clients error:", clientsResponse.error);
        console.error("Appointments error:", appointmentsResponse.error);

        const local = readLocalStore();
        setClients(local.clients);
        setAppointments(local.appointments);
        setSelectedClientId(local.clients[0]?.id ?? 0);
        setMessage("Nu am putut citi Supabase. Aplicatia a trecut pe modul demo.");
        setIsLoading(false);
        return;
      }

      const nextClients = clientsResponse.data.map(mapClientRow);
      const nextAppointments = appointmentsResponse.data.map(mapAppointmentRow);
      setClients(nextClients);
      setAppointments(nextAppointments);
      setSelectedClientId(nextClients[0]?.id ?? 0);
      setMessage("Conectat la Supabase.");
      setIsLoading(false);
    };

    void loadData();
  }, []);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? clients[0],
    [clients, selectedClientId]
  );

  const todaysAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.date === appointmentDate),
    [appointmentDate, appointments]
  );

  const todaysWindow = useMemo(() => {
    if (todaysAppointments.length === 0) {
      return "Fara programari";
    }

    const sorted = [...todaysAppointments].sort((a, b) => a.start.localeCompare(b.start));
    return `${sorted[0].start} - ${sorted[sorted.length - 1].start}`;
  }, [todaysAppointments]);

  const totalToday = todaysAppointments.reduce((sum, appointment) => {
    return sum + appointment.price;
  }, 0);

  const handleServiceChange = (serviceName: string) => {
    setSelectedService(serviceName);
    const service = baseServices.find((item) => item.name === serviceName);
    if (!service) {
      return;
    }

    setAppointmentDuration(service.duration);
    setAppointmentPrice(service.price);
  };

  const handleAddClient = async () => {
    if (!clientName.trim() || !clientPhone.trim()) {
      setMessage("Completeaza numele si telefonul clientei.");
      return;
    }

    setIsSavingClient(true);
    const payload = {
      name: clientName.trim(),
      phone: clientPhone.trim(),
      notes: clientNotes.trim(),
      visits: 0,
      lastVisit: "noua",
    };

    if (!isSupabaseConfigured || !supabase) {
      const newClient: Client = {
        id: Date.now(),
        ...payload,
      };
      const nextClients = [newClient, ...clients];
      setClients(nextClients);
      setSelectedClientId(newClient.id);
      writeLocalStore({ clients: nextClients, appointments });
      setMessage("Clienta a fost salvata local.");
    } else {
      const response = await supabase
        .from("clients")
        .insert({
          name: payload.name,
          phone: payload.phone,
          notes: payload.notes,
          visits: payload.visits,
          last_visit_label: payload.lastVisit,
        })
        .select("*")
        .single();

      if (response.error) {
        setMessage("Nu am putut salva clienta in Supabase.");
        setIsSavingClient(false);
        return;
      }

      const newClient = mapClientRow(response.data);
      setClients((current) => [newClient, ...current]);
      setSelectedClientId(newClient.id);
      setMessage("Clienta a fost salvata in Supabase.");
    }

    setClientName("");
    setClientPhone("");
    setClientNotes("");
    setActivePanel("appointment");
    setIsSavingClient(false);
  };

  const handleAddAppointment = async () => {
    if (!selectedClient) {
      setMessage("Adauga mai intai o clienta.");
      return;
    }

    setIsSavingAppointment(true);

    if (!isSupabaseConfigured || !supabase) {
      const newAppointment: Appointment = {
        id: Date.now(),
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        service: selectedService,
        date: appointmentDate,
        start: appointmentTime,
        duration: appointmentDuration,
        price: appointmentPrice,
        phone: selectedClient.phone,
        status: appointmentStatus,
      };

      const nextAppointments = [...appointments, newAppointment].sort((a, b) => {
        if (a.date === b.date) {
          return a.start.localeCompare(b.start);
        }
        return a.date.localeCompare(b.date);
      });
      setAppointments(nextAppointments);
      writeLocalStore({ clients, appointments: nextAppointments });
      setMessage("Programarea a fost salvata local.");
    } else {
      const response = await supabase
        .from("appointments")
        .insert({
          client_id: selectedClient.id,
          service: selectedService,
          appointment_date: appointmentDate,
          start_time: appointmentTime,
          duration: appointmentDuration,
          price: appointmentPrice,
          status: appointmentStatus,
        })
        .select(
          "id, client_id, service, appointment_date, start_time, duration, price, status, clients(name, phone)"
        )
        .single();

      if (response.error) {
        console.error(response.error);
        setMessage("Nu am putut salva programarea in Supabase.");
        setIsSavingAppointment(false);
        return;
      }

      const newAppointment = mapAppointmentRow(response.data);
      setAppointments((current) =>
        [...current, newAppointment].sort((a, b) => {
          if (a.date === b.date) {
            return a.start.localeCompare(b.start);
          }
          return a.date.localeCompare(b.date);
        })
      );
      setMessage("Programarea a fost salvata in Supabase.");
    }

    setAppointmentTime("10:00");
    setAppointmentStatus("Noua");
    setIsSavingAppointment(false);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-28 pt-6">
        <section className="panel-glow gold-ring rounded-[8px] border border-line px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted">Marti, 14 aprilie 2026</p>
              <h1 className="mt-2 text-[32px] font-semibold leading-tight">
                SoLash
              </h1>
              <p className="mt-2 max-w-[18rem] text-sm leading-6 text-[#ddd4c5]">
                Programari premium pentru extensii de gene, gandite clar pentru
                mobil.
              </p>
            </div>
            <div className="gold-ring rounded-[8px] border border-line bg-panel px-3 py-2 text-right">
              <p className="text-xs text-muted">Pe data aleasa</p>
              <p className="mt-1 text-2xl font-semibold text-gold-strong">
                {todaysAppointments.length}
              </p>
              <p className="text-xs text-muted">programari</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              className={`rounded-[8px] px-4 py-3 text-sm font-semibold transition ${
                activePanel === "appointment"
                  ? "bg-gold text-black"
                  : "gold-ring border border-line bg-panel text-foreground"
              }`}
              onClick={() => setActivePanel("appointment")}
              type="button"
            >
              Programare noua
            </button>
            <button
              className={`rounded-[8px] px-4 py-3 text-sm font-semibold transition ${
                activePanel === "client"
                  ? "bg-gold text-black"
                  : "gold-ring border border-line bg-panel text-foreground"
              }`}
              onClick={() => setActivePanel("client")}
              type="button"
            >
              Adauga clienta
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-3">
              <p className="text-xs text-muted">Incasari pe zi</p>
              <p className="mt-2 text-xl font-semibold text-gold">
                {formatPrice(totalToday)}
              </p>
            </div>
            <div className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-3">
              <p className="text-xs text-muted">Fereastra</p>
              <p className="mt-2 text-xl font-semibold">{todaysWindow}</p>
            </div>
          </div>

          <label className="mt-5 grid gap-2 text-sm">
            <span className="text-muted">Ziua selectata</span>
            <input
              className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
              onChange={(event) => setAppointmentDate(event.target.value)}
              type="date"
              value={appointmentDate}
            />
          </label>

          <div className="mt-4 rounded-[8px] border border-line bg-black px-4 py-3 text-sm text-[#ddd4c5]">
            {isLoading ? "Se incarca datele..." : message}
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {activePanel === "appointment" ? "Programare noua" : "Clienta noua"}
            </h2>
            <span className="text-sm text-muted">
              {isSupabaseConfigured ? "Supabase" : "demo local"}
            </span>
          </div>

          {activePanel === "appointment" ? (
            <div className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <div className="grid gap-3">
                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Clienta</span>
                  <select
                    className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                    onChange={(event) => setSelectedClientId(Number(event.target.value))}
                    value={selectedClientId}
                  >
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Serviciu</span>
                  <select
                    className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                    onChange={(event) => handleServiceChange(event.target.value)}
                    value={selectedService}
                  >
                    {baseServices.map((service) => (
                      <option key={service.name} value={service.name}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-2 text-sm">
                    <span className="text-muted">Data</span>
                    <input
                      className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                      onChange={(event) => setAppointmentDate(event.target.value)}
                      type="date"
                      value={appointmentDate}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="text-muted">Ora</span>
                    <input
                      className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                      onChange={(event) => setAppointmentTime(event.target.value)}
                      type="time"
                      value={appointmentTime}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-2 text-sm">
                    <span className="text-muted">Durata</span>
                    <input
                      className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                      onChange={(event) => setAppointmentDuration(event.target.value)}
                      value={appointmentDuration}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="text-muted">Pret</span>
                    <input
                      className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                      min="0"
                      onChange={(event) =>
                        setAppointmentPrice(Number(event.target.value) || 0)
                      }
                      type="number"
                      value={appointmentPrice}
                    />
                  </label>
                </div>

                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Status</span>
                  <select
                    className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                    onChange={(event) => setAppointmentStatus(event.target.value)}
                    value={appointmentStatus}
                  >
                    <option>Noua</option>
                    <option>Confirmata</option>
                    <option>Reminder maine</option>
                  </select>
                </label>

                <div className="rounded-[8px] border border-line bg-black px-4 py-3 text-sm">
                  <p className="text-muted">Clienta selectata</p>
                  <p className="mt-2 font-medium">{selectedClient?.name ?? "-"}</p>
                  <p className="mt-1 text-[#ddd4c5]">{selectedClient?.phone ?? "-"}</p>
                </div>

                <button
                  className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                  disabled={isSavingAppointment || isLoading || clients.length === 0}
                  onClick={() => void handleAddAppointment()}
                  type="button"
                >
                  {isSavingAppointment
                    ? "Se salveaza..."
                    : "Salveaza programarea"}
                </button>
              </div>
            </div>
          ) : (
            <div className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <div className="grid gap-3">
                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Nume clienta</span>
                  <input
                    className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                    onChange={(event) => setClientName(event.target.value)}
                    placeholder="Ex: Maria Popescu"
                    value={clientName}
                  />
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Telefon</span>
                  <input
                    className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                    onChange={(event) => setClientPhone(event.target.value)}
                    placeholder="+40..."
                    value={clientPhone}
                  />
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Observatii</span>
                  <textarea
                    className="min-h-[96px] rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                    onChange={(event) => setClientNotes(event.target.value)}
                    placeholder="Preferinte, detalii, reminder..."
                    value={clientNotes}
                  />
                </label>

                <button
                  className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                  disabled={isSavingClient || isLoading}
                  onClick={() => void handleAddClient()}
                  type="button"
                >
                  {isSavingClient ? "Se salveaza..." : "Salveaza clienta"}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Programari</h2>
            <span className="text-sm text-muted">{appointmentDate}</span>
          </div>
          <div className="space-y-3">
            {todaysAppointments.map((appointment) => (
              <article
                key={appointment.id}
                className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-base font-semibold">
                      {appointment.clientName}
                    </p>
                    <p className="mt-1 text-sm text-[#ddd4c5]">
                      {appointment.service}
                    </p>
                  </div>
                  <span className="rounded-[8px] bg-black px-2 py-1 text-xs text-gold">
                    {appointment.status}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-sm text-muted">
                  <div>
                    <p>Ora</p>
                    <p className="mt-1 text-foreground">{appointment.start}</p>
                  </div>
                  <div>
                    <p>Durata</p>
                    <p className="mt-1 text-foreground">{appointment.duration}</p>
                  </div>
                  <div>
                    <p>Pret</p>
                    <p className="mt-1 text-foreground">
                      {formatPrice(appointment.price)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <a
                    className="flex-1 rounded-[8px] bg-[#1f1f1f] px-3 py-3 text-center text-sm font-medium text-foreground"
                    href={`tel:${appointment.phone}`}
                  >
                    Suna
                  </a>
                  <a
                    className="flex-1 rounded-[8px] bg-gold px-3 py-3 text-center text-sm font-semibold text-black"
                    href={`https://wa.me/${appointment.phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
                      `Buna, ${appointment.clientName}. Programarea ta SoLash pentru ${appointment.service} este pe ${appointment.date} la ${appointment.start}.`
                    )}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Trimite WhatsApp
                  </a>
                </div>
              </article>
            ))}

            {!isLoading && todaysAppointments.length === 0 ? (
              <div className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-6 text-sm text-muted">
                Nu exista programari pe data selectata.
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Servicii</h2>
            <span className="text-sm text-muted">editabile la programare</span>
          </div>
          <div className="grid gap-3">
            {baseServices.map((service) => (
              <article
                key={service.name}
                className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold">{service.name}</p>
                    <p className="mt-1 text-sm text-muted">
                      {service.duration} prestabilit
                    </p>
                  </div>
                  <p className="text-base font-semibold text-gold">
                    {formatPrice(service.price)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Cliente recente</h2>
            <span className="text-sm text-muted">{clients.length} in total</span>
          </div>
          <div className="grid gap-3">
            {clients.map((client) => (
              <article
                key={client.id}
                className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold">{client.name}</p>
                    <p className="mt-1 text-sm text-muted">
                      {client.visits === 0 ? "fara vizite" : `${client.visits} vizite`}
                    </p>
                  </div>
                  <p className="text-sm text-[#ddd4c5]">{client.lastVisit}</p>
                </div>
                {client.notes ? (
                  <p className="mt-3 text-sm leading-6 text-[#ddd4c5]">
                    {client.notes}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <nav className="gold-ring fixed inset-x-4 bottom-4 mx-auto flex w-auto max-w-md items-center justify-between rounded-[8px] border border-line bg-black/95 px-3 py-3 backdrop-blur">
          {[
            { label: "Acasa", active: true },
            { label: "Programari", active: false },
            { label: "Cliente", active: false },
            { label: "Setari", active: false },
          ].map(({ label, active }) => (
            <button
              key={label}
              className={`min-w-[72px] rounded-[8px] px-3 py-2 text-sm font-medium ${
                active
                  ? "bg-gold text-black"
                  : "text-muted transition hover:text-foreground"
              }`}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
    </main>
  );
}
