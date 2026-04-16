"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import {
  baseServices,
  formatPrice,
  initialAppointments,
  initialClients,
  mapAppointmentRow,
  mapClientRow,
  mapServiceRow,
} from "@/lib/demo-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  Appointment,
  Client,
  Service,
  SupabaseAppointmentRow,
  SupabaseClientRow,
  SupabaseServiceRow,
} from "@/lib/types";

const STORAGE_KEY = "solash-demo-store";
const OFFLINE_QUEUE_KEY = "solash-offline-queue";
const APPOINTMENT_SELECT_WITH_NOTES =
  "id, client_id, service, appointment_date, start_time, duration, price, status, notes, clients(name, phone)";
const APPOINTMENT_SELECT_WITHOUT_NOTES =
  "id, client_id, service, appointment_date, start_time, duration, price, status, clients(name, phone)";
const WORKDAY_START_MINUTES = 8 * 60;
const WORKDAY_END_MINUTES = 21 * 60;
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type LocalStore = {
  appointments: Appointment[];
  clients: Client[];
  services: Service[];
};

type OfflineOp =
  | { type: "upsert_client"; record: Client }
  | { type: "delete_client"; id: number }
  | { type: "upsert_appointment"; record: Appointment }
  | { type: "delete_appointment"; id: number }
  | { type: "upsert_service"; record: Service }
  | { type: "delete_service"; id: number };

type TabKey = "home" | "month" | "appointments" | "clients" | "settings";
type PanelKey = "appointment" | "client";
type PushLog = {
  id: number;
  source: string;
  title: string;
  body: string;
  sent_count: number;
  reminders_count: number;
  created_at: string;
};

const todayIso = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const humanDate = (dateString: string) =>
  new Intl.DateTimeFormat("ro-RO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${dateString}T12:00:00`));

const shortDayMonth = (dateString: string) => {
  const date = new Date(`${dateString}T12:00:00`);
  const day = `${date.getDate()}`;
  const month = new Intl.DateTimeFormat("ro-RO", { month: "short" }).format(date);
  return { day, month };
};

const formatLogDateTime = (value: string) =>
  new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const formatShortDate = (value: string) =>
  new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));

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
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (total: number) => {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${`${hours}`.padStart(2, "0")}:${`${minutes}`.padStart(2, "0")}`;
};

const base64ToUint8Array = (value: string) => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};

const formatPhoneForWhatsApp = (phone: string) => {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = `40${cleaned.slice(1)}`;
  }
  if (!cleaned.startsWith("40")) {
    cleaned = `40${cleaned}`;
  }
  return cleaned;
};

const statusBadgeClass = (status: string) => {
  if (status === "Confirmata") {
    return "bg-[#0f3b2b] text-[#a7f3d0]";
  }
  if (status === "Noua") {
    return "bg-[#3f3317] text-[#f7d998]";
  }
  if (status === "Reminder maine") {
    return "bg-[#2d2946] text-[#d7c7ff]";
  }
  if (status === "Finalizata") {
    return "bg-[#183247] text-[#b6e3ff]";
  }
  if (status === "Anulata") {
    return "bg-[#4a1f1f] text-[#ffc7c7]";
  }
  return "bg-black text-gold";
};

const defaultStore = (): LocalStore => ({
  appointments: initialAppointments,
  clients: initialClients,
  services: baseServices,
});

const readLocalStore = (): LocalStore => {
  if (typeof window === "undefined") {
    return defaultStore();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultStore();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalStore>;
    return {
      appointments: parsed.appointments ?? initialAppointments,
      clients: parsed.clients ?? initialClients,
      services: parsed.services ?? baseServices,
    };
  } catch {
    return defaultStore();
  }
};

const writeLocalStore = (store: LocalStore) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

const readOfflineQueue = (): OfflineOp[] => {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as OfflineOp[];
  } catch {
    return [];
  }
};

const writeOfflineQueue = (items: OfflineOp[]) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
};

const nextTempId = () => -Date.now();

const toWeekKey = (date: string) => {
  const target = new Date(`${date}T12:00:00`);
  const day = target.getDay() || 7;
  target.setDate(target.getDate() + 4 - day);
  const yearStart = new Date(target.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${target.getFullYear()}-${weekNo}`;
};

const toMonthKey = (date: string) => date.slice(0, 7);
const addDays = (date: string, days: number) => {
  const base = new Date(`${date}T12:00:00`);
  base.setDate(base.getDate() + days);
  const year = base.getFullYear();
  const month = `${base.getMonth() + 1}`.padStart(2, "0");
  const day = `${base.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const monthShift = (monthKey: string, delta: number) => {
  const date = new Date(`${monthKey}-01T12:00:00`);
  date.setMonth(date.getMonth() + delta);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
};

const isoFromDate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function Home() {
  const appointmentEditorRef = useRef<HTMLElement | null>(null);
  const appointmentFormCardRef = useRef<HTMLDivElement | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [activePanel, setActivePanel] = useState<PanelKey>("appointment");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>(baseServices);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [offlineBypass, setOfflineBypass] = useState(false);
  const [pendingOpsCount, setPendingOpsCount] = useState(() =>
    typeof window === "undefined" ? 0 : readOfflineQueue().length
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [isSavingAppointment, setIsSavingAppointment] = useState(false);
  const [isSavingService, setIsSavingService] = useState(false);
  const [supportsServicesTable, setSupportsServicesTable] = useState(false);
  const [supportsAppointmentNotes, setSupportsAppointmentNotes] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<number>(0);
  const [selectedServiceId, setSelectedServiceId] = useState<number>(
    baseServices[0]?.id ?? 0
  );
  const [appointmentDate, setAppointmentDate] = useState(todayIso());
  const [appointmentTime, setAppointmentTime] = useState("10:00");
  const [appointmentDuration, setAppointmentDuration] = useState(
    baseServices[0]?.duration ?? "2h"
  );
  const [appointmentPrice, setAppointmentPrice] = useState(baseServices[0]?.price ?? 0);
  const [appointmentStatus, setAppointmentStatus] = useState("Noua");
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [editingAppointmentId, setEditingAppointmentId] = useState<number | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientNotes, setClientNotes] = useState("");
  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [serviceName, setServiceName] = useState("");
  const [serviceDuration, setServiceDuration] = useState("");
  const [servicePrice, setServicePrice] = useState(0);
  const [serviceActive, setServiceActive] = useState(true);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [appointmentClientFilter, setAppointmentClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("toate");
  const [selectedMonth, setSelectedMonth] = useState(() => todayIso().slice(0, 7));
  const [showMonthDayView, setShowMonthDayView] = useState(false);
  const [scrollToEditorTick, setScrollToEditorTick] = useState(0);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(
    "default"
  );
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [pushLogs, setPushLogs] = useState<PushLog[]>([]);
  const [isLoadingPushLogs, setIsLoadingPushLogs] = useState(false);
  const [toast, setToast] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const refreshPushState = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      window.isSecureContext;

    if (!supported) {
      setPushSupported(false);
      setPushPermission("unsupported");
      setPushEnabled(false);
      return;
    }

    setPushSupported(true);
    setPushPermission(Notification.permission);

    const registration = await navigator.serviceWorker.register("/sw.js");
    const existing = await registration.pushManager.getSubscription();
    setPushEnabled(Boolean(existing));
  }, []);

  useEffect(() => {
    void refreshPushState();
  }, [refreshPushState]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setOfflineBypass(false);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        setOfflineBypass(false);
      }
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const loadData = async () => {
      if (isSupabaseConfigured && !session) {
        if (!isOnline) {
          const local = readLocalStore();
          setClients(local.clients);
          setAppointments(local.appointments);
          setServices(local.services);
          setSelectedClientId(local.clients[0]?.id ?? 0);
          setSelectedServiceId(local.services[0]?.id ?? 0);
          setAppointmentDuration(local.services[0]?.duration ?? "2h");
          setAppointmentPrice(local.services[0]?.price ?? 0);
          setOfflineBypass(true);
          setToast({
            text: "Esti offline. Rulezi temporar din cache local.",
            type: "success",
          });
        }
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      if (!isSupabaseConfigured || !supabase) {
        const local = readLocalStore();
        setClients(local.clients);
        setAppointments(local.appointments);
        setServices(local.services);
        setSelectedClientId(local.clients[0]?.id ?? 0);
        setSelectedServiceId(local.services[0]?.id ?? 0);
        setAppointmentDuration(local.services[0]?.duration ?? "2h");
        setAppointmentPrice(local.services[0]?.price ?? 0);
        setToast({
          text: "Mod demo activ. Pentru salvare reala, conecteaza Supabase.",
          type: "success",
        });
        setIsLoading(false);
        return;
      }

      const clientsPromise = supabase.from("clients").select("*").order("name", {
        ascending: true,
      });

      const appointmentsWithNotesPromise = supabase
        .from("appointments")
        .select(APPOINTMENT_SELECT_WITH_NOTES)
        .order("appointment_date", { ascending: true })
        .order("start_time", { ascending: true });

      const servicesPromise = supabase
        .from("services")
        .select("*")
        .order("name", { ascending: true });

      const [clientsResponse, appointmentsResponse, servicesResponse] = await Promise.all([
        clientsPromise,
        appointmentsWithNotesPromise,
        servicesPromise,
      ]);

      let appointmentRows: SupabaseAppointmentRow[] = [];
      let serviceRows: SupabaseServiceRow[] = [];
      let hasNotesColumn = !appointmentsResponse.error;
      let hasServicesTable = !servicesResponse.error;

      if (appointmentsResponse.error) {
        const fallbackAppointments = await supabase
          .from("appointments")
          .select(APPOINTMENT_SELECT_WITHOUT_NOTES)
          .order("appointment_date", { ascending: true })
          .order("start_time", { ascending: true });

        if (fallbackAppointments.error) {
          console.error("Appointments error:", fallbackAppointments.error);
        } else {
          appointmentRows = fallbackAppointments.data.map((row) => ({
            ...row,
            notes: "",
          })) as SupabaseAppointmentRow[];
          hasNotesColumn = false;
        }
      } else {
        appointmentRows = appointmentsResponse.data as SupabaseAppointmentRow[];
      }

      if (servicesResponse.error) {
        hasServicesTable = false;
      } else {
        serviceRows = servicesResponse.data as SupabaseServiceRow[];
      }

      if (clientsResponse.error) {
        console.error("Clients error:", clientsResponse.error);
        const local = readLocalStore();
        setClients(local.clients);
        setAppointments(local.appointments);
        setServices(local.services);
        setSelectedClientId(local.clients[0]?.id ?? 0);
        setSelectedServiceId(local.services[0]?.id ?? 0);
        setToast({
          text: "Nu am putut incarca datele din Supabase. Aplicatia a trecut pe local.",
          type: "error",
        });
        setIsLoading(false);
        return;
      }

      const nextClients = clientsResponse.data.map(mapClientRow as (row: SupabaseClientRow) => Client);
      const nextAppointments = appointmentRows.map(mapAppointmentRow);
      const localServices = readLocalStore().services;
      const nextServices = hasServicesTable
        ? serviceRows.map(mapServiceRow)
        : localServices.length > 0
          ? localServices
          : baseServices;

      setSupportsServicesTable(hasServicesTable);
      setSupportsAppointmentNotes(hasNotesColumn);
      setClients(nextClients);
      setAppointments(nextAppointments);
      setServices(nextServices);
      setSelectedClientId(nextClients[0]?.id ?? 0);
      setSelectedServiceId(nextServices[0]?.id ?? 0);
      setAppointmentDuration(nextServices[0]?.duration ?? "2h");
      setAppointmentPrice(nextServices[0]?.price ?? 0);
      if (!hasServicesTable) {
        setToast({
          text: "Tabela services lipseste, folosesc valorile locale.",
          type: "error",
        });
      }
      setIsLoading(false);
    };

    if (!authReady) {
      return;
    }

    void loadData();
  }, [authReady, session, isOnline]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (scrollToEditorTick === 0) {
      return;
    }

    const first = window.requestAnimationFrame(() => {
      const second = window.requestAnimationFrame(() => {
        const target =
          activePanel === "appointment"
            ? appointmentFormCardRef.current
            : appointmentEditorRef.current;
        target?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      return () => window.cancelAnimationFrame(second);
    });

    return () => window.cancelAnimationFrame(first);
  }, [activePanel, scrollToEditorTick]);

  useEffect(() => {
    setSelectedMonth(toMonthKey(appointmentDate));
  }, [appointmentDate]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? clients[0],
    [clients, selectedClientId]
  );

  const activeServices = useMemo(
    () => services.filter((service) => service.active),
    [services]
  );

  const appointmentsForSelectedDate = useMemo(() => {
    const list = appointments.filter((appointment) => appointment.date === appointmentDate);
    const filtered =
      statusFilter === "toate"
        ? list
        : list.filter((appointment) => appointment.status === statusFilter);
    return filtered.sort((a, b) => a.start.localeCompare(b.start));
  }, [appointmentDate, appointments, statusFilter]);

  const appointmentsForDayAll = useMemo(
    () =>
      appointments
        .filter((appointment) => appointment.date === appointmentDate)
        .sort((a, b) => a.start.localeCompare(b.start)),
    [appointmentDate, appointments]
  );

  const dayTimeline = useMemo(() => {
    const active = appointmentsForDayAll.filter(
      (appointment) => appointment.status !== "Anulata"
    );
    const segments: Array<
      | { kind: "free"; start: number; end: number; minutes: number }
      | {
          kind: "busy";
          start: number;
          end: number;
          minutes: number;
          appointment: Appointment;
        }
    > = [];

    let cursor = WORKDAY_START_MINUTES;

    for (const appointment of active) {
      const start = Math.max(WORKDAY_START_MINUTES, timeToMinutes(appointment.start));
      const end = Math.min(
        WORKDAY_END_MINUTES,
        start + parseDurationToMinutes(appointment.duration)
      );
      if (end <= WORKDAY_START_MINUTES || start >= WORKDAY_END_MINUTES) {
        continue;
      }
      if (start > cursor) {
        segments.push({
          kind: "free",
          start: cursor,
          end: start,
          minutes: start - cursor,
        });
      }
      if (end > start) {
        segments.push({
          kind: "busy",
          start,
          end,
          minutes: end - start,
          appointment,
        });
      }
      cursor = Math.max(cursor, end);
    }

    if (cursor < WORKDAY_END_MINUTES) {
      segments.push({
        kind: "free",
        start: cursor,
        end: WORKDAY_END_MINUTES,
        minutes: WORKDAY_END_MINUTES - cursor,
      });
    }

    const totalFreeMinutes = segments
      .filter((segment) => segment.kind === "free")
      .reduce((sum, segment) => sum + segment.minutes, 0);

    return {
      segments,
      totalFreeMinutes,
      activeCount: active.length,
    };
  }, [appointmentsForDayAll]);

  const currentWeekKey = toWeekKey(appointmentDate);
  const currentMonthKey = toMonthKey(appointmentDate);
  const selectedDateBadge = useMemo(
    () => shortDayMonth(appointmentDate),
    [appointmentDate]
  );
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ro-RO", {
        month: "long",
        year: "numeric",
      }).format(new Date(`${selectedMonth}-01T12:00:00`)),
    [selectedMonth]
  );

  const calendarDayStats = useMemo(() => {
    const stats = new Map<string, { count: number; busyMinutes: number }>();
    for (const appointment of appointments) {
      if (appointment.status === "Anulata") {
        continue;
      }
      const minutes = parseDurationToMinutes(appointment.duration);
      const current = stats.get(appointment.date) ?? { count: 0, busyMinutes: 0 };
      current.count += 1;
      current.busyMinutes += minutes;
      stats.set(appointment.date, current);
    }
    return stats;
  }, [appointments]);

  const calendarCapacity = useMemo(() => {
    const workdayMinutes = WORKDAY_END_MINUTES - WORKDAY_START_MINUTES;
    const serviceDurations = activeServices
      .map((service) => parseDurationToMinutes(service.duration))
      .filter((minutes) => minutes > 0);
    const rawSlot = serviceDurations.length > 0 ? Math.min(...serviceDurations) : 120;
    const slotMinutes = Math.max(30, rawSlot);
    return {
      workdayMinutes,
      slotMinutes,
      maxAppointments: Math.max(1, Math.floor(workdayMinutes / slotMinutes)),
    };
  }, [activeServices]);

  const monthGridDays = useMemo(() => {
    const monthStart = new Date(`${selectedMonth}-01T12:00:00`);
    const start = new Date(monthStart);
    const weekday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - weekday);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const iso = isoFromDate(date);
      const stat = calendarDayStats.get(iso) ?? { count: 0, busyMinutes: 0 };
      const freeMinutes = Math.max(0, calendarCapacity.workdayMinutes - stat.busyMinutes);
      return {
        iso,
        day: date.getDate(),
        inCurrentMonth: toMonthKey(iso) === selectedMonth,
        isSelected: iso === appointmentDate,
        count: stat.count,
        busyMinutes: stat.busyMinutes,
        freeMinutes,
        slotsLeft: Math.max(0, Math.floor(freeMinutes / calendarCapacity.slotMinutes)),
      };
    });
  }, [appointmentDate, calendarCapacity, calendarDayStats, selectedMonth]);

  const monthQuickPicks = useMemo(
    () => [
      monthShift(selectedMonth, -2),
      monthShift(selectedMonth, -1),
      selectedMonth,
      monthShift(selectedMonth, 1),
      monthShift(selectedMonth, 2),
    ],
    [selectedMonth]
  );

  const dailyRevenue = appointmentsForSelectedDate
    .filter((appointment) => appointment.status !== "Anulata")
    .reduce((sum, appointment) => sum + appointment.price, 0);

  const weeklyRevenue = appointments
    .filter(
      (appointment) =>
        appointment.status !== "Anulata" && toWeekKey(appointment.date) === currentWeekKey
    )
    .reduce((sum, appointment) => sum + appointment.price, 0);

  const monthlyRevenue = appointments
    .filter(
      (appointment) =>
        appointment.status !== "Anulata" && toMonthKey(appointment.date) === currentMonthKey
    )
    .reduce((sum, appointment) => sum + appointment.price, 0);

  const todaysWindow = useMemo(() => {
    if (appointmentsForSelectedDate.length === 0) {
      return "Fara programari";
    }
    const first = appointmentsForSelectedDate[0];
    const last = appointmentsForSelectedDate[appointmentsForSelectedDate.length - 1];
    return `${first.start} - ${last.start}`;
  }, [appointmentsForSelectedDate]);

  const reminderDate = addDays(appointmentDate, 1);
  const reminderCount = appointments.filter(
    (appointment) =>
      appointment.date === reminderDate &&
      appointment.status !== "Anulata" &&
      appointment.status !== "Finalizata"
  ).length;

  const nextUpcomingAppointment = useMemo(() => {
    const now = new Date();
    const currentDate = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
    const currentTime = `${`${now.getHours()}`.padStart(2, "0")}:${`${now.getMinutes()}`.padStart(2, "0")}`;
    return [...appointments]
      .filter(
        (appointment) =>
          appointment.status !== "Anulata" &&
          (appointment.date > currentDate ||
            (appointment.date === currentDate && appointment.start >= currentTime))
      )
      .sort((a, b) => {
        if (a.date === b.date) {
          return a.start.localeCompare(b.start);
        }
        return a.date.localeCompare(b.date);
      })[0];
  }, [appointments]);

  const upcomingSummary = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
    const tomorrow = addDays(today, 1);
    const currentTime = `${`${now.getHours()}`.padStart(2, "0")}:${`${now.getMinutes()}`.padStart(2, "0")}`;

    const baseFilter = (appointment: Appointment) =>
      appointment.status !== "Anulata" && appointment.status !== "Finalizata";

    const todayList = appointments
      .filter(
        (appointment) =>
          baseFilter(appointment) &&
          appointment.date === today &&
          appointment.start >= currentTime
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 3);

    const tomorrowList = appointments
      .filter((appointment) => baseFilter(appointment) && appointment.date === tomorrow)
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 3);

    return { todayList, tomorrowList };
  }, [appointments]);

  const clientActivityById = useMemo(() => {
    const map = new Map<number, { visits: number; lastVisit: string }>();

    for (const client of clients) {
      map.set(client.id, { visits: client.visits, lastVisit: client.lastVisit });
    }

    for (const client of clients) {
      const completed = appointments
        .filter(
          (appointment) =>
            appointment.clientId === client.id &&
            appointment.status === "Finalizata"
        )
        .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));

      if (completed.length > 0) {
        const latest = completed[completed.length - 1];
        map.set(client.id, {
          visits: completed.length,
          lastVisit: formatShortDate(latest.date),
        });
      }
    }

    return map;
  }, [appointments, clients]);

  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    const list = [...clients].sort((a, b) => a.name.localeCompare(b.name, "ro"));
    if (!term) {
      return list;
    }
    return list.filter(
      (client) =>
        client.name.toLowerCase().includes(term) ||
        client.phone.toLowerCase().includes(term) ||
        client.notes.toLowerCase().includes(term)
    );
  }, [clientSearch, clients]);

  const filteredClientsForAppointment = useMemo(() => {
    const term = appointmentClientFilter.trim().toLowerCase();
    const list = [...clients].sort((a, b) => a.name.localeCompare(b.name, "ro"));
    if (!term) {
      return list;
    }
    return list.filter(
      (client) =>
        client.name.toLowerCase().includes(term) ||
        client.phone.toLowerCase().includes(term)
    );
  }, [appointmentClientFilter, clients]);

  const calendarSelected = useMemo(
    () => new Date(`${appointmentDate}T12:00:00`),
    [appointmentDate]
  );

  const persistLocalState = (next: Partial<LocalStore>) => {
    const current = readLocalStore();
    writeLocalStore({
      appointments: next.appointments ?? current.appointments,
      clients: next.clients ?? current.clients,
      services: next.services ?? current.services,
    });
  };

  const enqueueOfflineOp = (op: OfflineOp) => {
    const next = [...readOfflineQueue(), op];
    writeOfflineQueue(next);
    setPendingOpsCount(next.length);
  };

  const flushOfflineQueue = useCallback(async () => {
    if (!supabase || !session || !isOnline) {
      return;
    }

    const queue = readOfflineQueue();
    if (queue.length === 0) {
      setPendingOpsCount(0);
      return;
    }

    const clientIdMap: Record<number, number> = {};
    const appointmentIdMap: Record<number, number> = {};
    const serviceIdMap: Record<number, number> = {};

    for (const op of queue) {
      if (op.type === "upsert_client") {
        const rec = op.record;
        if (rec.id > 0) {
          const { error } = await supabase
            .from("clients")
            .update({
              name: rec.name,
              phone: rec.phone,
              notes: rec.notes,
            })
            .eq("id", rec.id);
          if (error) {
            return;
          }
        } else {
          const { data, error } = await supabase
            .from("clients")
            .insert({
              name: rec.name,
              phone: rec.phone,
              notes: rec.notes,
              visits: rec.visits,
              last_visit_label: rec.lastVisit,
            })
            .select("*")
            .single();
          if (error) {
            return;
          }
          const mapped = mapClientRow(data);
          clientIdMap[rec.id] = mapped.id;
          setClients((current) =>
            current.map((client) => (client.id === rec.id ? mapped : client))
          );
          setAppointments((current) =>
            current.map((appointment) =>
              appointment.clientId === rec.id
                ? {
                    ...appointment,
                    clientId: mapped.id,
                    clientName: mapped.name,
                    phone: mapped.phone,
                  }
                : appointment
            )
          );
        }
      }

      if (op.type === "delete_client") {
        const targetId = clientIdMap[op.id] ?? op.id;
        if (targetId > 0) {
          const { error } = await supabase.from("clients").delete().eq("id", targetId);
          if (error) {
            return;
          }
        }
      }

      if (op.type === "upsert_appointment") {
        const rec = op.record;
        const mappedClientId = clientIdMap[rec.clientId] ?? rec.clientId;
        const payload = {
          client_id: mappedClientId,
          service: rec.service,
          appointment_date: rec.date,
          start_time: rec.start,
          duration: rec.duration,
          price: rec.price,
          status: rec.status,
          ...(supportsAppointmentNotes ? { notes: rec.notes } : {}),
        };

        if (rec.id > 0) {
          const { error } = await supabase
            .from("appointments")
            .update(payload)
            .eq("id", rec.id);
          if (error) {
            return;
          }
        } else {
          const { data, error } = await supabase
            .from("appointments")
            .insert(payload)
            .select(
              supportsAppointmentNotes
                ? APPOINTMENT_SELECT_WITH_NOTES
                : APPOINTMENT_SELECT_WITHOUT_NOTES
            )
            .single();
          if (error) {
            return;
          }
          const row = supportsAppointmentNotes
            ? (data as unknown as SupabaseAppointmentRow)
            : ({ ...(data as object), notes: "" } as SupabaseAppointmentRow);
          const mapped = mapAppointmentRow(row);
          appointmentIdMap[rec.id] = mapped.id;
          setAppointments((current) =>
            current.map((appointment) =>
              appointment.id === rec.id ? mapped : appointment
            )
          );
        }
      }

      if (op.type === "delete_appointment") {
        const targetId = appointmentIdMap[op.id] ?? op.id;
        if (targetId > 0) {
          const { error } = await supabase
            .from("appointments")
            .delete()
            .eq("id", targetId);
          if (error) {
            return;
          }
        }
      }

      if (op.type === "upsert_service" && supportsServicesTable) {
        const rec = op.record;
        if (rec.id > 0) {
          const { error } = await supabase
            .from("services")
            .update({
              name: rec.name,
              duration: rec.duration,
              price: rec.price,
              active: rec.active,
            })
            .eq("id", rec.id);
          if (error) {
            return;
          }
        } else {
          const { data, error } = await supabase
            .from("services")
            .insert({
              name: rec.name,
              duration: rec.duration,
              price: rec.price,
              active: rec.active,
            })
            .select("*")
            .single();
          if (error) {
            return;
          }
          const mapped = mapServiceRow(data as SupabaseServiceRow);
          serviceIdMap[rec.id] = mapped.id;
          setServices((current) =>
            current.map((service) => (service.id === rec.id ? mapped : service))
          );
        }
      }

      if (op.type === "delete_service" && supportsServicesTable) {
        const targetId = serviceIdMap[op.id] ?? op.id;
        if (targetId > 0) {
          const { error } = await supabase.from("services").delete().eq("id", targetId);
          if (error) {
            return;
          }
        }
      }
    }

    writeOfflineQueue([]);
    setPendingOpsCount(0);
    setToast({ text: "Datele adaugate offline au fost sincronizate.", type: "success" });
  }, [isOnline, session, supportsAppointmentNotes, supportsServicesTable]);

  useEffect(() => {
    if (!isSupabaseConfigured || !session || !isOnline) {
      return;
    }
    const timer = window.setTimeout(() => {
      void flushOfflineQueue();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [flushOfflineQueue, isOnline, session]);

  useEffect(() => {
    if (clients.length === 0 && appointments.length === 0 && services.length === 0) {
      return;
    }
    writeLocalStore({ clients, appointments, services });
  }, [clients, appointments, services]);

  const resetAppointmentForm = (service?: Service) => {
    const source = service ?? activeServices[0] ?? services[0] ?? baseServices[0];
    setEditingAppointmentId(null);
    setSelectedServiceId(source?.id ?? 0);
    setAppointmentTime("10:00");
    setAppointmentDate(todayIso());
    setAppointmentDuration(source?.duration ?? "2h");
    setAppointmentPrice(source?.price ?? 0);
    setAppointmentStatus("Noua");
    setAppointmentNotes("");
    setAppointmentClientFilter("");
  };

  const resetClientForm = () => {
    setEditingClientId(null);
    setClientName("");
    setClientPhone("");
    setClientNotes("");
  };

  const resetServiceForm = () => {
    setEditingServiceId(null);
    setServiceName("");
    setServiceDuration("");
    setServicePrice(0);
    setServiceActive(true);
  };

  const handleServiceSelection = (serviceId: number) => {
    setSelectedServiceId(serviceId);
    const service = services.find((item) => item.id === serviceId);
    if (!service) {
      return;
    }
    setAppointmentDuration(service.duration);
    setAppointmentPrice(service.price);
  };

  const hasConflict = (
    id: number | null,
    newStart: string,
    newDuration: string,
    existing: Appointment[]
  ) => {
    const toMinutes = (time: string) => {
      const [hours, minutes] = time.split(":").map(Number);
      return hours * 60 + minutes;
    };

    const newStartMin = toMinutes(newStart);
    const newEndMin = newStartMin + parseDurationToMinutes(newDuration);

    return existing.some((appointment) => {
      if (id && appointment.id === id) {
        return false;
      }
      const start = toMinutes(appointment.start);
      const end = start + parseDurationToMinutes(appointment.duration);
      return newStartMin < end && newEndMin > start;
    });
  };

  const handleAuth = async () => {
    if (!supabase) {
      return;
    }

    if (!authEmail.trim() || !authPassword.trim()) {
      setToast({ text: "Completeaza emailul si parola.", type: "error" });
      return;
    }

    setAuthBusy(true);
    const response = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });

    if (response.error) {
      setToast({ text: response.error.message, type: "error" });
      setAuthBusy(false);
      return;
    }

    setToast({
      text: "Autentificare reusita.",
      type: "success",
    });
    setAuthBusy(false);
  };

  const handleEnablePush = async () => {
    if (!pushSupported) {
      setToast({
        text: "Push notifications nu sunt disponibile pe acest dispozitiv/browser.",
        type: "error",
      });
      return;
    }

    if (!vapidPublicKey) {
      setToast({
        text: "Lipseste NEXT_PUBLIC_VAPID_PUBLIC_KEY in configurare.",
        type: "error",
      });
      return;
    }

    setPushBusy(true);

    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== "granted") {
        setToast({
          text: "Trebuie sa permiti notificarile pentru SoLash.",
          type: "error",
        });
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(vapidPublicKey),
        }));

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ subscription }),
      });

      if (!response.ok) {
        throw new Error("Failed subscribe");
      }

      setPushEnabled(true);
      setToast({
        text: "Notificarile push au fost activate. Reminder zilnic la 20:30.",
        type: "success",
      });
    } catch {
      setToast({
        text: "Nu am putut activa notificarile push.",
        type: "error",
      });
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (!pushSupported) {
      return;
    }

    setPushBusy(true);

    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setPushEnabled(false);
      setToast({
        text: "Notificarile push au fost dezactivate.",
        type: "success",
      });
    } catch {
      setToast({
        text: "Nu am putut dezactiva notificarile push.",
        type: "error",
      });
    } finally {
      setPushBusy(false);
    }
  };

  const handleWhatsAppConfirm = async (appointment: Appointment) => {
    const text = `Buna, ${appointment.clientName}! Confirmam programarea ta SoLash pentru ${appointment.date} la ${appointment.start}. Te asteptam cu drag!`;
    window.open(
      `https://wa.me/${formatPhoneForWhatsApp(appointment.phone)}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );

    if (appointment.status !== "Confirmata") {
      await handleUpdateStatus(appointment.id, "Confirmata");
    }
  };

  const handleTestPush = async () => {
    if (!session?.access_token) {
      setToast({ text: "Trebuie sa fii autentificata pentru test.", type: "error" });
      return;
    }
    setPushTestBusy(true);
    try {
      const response = await fetch("/api/push/send-test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Push test failed");
      }

      const result = (await response.json()) as { ok: boolean; sent?: number };
      setToast({
        text:
          (result.sent ?? 0) > 0
            ? "Notificarea de test a fost trimisa."
            : "Nu exista device-uri active pentru notificari.",
        type: (result.sent ?? 0) > 0 ? "success" : "error",
      });
    } catch {
      setToast({ text: "Testul push a esuat.", type: "error" });
    } finally {
      setPushTestBusy(false);
      void loadPushLogs();
    }
  };

  const loadPushLogs = useCallback(async () => {
    if (!session?.access_token) {
      setPushLogs([]);
      return;
    }

    setIsLoadingPushLogs(true);
    try {
      const response = await fetch("/api/push/logs", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!response.ok) {
        throw new Error("Failed to load logs");
      }
      const result = (await response.json()) as { ok: boolean; logs?: PushLog[] };
      setPushLogs(result.logs ?? []);
    } catch {
      setPushLogs([]);
    } finally {
      setIsLoadingPushLogs(false);
    }
  }, [session?.access_token]);

  const csvEscape = (value: string | number) =>
    `"${`${value ?? ""}`.replace(/"/g, '""')}"`;

  const csvRow = (values: Array<string | number>) => values.map(csvEscape).join(",");

  const downloadCsv = (filename: string, content: string) => {
    const normalized = content.replace(/\n/g, "\r\n");

    const blob = new Blob([normalized], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const handleExportCsv = async () => {
    setIsExportingCsv(true);
    try {
      const clientsRows = [...clients]
        .sort((a, b) => a.name.localeCompare(b.name, "ro"))
        .map((client) => {
          const activity = clientActivityById.get(client.id);
          return [
            client.name,
            client.phone,
            client.notes,
            activity?.visits ?? client.visits,
            activity?.lastVisit ?? client.lastVisit,
          ];
        });

      const appointmentsRows = [...appointments]
        .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)))
        .map((appointment) => [
          appointment.date,
          appointment.start,
          appointment.clientName,
          appointment.phone,
          appointment.service,
          appointment.duration,
          appointment.price,
          appointment.status,
          appointment.notes,
        ]);

      const csvContent = [
        csvRow(["CLIENTE"]),
        csvRow(["Nume", "Telefon", "Observatii", "Vizite", "Ultima vizita"]),
        ...clientsRows.map((row) => csvRow(row)),
        "",
        csvRow(["PROGRAMARI"]),
        csvRow(["Data", "Ora", "Clienta", "Telefon", "Serviciu", "Durata", "Pret", "Status", "Observatii"]),
        ...appointmentsRows.map((row) => csvRow(row)),
      ].join("\n");

      downloadCsv(`solash-export-${todayIso()}.csv`, csvContent);

      setToast({
        text: "Am exportat CSV complet (cliente + programari).",
        type: "success",
      });
    } catch {
      setToast({ text: "Nu am putut exporta CSV.", type: "error" });
    } finally {
      setIsExportingCsv(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "settings") {
      return;
    }
    void loadPushLogs();
  }, [activeTab, loadPushLogs]);

  const handleSignOut = async () => {
    if (!supabase) {
      return;
    }
    await supabase.auth.signOut();
    setToast({ text: "Te-ai delogat.", type: "success" });
  };

  const handleSaveClient = async () => {
    if (!clientName.trim() || !clientPhone.trim()) {
      setToast({ text: "Completeaza numele si telefonul clientei.", type: "error" });
      return;
    }

    setIsSavingClient(true);
    const payload = {
      name: clientName.trim(),
      phone: clientPhone.trim(),
      notes: clientNotes.trim(),
      visits: 0,
      lastVisit: editingClientId ? undefined : "noua",
    };

    if (!isSupabaseConfigured || !supabase || !session || !isOnline || (editingClientId ?? 1) < 0) {
      let nextClients: Client[];
      if (editingClientId) {
        const updatedClient = clients.find((client) => client.id === editingClientId);
        nextClients = clients.map((client) =>
          client.id === editingClientId
            ? {
                ...client,
                name: payload.name,
                phone: payload.phone,
                notes: payload.notes,
              }
            : client
        );
        if (updatedClient && isSupabaseConfigured) {
          enqueueOfflineOp({
            type: "upsert_client",
            record: {
              ...updatedClient,
              name: payload.name,
              phone: payload.phone,
              notes: payload.notes,
            },
          });
        }
      } else {
        const newId = isSupabaseConfigured ? nextTempId() : Date.now();
        const created: Client = {
          id: newId,
          name: payload.name,
          phone: payload.phone,
          notes: payload.notes,
          visits: 0,
          lastVisit: "noua",
        };
        nextClients = [
          created,
          ...clients,
        ];
        if (isSupabaseConfigured) {
          enqueueOfflineOp({
            type: "upsert_client",
            record: created,
          });
        }
      }
      setClients(nextClients);
      persistLocalState({ clients: nextClients });
      setSelectedClientId(nextClients[0]?.id ?? 0);
      setToast({
        text: !isOnline && isSupabaseConfigured
          ? "Salvat offline. Se sincronizeaza cand revine internetul."
          : editingClientId
            ? "Clienta a fost actualizata."
            : "Clienta a fost salvata.",
        type: "success",
      });
    } else if (editingClientId) {
      const response = await supabase
        .from("clients")
        .update({
          name: payload.name,
          phone: payload.phone,
          notes: payload.notes,
        })
        .eq("id", editingClientId)
        .select("*")
        .single();

      if (response.error) {
        const nextClients = clients.map((client) =>
          client.id === editingClientId
            ? { ...client, name: payload.name, phone: payload.phone, notes: payload.notes }
            : client
        );
        setClients(nextClients);
        persistLocalState({ clients: nextClients });
        const changed = nextClients.find((client) => client.id === editingClientId);
        if (changed) {
          enqueueOfflineOp({ type: "upsert_client", record: changed });
        }
        setToast({
          text: "Clienta a fost actualizata offline. Se sincronizeaza la reconectare.",
          type: "success",
        });
        resetClientForm();
        setActivePanel("appointment");
        setActiveTab("appointments");
        setIsSavingClient(false);
        return;
      }

      const updatedClient = mapClientRow(response.data);
      setClients((current) =>
        current.map((client) =>
          client.id === editingClientId ? updatedClient : client
        )
      );
      setToast({ text: "Clienta a fost actualizata.", type: "success" });
    } else {
      const response = await supabase
        .from("clients")
        .insert({
          name: payload.name,
          phone: payload.phone,
          notes: payload.notes,
          visits: 0,
          last_visit_label: "noua",
        })
        .select("*")
        .single();

      if (response.error) {
        setToast({ text: "Nu am putut salva clienta in Supabase.", type: "error" });
        setIsSavingClient(false);
        return;
      }

      const newClient = mapClientRow(response.data);
      setClients((current) => [newClient, ...current]);
      setSelectedClientId(newClient.id);
      setToast({ text: "Clienta a fost salvata in Supabase.", type: "success" });
    }

    resetClientForm();
    setActivePanel("appointment");
    setActiveTab("appointments");
    setIsSavingClient(false);
  };

  const startEditClient = (client: Client) => {
    setActiveTab("appointments");
    setActivePanel("client");
    setEditingClientId(client.id);
    setClientName(client.name);
    setClientPhone(client.phone);
    setClientNotes(client.notes);
    setScrollToEditorTick((value) => value + 1);
  };

  const handleDeleteClient = async (clientId: number) => {
    if (!confirm("Sigur vrei sa stergi clienta?")) {
      return;
    }

    if (!isSupabaseConfigured || !supabase || !session || !isOnline || clientId < 0) {
      const nextClients = clients.filter((client) => client.id !== clientId);
      const nextAppointments = appointments.filter(
        (appointment) => appointment.clientId !== clientId
      );
      setClients(nextClients);
      setAppointments(nextAppointments);
      persistLocalState({ clients: nextClients, appointments: nextAppointments });
      if (isSupabaseConfigured) {
        enqueueOfflineOp({ type: "delete_client", id: clientId });
      }
      setToast({
        text:
          !isOnline && isSupabaseConfigured
            ? "Stearsa offline. Se sincronizeaza cand revine internetul."
            : "Clienta a fost stearsa local.",
        type: "success",
      });
      return;
    }

    const { error } = await supabase.from("clients").delete().eq("id", clientId);
    if (error) {
      setToast({ text: "Nu am putut sterge clienta.", type: "error" });
      return;
    }

    setClients((current) => current.filter((client) => client.id !== clientId));
    setAppointments((current) =>
      current.filter((appointment) => appointment.clientId !== clientId)
    );
    setToast({ text: "Clienta a fost stearsa.", type: "success" });
  };

  const handleSaveAppointment = async () => {
    if (!selectedClient) {
      setToast({ text: "Adauga mai intai o clienta.", type: "error" });
      return;
    }

    const service = services.find((item) => item.id === selectedServiceId);
    if (!service) {
      setToast({ text: "Selecteaza un serviciu valid.", type: "error" });
      return;
    }

    const dayAppointments = appointments.filter(
      (appointment) => appointment.date === appointmentDate
    );
    if (
      hasConflict(
        editingAppointmentId,
        appointmentTime,
        appointmentDuration,
        dayAppointments
      )
    ) {
      setToast({
        text: "Exista deja o programare care se suprapune in acel interval.",
        type: "error",
      });
      return;
    }

    setIsSavingAppointment(true);

    const optimisticAppointment: Appointment = {
      id: editingAppointmentId ?? (isSupabaseConfigured ? nextTempId() : Date.now()),
      clientId: selectedClient.id,
      clientName: selectedClient.name,
      service: service.name,
      date: appointmentDate,
      start: appointmentTime,
      duration: appointmentDuration,
      price: appointmentPrice,
      phone: selectedClient.phone,
      status: appointmentStatus,
      notes: appointmentNotes.trim(),
    };

    if (
      !isSupabaseConfigured ||
      !supabase ||
      !session ||
      !isOnline ||
      (editingAppointmentId ?? 1) < 0 ||
      selectedClient.id < 0
    ) {
      const nextAppointments = editingAppointmentId
        ? appointments.map((appointment) =>
            appointment.id === editingAppointmentId ? optimisticAppointment : appointment
          )
        : [...appointments, optimisticAppointment];
      const sorted = nextAppointments.sort((a, b) => {
        if (a.date === b.date) {
          return a.start.localeCompare(b.start);
        }
        return a.date.localeCompare(b.date);
      });
      setAppointments(sorted);
      persistLocalState({ appointments: sorted });
      if (isSupabaseConfigured) {
        enqueueOfflineOp({
          type: "upsert_appointment",
          record: optimisticAppointment,
        });
      }
      setToast({
        text:
          !isOnline && isSupabaseConfigured
            ? "Programare salvata offline. Se sincronizeaza la reconectare."
            : editingAppointmentId
              ? "Programarea a fost actualizata."
              : "Programarea a fost salvata.",
        type: "success",
      });
      resetAppointmentForm(service);
      setIsSavingAppointment(false);
      setActiveTab("home");
      return;
    }

    const payloadBase = {
      client_id: selectedClient.id,
      service: service.name,
      appointment_date: appointmentDate,
      start_time: appointmentTime,
      duration: appointmentDuration,
      price: appointmentPrice,
      status: appointmentStatus,
    };

    if (editingAppointmentId) {
      const response = await supabase
        .from("appointments")
        .update(
          supportsAppointmentNotes
            ? { ...payloadBase, notes: appointmentNotes.trim() }
            : payloadBase
        )
        .eq("id", editingAppointmentId)
        .select(
          supportsAppointmentNotes
            ? APPOINTMENT_SELECT_WITH_NOTES
            : APPOINTMENT_SELECT_WITHOUT_NOTES
        )
        .single();

      if (response.error) {
        const nextAppointments = appointments
          .map((appointment) =>
            appointment.id === editingAppointmentId ? optimisticAppointment : appointment
          )
          .sort((a, b) => {
            if (a.date === b.date) {
              return a.start.localeCompare(b.start);
            }
            return a.date.localeCompare(b.date);
          });
        setAppointments(nextAppointments);
        persistLocalState({ appointments: nextAppointments });
        enqueueOfflineOp({
          type: "upsert_appointment",
          record: optimisticAppointment,
        });
        setToast({
          text: "Programarea a fost actualizata offline. Se sincronizeaza la reconectare.",
          type: "success",
        });
        resetAppointmentForm(service);
        setIsSavingAppointment(false);
        setActiveTab("home");
        return;
      }

      const row = supportsAppointmentNotes
        ? (response.data as unknown as SupabaseAppointmentRow)
        : ({ ...(response.data as object), notes: "" } as SupabaseAppointmentRow);

      const updated = mapAppointmentRow(row);
      setAppointments((current) =>
        current
          .map((appointment) =>
            appointment.id === editingAppointmentId ? updated : appointment
          )
          .sort((a, b) => {
            if (a.date === b.date) {
              return a.start.localeCompare(b.start);
            }
            return a.date.localeCompare(b.date);
          })
      );
      setToast({ text: "Programarea a fost actualizata.", type: "success" });
    } else {
      const response = await supabase
        .from("appointments")
        .insert(
          supportsAppointmentNotes
            ? { ...payloadBase, notes: appointmentNotes.trim() }
            : payloadBase
        )
        .select(
          supportsAppointmentNotes
            ? APPOINTMENT_SELECT_WITH_NOTES
            : APPOINTMENT_SELECT_WITHOUT_NOTES
        )
        .single();

      if (response.error) {
        setToast({ text: "Nu am putut salva programarea in Supabase.", type: "error" });
        setIsSavingAppointment(false);
        return;
      }

      const row = supportsAppointmentNotes
        ? (response.data as unknown as SupabaseAppointmentRow)
        : ({ ...(response.data as object), notes: "" } as SupabaseAppointmentRow);

      const newAppointment = mapAppointmentRow(row);
      setAppointments((current) =>
        [...current, newAppointment].sort((a, b) => {
          if (a.date === b.date) {
            return a.start.localeCompare(b.start);
          }
          return a.date.localeCompare(b.date);
        })
      );
      setToast({ text: "Programarea a fost salvata in Supabase.", type: "success" });
    }

    resetAppointmentForm(service);
    setIsSavingAppointment(false);
    setActiveTab("home");
  };

  const startEditAppointment = (appointment: Appointment) => {
    setActiveTab("appointments");
    setActivePanel("appointment");
    setEditingAppointmentId(appointment.id);
    setSelectedClientId(appointment.clientId);
    const service = services.find((item) => item.name === appointment.service);
    setSelectedServiceId(service?.id ?? services[0]?.id ?? 0);
    setAppointmentDate(appointment.date);
    setAppointmentTime(appointment.start);
    setAppointmentDuration(appointment.duration);
    setAppointmentPrice(appointment.price);
    setAppointmentStatus(appointment.status);
    setAppointmentNotes(appointment.notes);
    setAppointmentClientFilter("");
    setScrollToEditorTick((value) => value + 1);
  };

  const handleDeleteAppointment = async (id: number) => {
    if (!confirm("Sigur vrei sa stergi programarea?")) {
      return;
    }

    if (!isSupabaseConfigured || !supabase || !session || !isOnline || id < 0) {
      const next = appointments.filter((appointment) => appointment.id !== id);
      setAppointments(next);
      persistLocalState({ appointments: next });
      if (isSupabaseConfigured) {
        enqueueOfflineOp({ type: "delete_appointment", id });
      }
      setToast({
        text:
          !isOnline && isSupabaseConfigured
            ? "Programare stearsa offline. Se sincronizeaza la reconectare."
            : "Programarea a fost stearsa local.",
        type: "success",
      });
      return;
    }

    const { error } = await supabase.from("appointments").delete().eq("id", id);
    if (error) {
      setToast({ text: "Nu am putut sterge programarea.", type: "error" });
      return;
    }
    setAppointments((current) => current.filter((appointment) => appointment.id !== id));
    setToast({ text: "Programarea a fost stearsa.", type: "success" });
  };

  const handleUpdateStatus = async (id: number, status: string) => {
    if (!isSupabaseConfigured || !supabase || !session || !isOnline || id < 0) {
      const next = appointments.map((appointment) =>
        appointment.id === id ? { ...appointment, status } : appointment
      );
      setAppointments(next);
      persistLocalState({ appointments: next });
      if (isSupabaseConfigured) {
        const changed = next.find((appointment) => appointment.id === id);
        if (changed) {
          enqueueOfflineOp({ type: "upsert_appointment", record: changed });
        }
      }
      setToast({
        text:
          !isOnline && isSupabaseConfigured
            ? `Status schimbat offline (${status}). Se sincronizeaza la reconectare.`
            : `Status schimbat in ${status}.`,
        type: "success",
      });
      return;
    }

    const { error } = await supabase
      .from("appointments")
      .update({ status })
      .eq("id", id);
    if (error) {
      setToast({ text: "Nu am putut actualiza statusul.", type: "error" });
      return;
    }

    setAppointments((current) =>
      current.map((appointment) =>
        appointment.id === id ? { ...appointment, status } : appointment
      )
    );
    setToast({ text: `Status schimbat in ${status}.`, type: "success" });
  };

  const handleSaveService = async () => {
    if (!serviceName.trim() || !serviceDuration.trim() || servicePrice <= 0) {
      setToast({ text: "Completeaza numele, durata si pretul serviciului.", type: "error" });
      return;
    }

    setIsSavingService(true);
    const payload = {
      name: serviceName.trim(),
      duration: serviceDuration.trim(),
      price: servicePrice,
      active: serviceActive,
    };

    if (!isSupabaseConfigured || !supabase || !supportsServicesTable || !session || !isOnline) {
      const newService: Service = editingServiceId
        ? {
            id: editingServiceId,
            name: payload.name,
            duration: payload.duration,
            price: payload.price,
            active: payload.active,
          }
        : {
            id: isSupabaseConfigured ? nextTempId() : Date.now(),
            name: payload.name,
            duration: payload.duration,
            price: payload.price,
            active: payload.active,
          };
      const nextServices = editingServiceId
        ? services.map((service) =>
            service.id === editingServiceId ? { ...service, ...payload } : service
          )
        : [...services, newService];

      setServices(nextServices);
      persistLocalState({ services: nextServices });
      if (isSupabaseConfigured && supportsServicesTable) {
        enqueueOfflineOp({
          type: "upsert_service",
          record: newService,
        });
      }
      setToast({
        text:
          !isOnline && isSupabaseConfigured
            ? "Serviciu salvat offline. Se sincronizeaza cand revine internetul."
            : editingServiceId
              ? "Serviciul a fost actualizat."
              : "Serviciul a fost salvat.",
        type: "success",
      });
      resetServiceForm();
      setIsSavingService(false);
      return;
    }

    if (editingServiceId) {
      const response = await supabase
        .from("services")
        .update(payload)
        .eq("id", editingServiceId)
        .select("*")
        .single();

      if (response.error) {
        setToast({ text: "Nu am putut actualiza serviciul.", type: "error" });
        setIsSavingService(false);
        return;
      }

      const updated = mapServiceRow(response.data as SupabaseServiceRow);
      setServices((current) =>
        current.map((service) => (service.id === editingServiceId ? updated : service))
      );
      setToast({ text: "Serviciul a fost actualizat.", type: "success" });
    } else {
      const response = await supabase
        .from("services")
        .insert(payload)
        .select("*")
        .single();

      if (response.error) {
        setToast({ text: "Nu am putut salva serviciul.", type: "error" });
        setIsSavingService(false);
        return;
      }

      const created = mapServiceRow(response.data as SupabaseServiceRow);
      setServices((current) => [...current, created]);
      setToast({ text: "Serviciul a fost salvat.", type: "success" });
    }

    resetServiceForm();
    setIsSavingService(false);
  };

  const startEditService = (service: Service) => {
    setActiveTab("settings");
    setEditingServiceId(service.id);
    setServiceName(service.name);
    setServiceDuration(service.duration);
    setServicePrice(service.price);
    setServiceActive(service.active);
  };

  const handleDeleteService = async (serviceId: number) => {
    if (!confirm("Sigur vrei sa stergi serviciul?")) {
      return;
    }

    if (!isSupabaseConfigured || !supabase || !supportsServicesTable || !session || !isOnline) {
      const next = services.filter((service) => service.id !== serviceId);
      setServices(next);
      persistLocalState({ services: next });
      if (isSupabaseConfigured && supportsServicesTable) {
        enqueueOfflineOp({ type: "delete_service", id: serviceId });
      }
      setToast({
        text:
          !isOnline && isSupabaseConfigured
            ? "Serviciu sters offline. Se sincronizeaza la reconectare."
            : "Serviciul a fost sters local.",
        type: "success",
      });
      return;
    }

    const response = await supabase
      .from("services")
      .delete()
      .eq("id", serviceId)
      .select("id");
    if (response.error) {
      setToast({ text: "Nu am putut sterge serviciul.", type: "error" });
      return;
    }
    if (!response.data || response.data.length === 0) {
      setToast({
        text: "Serviciul nu a fost sters in Supabase (verifica drepturile RLS).",
        type: "error",
      });
      return;
    }

    setServices((current) => current.filter((service) => service.id !== serviceId));
    setToast({ text: "Serviciul a fost sters.", type: "success" });
  };

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="gold-ring w-full max-w-sm rounded-[8px] border border-line bg-panel px-5 py-6">
          <p className="text-sm text-muted">SoLash</p>
          <h1 className="mt-2 text-2xl font-semibold">Se pregateste aplicatia</h1>
        </div>
      </main>
    );
  }

  if (isSupabaseConfigured && !session && !offlineBypass) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="gold-ring w-full max-w-sm rounded-[8px] border border-line bg-panel px-5 py-6">
          <div className="mx-auto w-fit rounded-[8px] p-1">
            <Image
              alt="SoLash logo"
              className="mx-auto h-auto w-full max-w-[230px] rounded-[6px]"
              height={210}
              priority
              src="/solash-logo-v3.png"
              width={230}
            />
          </div>
          <p className="mt-4 text-center text-sm text-muted">Autentificare SoLash</p>
          <h1 className="mt-2 text-center text-2xl font-semibold">
            Intra in aplicatie
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#ddd4c5]">
            Protejam datele clientelor si programarile inainte sa mergem mai departe.
          </p>

          <div className="mt-5 grid gap-3">
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Email</span>
              <input
                className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                onChange={(event) => setAuthEmail(event.target.value)}
                type="email"
                value={authEmail}
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="text-muted">Parola</span>
              <input
                className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                onChange={(event) => setAuthPassword(event.target.value)}
                type="password"
                value={authPassword}
              />
            </label>

            <button
              className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
              disabled={authBusy}
              onClick={() => void handleAuth()}
              type="button"
            >
              {authBusy ? "Se proceseaza..." : "Autentificare"}
            </button>
          </div>

          {toast ? (
            <p
              className={`mt-4 rounded-[8px] px-4 py-3 text-sm ${
                toast.type === "error"
                  ? "bg-red-500 text-white"
                  : "bg-green-500 text-black"
              }`}
            >
              {toast.text}
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-28 pt-6">
        {activeTab === "home" ? (
          <section className="panel-glow gold-ring rounded-[8px] border border-line px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 w-fit rounded-[8px] p-0.5">
                  <Image
                    alt="SoLash logo"
                    className="h-auto w-full max-w-[186px] rounded-[6px]"
                    height={98}
                    priority
                    src="/solash-logo-v3.png"
                    width={186}
                  />
                </div>
                <p className="text-sm capitalize text-muted">{humanDate(appointmentDate)}</p>
                <p className="mt-2 max-w-[18rem] text-sm leading-6 text-[#ddd4c5]">
                  Programari premium pentru extensii de gene, gandite clar pentru mobil.
                </p>
              </div>
              <div className="gold-ring rounded-[8px] border border-line bg-panel px-3 py-2 text-right">
                <p className="text-xs text-muted">Pe data aleasa</p>
                <p className="mt-1 text-2xl font-semibold text-gold-strong">
                  {appointmentsForSelectedDate.length}
                </p>
                <p className="text-xs text-muted">programari</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black"
                onClick={() => {
                  setActiveTab("appointments");
                  setActivePanel("appointment");
                  resetAppointmentForm();
                }}
                type="button"
              >
                Programare noua
              </button>
              <button
                className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-semibold text-foreground"
                onClick={() => {
                  setActiveTab("appointments");
                  setActivePanel("client");
                  resetClientForm();
                }}
                type="button"
              >
                Adauga clienta
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-3">
                <p className="text-xs text-muted">Incasari pe zi</p>
                <p className="mt-2 text-xl font-semibold text-gold">{formatPrice(dailyRevenue)}</p>
              </div>
              <div className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-3">
                <p className="text-xs text-muted">Reminder maine</p>
                <p className="mt-2 text-xl font-semibold">{reminderCount}</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-3">
                <p className="text-xs text-muted">Saptamana</p>
                <p className="mt-2 text-lg font-semibold">{formatPrice(weeklyRevenue)}</p>
              </div>
              <div className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-3">
                <p className="text-xs text-muted">Luna</p>
                <p className="mt-2 text-lg font-semibold">{formatPrice(monthlyRevenue)}</p>
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-sm text-muted">Ziua selectata</p>
              <button
                className="w-full rounded-[8px] border border-line bg-black px-3 py-3 text-left"
                onClick={() => setShowCalendar(true)}
                type="button"
              >
                {humanDate(appointmentDate)}
              </button>
            </div>

            {!isOnline ? (
              <div className="mt-4 rounded-[8px] border border-line bg-black px-4 py-3 text-sm text-[#ddd4c5]">
                Offline mode activ
                {pendingOpsCount > 0 ? ` (${pendingOpsCount} schimbari in asteptare)` : "."}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="gold-ring rounded-[8px] border border-line bg-panel px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="w-fit rounded-[8px] p-0.5">
                <Image
                  alt="SoLash logo"
                  className="h-auto w-full max-w-[186px] rounded-[6px]"
                  height={98}
                  priority
                  src="/solash-logo-v3.png"
                  width={186}
                />
              </div>
              <div className="text-right">
                <p className="text-base font-semibold text-muted">{selectedDateBadge.day}</p>
                <p className="text-2xl font-semibold leading-none text-gold-strong capitalize">
                  {selectedDateBadge.month}
                </p>
              </div>
            </div>
          </section>
        )}

        {showCalendar ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="gold-ring w-full max-w-sm rounded-[8px] border border-line bg-panel p-4">
              <DayPicker
                mode="single"
                selected={calendarSelected}
                onSelect={(date) => {
                  if (!date) {
                    return;
                  }
                  const year = date.getFullYear();
                  const month = `${date.getMonth() + 1}`.padStart(2, "0");
                  const day = `${date.getDate()}`.padStart(2, "0");
                  setAppointmentDate(`${year}-${month}-${day}`);
                  setShowCalendar(false);
                }}
              />
              <button
                className="mt-3 w-full rounded-[8px] bg-gold px-3 py-3 text-sm font-semibold text-black"
                onClick={() => setShowCalendar(false)}
                type="button"
              >
                Inchide calendarul
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "home" ? (
          <>
            <section className="mt-6" ref={appointmentEditorRef}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Urmatoarea programare</h2>
                <span className="text-sm text-muted">{todaysWindow}</span>
              </div>
              {nextUpcomingAppointment ? (
                <article className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-semibold">
                        {nextUpcomingAppointment.clientName}
                      </p>
                      <p className="mt-1 text-sm text-[#ddd4c5]">
                        {nextUpcomingAppointment.service}
                      </p>
                    </div>
                    <span className={`rounded-[8px] px-2 py-1 text-xs ${statusBadgeClass(nextUpcomingAppointment.status)}`}>
                      {nextUpcomingAppointment.status}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-sm text-muted">
                    <div>
                      <p>Data</p>
                      <p className="mt-1 text-foreground">{nextUpcomingAppointment.date}</p>
                    </div>
                    <div>
                      <p>Ora</p>
                      <p className="mt-1 text-foreground">{nextUpcomingAppointment.start}</p>
                    </div>
                    <div>
                      <p>Pret</p>
                      <p className="mt-1 text-foreground">
                        {formatPrice(nextUpcomingAppointment.price)}
                      </p>
                    </div>
                  </div>
                </article>
              ) : (
                <div className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-6 text-sm text-muted">
                  Nu exista programari viitoare inca.
                </div>
              )}
            </section>

            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Reminder rapid</h2>
                <span className="text-sm text-muted">
                  Azi {upcomingSummary.todayList.length} • Maine {upcomingSummary.tomorrowList.length}
                </span>
              </div>
              <div className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                <p className="text-sm font-semibold text-gold">Azi</p>
                {upcomingSummary.todayList.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {upcomingSummary.todayList.map((appointment) => (
                      <div
                        key={`today-${appointment.id}`}
                        className="rounded-[8px] border border-[#d4b578] bg-[#fffaf0] px-3 py-2"
                      >
                        <p className="text-sm font-semibold text-[#1f1a12]">
                          {appointment.start} • {appointment.clientName}
                        </p>
                        <p className="mt-1 text-xs text-[#5f5648]">{appointment.service}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">Nu ai programari ramase azi.</p>
                )}

                <p className="mt-4 text-sm font-semibold text-gold">Maine</p>
                {upcomingSummary.tomorrowList.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {upcomingSummary.tomorrowList.map((appointment) => (
                      <div
                        key={`tomorrow-${appointment.id}`}
                        className="rounded-[8px] border border-[#d4b578] bg-[#fffaf0] px-3 py-2"
                      >
                        <p className="text-sm font-semibold text-[#1f1a12]">
                          {appointment.start} • {appointment.clientName}
                        </p>
                        <p className="mt-1 text-xs text-[#5f5648]">{appointment.service}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">Nu ai programari pentru maine.</p>
                )}
              </div>
            </section>

            <section className="mt-7">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Calendarul zilei</h2>
                <span className="text-sm text-muted">
                  Liber {Math.floor(dayTimeline.totalFreeMinutes / 60)}h{" "}
                  {dayTimeline.totalFreeMinutes % 60}m
                </span>
              </div>
              <div className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                <div className="space-y-2">
                  {dayTimeline.segments.map((segment) =>
                    segment.kind === "free" ? (
                      <div
                        key={`home-free-${segment.start}-${segment.end}`}
                        className="rounded-[8px] border border-[#2a7a58] bg-[#0f2b20] px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-[#96f2c6]">Liber</p>
                          <p className="text-xs text-[#96f2c6]">
                            {minutesToTime(segment.start)} - {minutesToTime(segment.end)}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-[#96f2c6]">
                          {Math.floor(segment.minutes / 60)}h {segment.minutes % 60}m disponibil
                        </p>
                      </div>
                    ) : (
                      <div
                        key={`home-busy-${segment.appointment.id}-${segment.start}`}
                        className="rounded-[8px] border border-[#d4b578] bg-[#fffaf0] px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-[#1f1a12]">
                            {segment.appointment.clientName}
                          </p>
                          <p className="text-xs text-[#7c5d1f]">
                            {minutesToTime(segment.start)} - {minutesToTime(segment.end)}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-[#5f5648]">
                          {segment.appointment.service} • {segment.appointment.status}
                        </p>
                      </div>
                    )
                  )}
                </div>
              </div>
            </section>
          </>
        ) : null}

        {activeTab === "month" ? (
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold capitalize">{monthLabel}</h2>
              <span className="text-sm text-muted">
                max {calendarCapacity.maxAppointments} programari/zi
              </span>
            </div>

            <div className="mb-3 grid grid-cols-3 gap-3">
              <button
                className="rounded-[8px] border border-line bg-panel px-3 py-2 text-sm"
                onClick={() => {
                  setSelectedMonth(monthShift(selectedMonth, -1));
                  setShowMonthDayView(false);
                }}
                type="button"
              >
                Luna trecuta
              </button>
              <button
                className="rounded-[8px] border border-line bg-panel px-3 py-2 text-sm"
                onClick={() => {
                  setSelectedMonth(toMonthKey(todayIso()));
                  setShowMonthDayView(false);
                }}
                type="button"
              >
                Luna curenta
              </button>
              <button
                className="rounded-[8px] border border-line bg-panel px-3 py-2 text-sm"
                onClick={() => {
                  setSelectedMonth(monthShift(selectedMonth, 1));
                  setShowMonthDayView(false);
                }}
                type="button"
              >
                Luna viitoare
              </button>
            </div>

            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {monthQuickPicks.map((month) => (
                <button
                  key={month}
                  className={`rounded-[8px] border px-3 py-2 text-sm whitespace-nowrap ${
                    month === selectedMonth
                      ? "border-gold bg-gold text-black"
                      : "border-line bg-panel text-muted"
                  }`}
                  onClick={() => {
                    setSelectedMonth(month);
                    setShowMonthDayView(false);
                  }}
                  type="button"
                >
                  {new Intl.DateTimeFormat("ro-RO", {
                    month: "short",
                    year: "2-digit",
                  }).format(new Date(`${month}-01T12:00:00`))}
                </button>
              ))}
            </div>

            {showMonthDayView ? (
              <div className="gold-ring rounded-[8px] border border-line bg-panel-soft p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <button
                    className="rounded-[8px] border border-line bg-panel px-3 py-2 text-sm"
                    onClick={() => setShowMonthDayView(false)}
                    type="button"
                  >
                    Inapoi la luna
                  </button>
                  <p className="text-sm capitalize text-muted">{humanDate(appointmentDate)}</p>
                </div>

                <div className="space-y-2">
                  {dayTimeline.segments.map((segment) =>
                    segment.kind === "free" ? (
                      <div
                        key={`month-free-${segment.start}-${segment.end}`}
                        className="rounded-[8px] border border-[#2a7a58] bg-[#0f2b20] px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-[#96f2c6]">Liber</p>
                          <p className="text-xs text-[#96f2c6]">
                            {minutesToTime(segment.start)} - {minutesToTime(segment.end)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <button
                        key={`month-busy-${segment.appointment.id}-${segment.start}`}
                        className="w-full rounded-[8px] border border-[#d4b578] bg-[#fffaf0] px-3 py-2 text-left"
                        onClick={() => {
                          setActiveTab("appointments");
                          startEditAppointment(segment.appointment);
                        }}
                        type="button"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-[#1f1a12]">
                            {segment.appointment.clientName}
                          </p>
                          <p className="text-xs text-[#7c5d1f]">
                            {minutesToTime(segment.start)} - {minutesToTime(segment.end)}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-[#5f5648]">
                          {segment.appointment.service} • {segment.appointment.status}
                        </p>
                      </button>
                    )
                  )}
                </div>

                <div className="mt-4 grid gap-2">
                  {appointmentsForDayAll.length === 0 ? (
                    <div className="rounded-[8px] border border-line bg-panel px-3 py-3 text-sm text-muted">
                      Nu exista programari in ziua asta.
                    </div>
                  ) : (
                    appointmentsForDayAll.map((appointment) => (
                      <button
                        key={`month-list-${appointment.id}`}
                        className="rounded-[8px] border border-line bg-panel px-3 py-3 text-left"
                        onClick={() => {
                          setActiveTab("appointments");
                          startEditAppointment(appointment);
                        }}
                        type="button"
                      >
                        <p className="text-sm font-semibold">{appointment.clientName}</p>
                        <p className="mt-1 text-xs text-muted">
                          {appointment.start} • {appointment.service} • {appointment.duration}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="gold-ring rounded-[8px] border border-line bg-panel-soft p-3">
                <div className="mb-2 grid grid-cols-7 gap-2">
                  {["L", "M", "M", "J", "V", "S", "D"].map((label, idx) => (
                    <p key={`${label}-${idx}`} className="text-center text-sm text-muted">
                      {label}
                    </p>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {monthGridDays.map((day) => (
                    <button
                      key={day.iso}
                      className={`rounded-[8px] border px-1.5 py-2 text-left transition ${
                        day.inCurrentMonth
                          ? "border-line bg-panel"
                          : "border-[#2a2a2a] bg-black/40"
                      } ${day.isSelected ? "border-gold" : ""}`}
                      onClick={() => {
                        setAppointmentDate(day.iso);
                        setSelectedMonth(toMonthKey(day.iso));
                        setShowMonthDayView(true);
                      }}
                      type="button"
                    >
                      <p
                        className={`text-sm font-semibold ${
                          day.inCurrentMonth ? "text-foreground" : "text-muted"
                        }`}
                      >
                        {day.day}
                      </p>
                      {day.inCurrentMonth ? (
                        <>
                          <p className="mt-1 text-xs text-gold">{day.count} ocupate</p>
                          <p className="text-xs text-[#96f2c6]">{day.slotsLeft} libere</p>
                        </>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "appointments" ? (
          <>
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {activePanel === "appointment"
                    ? editingAppointmentId
                      ? "Editeaza programarea"
                      : "Programare noua"
                    : editingClientId
                      ? "Editeaza clienta"
                      : "Clienta noua"}
                </h2>
                <span className="text-sm text-muted">
                  {isSupabaseConfigured ? "Supabase" : "demo local"}
                </span>
              </div>

              <div className="mb-3 flex gap-3">
                <button
                  className={`flex-1 rounded-[8px] px-4 py-3 text-sm font-semibold ${
                    activePanel === "appointment"
                      ? "bg-gold text-black"
                      : "gold-ring border border-line bg-panel text-foreground"
                  }`}
                  onClick={() => setActivePanel("appointment")}
                  type="button"
                >
                  Programare
                </button>
                <button
                  className={`flex-1 rounded-[8px] px-4 py-3 text-sm font-semibold ${
                    activePanel === "client"
                      ? "bg-gold text-black"
                      : "gold-ring border border-line bg-panel text-foreground"
                  }`}
                  onClick={() => setActivePanel("client")}
                  type="button"
                >
                  Clienta
                </button>
              </div>

              {activePanel === "appointment" ? (
                <div
                  className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4"
                  ref={appointmentFormCardRef}
                >
                  <div className="grid gap-3">
                    <label className="grid min-w-0 gap-2 text-sm">
                      <span className="text-muted">Clienta</span>
                      <input
                        className="w-full max-w-full rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                        onChange={(event) => setAppointmentClientFilter(event.target.value)}
                        placeholder="Cauta dupa nume sau telefon"
                        value={appointmentClientFilter}
                      />
                      <select
                        className="w-full max-w-full rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                        onChange={(event) => setSelectedClientId(Number(event.target.value))}
                        value={selectedClientId}
                      >
                        {filteredClientsForAppointment.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name} • {client.phone}
                          </option>
                        ))}
                      </select>
                      {filteredClientsForAppointment.length === 0 ? (
                        <p className="text-xs text-muted">
                          Nu exista cliente pentru filtrul introdus.
                        </p>
                      ) : null}
                    </label>

                    <label className="grid min-w-0 gap-2 text-sm">
                      <span className="text-muted">Serviciu</span>
                      <select
                        className="w-full max-w-full rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                        onChange={(event) => handleServiceSelection(Number(event.target.value))}
                        value={selectedServiceId}
                      >
                        {activeServices.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-1 gap-3">
                      <label className="grid min-w-0 gap-2 text-sm">
                        <span className="text-muted">Data</span>
                        <input
                          className="w-full max-w-full rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                          onChange={(event) => setAppointmentDate(event.target.value)}
                          type="date"
                          value={appointmentDate}
                        />
                      </label>
                      <label className="grid min-w-0 gap-2 text-sm">
                        <span className="text-muted">Ora</span>
                        <input
                          className="w-full max-w-full rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                          onChange={(event) => setAppointmentTime(event.target.value)}
                          type="time"
                          value={appointmentTime}
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <label className="grid min-w-0 gap-2 text-sm">
                        <span className="text-muted">Durata</span>
                        <input
                          className="w-full max-w-full rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                          onChange={(event) => setAppointmentDuration(event.target.value)}
                          value={appointmentDuration}
                        />
                      </label>
                      <label className="grid min-w-0 gap-2 text-sm">
                        <span className="text-muted">Pret</span>
                        <input
                          className="w-full max-w-full rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                          min="0"
                          onChange={(event) =>
                            setAppointmentPrice(Number(event.target.value) || 0)
                          }
                          type="number"
                          value={appointmentPrice}
                        />
                      </label>
                    </div>

                    <label className="grid min-w-0 gap-2 text-sm">
                      <span className="text-muted">Status</span>
                      <select
                        className="w-full max-w-full rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                        onChange={(event) => setAppointmentStatus(event.target.value)}
                        value={appointmentStatus}
                      >
                        <option>Noua</option>
                        <option>Confirmata</option>
                        <option>Reminder maine</option>
                        <option>Finalizata</option>
                        <option>Anulata</option>
                      </select>
                    </label>

                    <label className="grid min-w-0 gap-2 text-sm">
                      <span className="text-muted">Observatii programare</span>
                      <textarea
                        className="min-h-[88px] w-full max-w-full rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                        onChange={(event) => setAppointmentNotes(event.target.value)}
                        placeholder="Detalii, preferinte, reminder..."
                        value={appointmentNotes}
                      />
                    </label>

                    <div className="rounded-[8px] border border-line bg-black px-4 py-3 text-sm">
                      <p className="text-muted">Clienta selectata</p>
                      <p className="mt-2 font-medium">{selectedClient?.name ?? "-"}</p>
                      <p className="mt-1 text-[#ddd4c5]">{selectedClient?.phone ?? "-"}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                        disabled={isSavingAppointment || isLoading || clients.length === 0}
                        onClick={() => void handleSaveAppointment()}
                        type="button"
                      >
                        {isSavingAppointment
                          ? "Se salveaza..."
                          : editingAppointmentId
                            ? "Actualizeaza"
                            : "Salveaza programarea"}
                      </button>
                      <button
                        className="rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-medium"
                        onClick={() => resetAppointmentForm()}
                        type="button"
                      >
                        Reseteaza
                      </button>
                    </div>
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

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                        disabled={isSavingClient || isLoading}
                        onClick={() => void handleSaveClient()}
                        type="button"
                      >
                        {isSavingClient
                          ? "Se salveaza..."
                          : editingClientId
                            ? "Actualizeaza"
                            : "Salveaza clienta"}
                      </button>
                      <button
                        className="rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-medium"
                        onClick={() => resetClientForm()}
                        type="button"
                      >
                        Reseteaza
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Programari</h2>
                <span className="text-sm text-muted">{humanDate(appointmentDate)}</span>
              </div>

              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {["toate", "Noua", "Confirmata", "Reminder maine", "Finalizata", "Anulata"].map(
                  (status) => (
                    <button
                      key={status}
                      className={`rounded-[8px] border px-3 py-2 text-sm whitespace-nowrap ${
                        statusFilter === status
                          ? "border-gold bg-gold text-black"
                          : "border-line bg-panel text-muted"
                      }`}
                      onClick={() => setStatusFilter(status)}
                      type="button"
                    >
                      {status === "toate" ? "Toate" : status}
                    </button>
                  )
                )}
              </div>

              <div className="gold-ring mb-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Calendarul zilei</h3>
                  <span className="text-xs text-muted">
                    Liber {Math.floor(dayTimeline.totalFreeMinutes / 60)}h{" "}
                    {dayTimeline.totalFreeMinutes % 60}m
                  </span>
                </div>
                <div className="space-y-2">
                  {dayTimeline.segments.map((segment) =>
                    segment.kind === "free" ? (
                      <div
                        key={`free-${segment.start}-${segment.end}`}
                        className="rounded-[8px] border border-[#2a7a58] bg-[#0f2b20] px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-[#96f2c6]">Liber</p>
                          <p className="text-xs text-[#96f2c6]">
                            {minutesToTime(segment.start)} - {minutesToTime(segment.end)}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-[#96f2c6]">
                          {Math.floor(segment.minutes / 60)}h {segment.minutes % 60}m disponibil
                        </p>
                      </div>
                    ) : (
                      <div
                        key={`busy-${segment.appointment.id}-${segment.start}`}
                        className="rounded-[8px] border border-[#d4b578] bg-[#fffaf0] px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-[#1f1a12]">
                            {segment.appointment.clientName}
                          </p>
                          <p className="text-xs text-[#7c5d1f]">
                            {minutesToTime(segment.start)} - {minutesToTime(segment.end)}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-[#5f5648]">
                          {segment.appointment.service} • {segment.appointment.status}
                        </p>
                      </div>
                    )
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {appointmentsForSelectedDate.map((appointment) => (
                  <article
                    key={appointment.id}
                    className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold">{appointment.clientName}</p>
                        <p className="mt-1 text-sm text-[#ddd4c5]">{appointment.service}</p>
                      </div>
                      <span className={`rounded-[8px] px-2 py-1 text-xs ${statusBadgeClass(appointment.status)}`}>
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

                    {appointment.notes ? (
                      <p className="mt-3 text-sm leading-6 text-[#ddd4c5]">
                        {appointment.notes}
                      </p>
                    ) : null}

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        className="rounded-[8px] bg-[#1f1f1f] px-3 py-3 text-sm font-medium text-foreground"
                        onClick={() => startEditAppointment(appointment)}
                        type="button"
                      >
                        Editeaza
                      </button>
                      <button
                        className="rounded-[8px] bg-[#1f1f1f] px-3 py-3 text-sm font-medium text-foreground"
                        onClick={() =>
                          void handleUpdateStatus(
                            appointment.id,
                            appointment.status === "Confirmata" ? "Noua" : "Confirmata"
                          )
                        }
                        type="button"
                      >
                        {appointment.status === "Confirmata"
                          ? "Reseteaza status"
                          : "Marcheaza confirmata"}
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <button
                        className="w-full rounded-[8px] bg-gold px-3 py-3 text-center text-sm font-semibold text-black"
                        onClick={() => void handleWhatsAppConfirm(appointment)}
                        type="button"
                      >
                        Confirma pe WhatsApp
                      </button>
                      <a
                        className="rounded-[8px] bg-[#1f1f1f] px-3 py-3 text-center text-sm font-medium text-foreground"
                        href={`tel:${appointment.phone}`}
                      >
                        Suna
                      </a>
                      <button
                        className="rounded-[8px] bg-[#7b2020] px-3 py-3 text-sm font-medium text-white"
                        onClick={() => void handleDeleteAppointment(appointment.id)}
                        type="button"
                      >
                        Sterge
                      </button>
                    </div>
                  </article>
                ))}

                {!isLoading && appointmentsForSelectedDate.length === 0 ? (
                  <div className="gold-ring rounded-[8px] border border-line bg-panel px-4 py-6 text-sm text-muted">
                    Nu exista programari pentru filtrul selectat.
                  </div>
                ) : null}
              </div>
            </section>
          </>
        ) : null}

        {activeTab === "clients" ? (
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Cliente</h2>
              <span className="text-sm text-muted">{filteredClients.length} afisate</span>
            </div>

            <label className="mb-3 grid gap-2 text-sm">
              <span className="text-muted">Cauta clienta</span>
              <input
                className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                onChange={(event) => setClientSearch(event.target.value)}
                placeholder="Nume, telefon sau observatii"
                value={clientSearch}
              />
            </label>

            <div className="grid gap-3">
              {filteredClients.map((client) => {
                const activity = clientActivityById.get(client.id);
                const visits = activity?.visits ?? client.visits;
                const lastVisit = activity?.lastVisit ?? client.lastVisit;
                return (
                  <article
                    key={client.id}
                    className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold">{client.name}</p>
                        <p className="mt-1 text-sm text-muted">
                          {visits === 0 ? "fara vizite" : `${visits} vizite`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-[#ddd4c5]">{lastVisit}</p>
                        <p className="mt-1 text-sm text-gold">{client.phone}</p>
                      </div>
                    </div>
                    {client.notes ? (
                      <p className="mt-3 text-sm leading-6 text-[#ddd4c5]">{client.notes}</p>
                    ) : null}
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <button
                        className="rounded-[8px] bg-[#1f1f1f] px-3 py-3 text-sm font-medium"
                        onClick={() => startEditClient(client)}
                        type="button"
                      >
                        Editeaza
                      </button>
                      <button
                        className="rounded-[8px] bg-[#7b2020] px-3 py-3 text-sm font-medium text-white"
                        onClick={() => void handleDeleteClient(client.id)}
                        type="button"
                      >
                        Sterge
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {activeTab === "settings" ? (
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Setari</h2>
              <span className="text-sm text-muted">
                {supportsServicesTable ? "servicii in Supabase" : "servicii locale"}
              </span>
            </div>

            <div className="gold-ring mb-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <p className="text-sm font-semibold">Notificari push</p>
              <p className="mt-2 text-sm text-[#ddd4c5]">
                Reminder zilnic la 20:30 (ora Romaniei) pentru confirmarile de a doua zi.
              </p>
              <div className="mt-3 rounded-[8px] border border-line bg-black px-3 py-2 text-sm text-muted">
                Status:{" "}
                {pushPermission === "unsupported"
                  ? "nesuportat"
                  : pushEnabled
                    ? "activ"
                    : pushPermission === "denied"
                      ? "blocat in browser"
                      : "inactiv"}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                  disabled={pushBusy || !pushSupported || pushEnabled}
                  onClick={() => void handleEnablePush()}
                  type="button"
                >
                  {pushBusy ? "Se proceseaza..." : "Activeaza"}
                </button>
                <button
                  className="rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-medium disabled:opacity-60"
                  disabled={pushBusy || !pushSupported || !pushEnabled}
                  onClick={() => void handleDisablePush()}
                  type="button"
                >
                  Dezactiveaza
                </button>
              </div>
              <button
                className="mt-3 w-full rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-medium disabled:opacity-60"
                disabled={pushTestBusy || !pushSupported || !pushEnabled}
                onClick={() => void handleTestPush()}
                type="button"
              >
                {pushTestBusy ? "Se trimite..." : "Trimite notificare test acum"}
              </button>
              {!vapidPublicKey ? (
                <p className="mt-3 text-sm text-[#ff9d9d]">
                  Lipseste cheia publica VAPID in variabilele de mediu.
                </p>
              ) : null}
            </div>

            <div className="gold-ring mb-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <p className="text-sm font-semibold">Export date (CSV)</p>
              <p className="mt-2 text-sm text-[#ddd4c5]">
                Descarca rapid clientele si programarile pentru backup.
              </p>
              <button
                className="mt-3 w-full rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                disabled={isExportingCsv}
                onClick={() => void handleExportCsv()}
                type="button"
              >
                {isExportingCsv ? "Se exporta..." : "Exporta CSV (cliente + programari)"}
              </button>
            </div>

            <div className="gold-ring mb-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Jurnal notificari</p>
                <button
                  className="rounded-[8px] border border-line bg-panel px-3 py-2 text-xs font-medium"
                  onClick={() => void loadPushLogs()}
                  type="button"
                >
                  Refresh
                </button>
              </div>
              {isLoadingPushLogs ? (
                <p className="mt-3 text-sm text-muted">Se incarca jurnalul...</p>
              ) : pushLogs.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {pushLogs.slice(0, 10).map((log) => (
                    <div
                      key={log.id}
                      className="rounded-[8px] border border-line bg-black/70 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gold">
                          {log.source === "daily"
                            ? "Reminder zilnic"
                            : log.source === "upcoming"
                              ? "Reminder 15-20 min"
                              : "Test manual"}
                        </p>
                        <p className="text-xs text-muted">{formatLogDateTime(log.created_at)}</p>
                      </div>
                      <p className="mt-1 text-sm text-[#ddd4c5]">{log.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        Trimise: {log.sent_count} • Programari: {log.reminders_count}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">Nu exista notificari trimise in jurnal.</p>
              )}
            </div>

            <div className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <div className="grid gap-3">
                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Nume serviciu</span>
                  <input
                    className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                    onChange={(event) => setServiceName(event.target.value)}
                    value={serviceName}
                  />
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    <span className="text-muted">Durata</span>
                    <input
                      className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                      onChange={(event) => setServiceDuration(event.target.value)}
                      value={serviceDuration}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="text-muted">Pret</span>
                    <input
                      className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                      min="0"
                      onChange={(event) => setServicePrice(Number(event.target.value) || 0)}
                      type="number"
                      value={servicePrice}
                    />
                  </label>
                </div>

                <label className="flex items-center gap-3 text-sm">
                  <input
                    checked={serviceActive}
                    onChange={(event) => setServiceActive(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="text-muted">Serviciu activ</span>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                    disabled={isSavingService}
                    onClick={() => void handleSaveService()}
                    type="button"
                  >
                    {isSavingService
                      ? "Se salveaza..."
                      : editingServiceId
                        ? "Actualizeaza"
                        : "Salveaza serviciul"}
                  </button>
                  <button
                    className="rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-medium"
                    onClick={() => resetServiceForm()}
                    type="button"
                  >
                    Reseteaza
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {services.map((service) => (
                <article
                  key={service.id}
                  className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold">{service.name}</p>
                      <p className="mt-1 text-sm text-muted">
                        {service.duration} • {formatPrice(service.price)}
                      </p>
                    </div>
                    <span
                      className={`rounded-[8px] px-2 py-1 text-xs ${
                        service.active
                          ? "bg-gold text-black"
                          : "bg-black text-muted"
                      }`}
                    >
                      {service.active ? "activ" : "inactiv"}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                      className="rounded-[8px] bg-[#1f1f1f] px-3 py-3 text-sm font-medium"
                      onClick={() => startEditService(service)}
                      type="button"
                    >
                      Editeaza
                    </button>
                    <button
                      className="rounded-[8px] bg-[#7b2020] px-3 py-3 text-sm font-medium text-white"
                      onClick={() => void handleDeleteService(service.id)}
                      type="button"
                    >
                      Sterge
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {isSupabaseConfigured ? (
              <button
                className="mt-6 w-full rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-medium"
                onClick={() => void handleSignOut()}
                type="button"
              >
                Delogare
              </button>
            ) : null}
          </section>
        ) : null}

        {toast ? (
          <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2">
            <div
              className={`rounded-[8px] px-4 py-2 text-sm shadow-lg ${
                toast.type === "error"
                  ? "bg-red-500 text-white"
                  : "bg-green-500 text-black"
              }`}
            >
              {toast.text}
            </div>
          </div>
        ) : null}

        <nav className="gold-ring fixed inset-x-4 bottom-4 mx-auto flex w-auto max-w-md items-center justify-between rounded-[8px] border border-line bg-black/95 px-2 py-3 backdrop-blur">
          {[
            { label: "Acasa", key: "home" as const },
            { label: "Luna", key: "month" as const },
            { label: "Programari", key: "appointments" as const },
            { label: "Cliente", key: "clients" as const },
            { label: "Setari", key: "settings" as const },
          ].map(({ label, key }) => (
            <button
              key={label}
              className={`min-w-[58px] rounded-[8px] px-2 py-2 text-sm font-medium ${
                activeTab === key ? "bg-gold text-black" : "text-muted"
              }`}
              onClick={() => setActiveTab(key)}
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
