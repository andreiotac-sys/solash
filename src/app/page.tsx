"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { DayPicker } from "react-day-picker";
import * as XLSX from "xlsx";
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
const BUSINESS_SETTINGS_KEY = "solash-business-settings";
const BUSINESS_BREAKS_DISABLED_KEY = "solash-business-breaks-disabled-v2";
const WHATSAPP_TEMPLATE_KEY = "solash-whatsapp-template";
const PERSONAL_CLIENT_MARKER = "[solash-personal-client]";
const PERSONAL_BLOCK_MARKER = "[solash-personal-block]";
const PERSONAL_BLOCK_SERVICE = "Blocaj personal";
const PERSONAL_BLOCK_PHONE = "0000000000";
const PERSONAL_BLOCK_PRESETS = ["Eu gene", "Eu par", "Eu unghii"];
const DEFAULT_WHATSAPP_TEMPLATE =
  "Buna, {clienta}! Confirmam programarea ta SoLash pentru {data} la {ora}. Te asteptam cu drag!";
const APPOINTMENT_SELECT_WITH_NOTES =
  "id, client_id, service, appointment_date, start_time, duration, price, status, notes, clients(name, phone)";
const APPOINTMENT_SELECT_WITHOUT_NOTES =
  "id, client_id, service, appointment_date, start_time, duration, price, status, clients(name, phone)";
const SUPABASE_PAGE_SIZE = 1000;
const DEFAULT_DAY_START = "08:00";
const DEFAULT_DAY_END = "21:00";
const DEFAULT_BREAK_START = "13:00";
const DEFAULT_BREAK_END = "14:00";
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

const WEEK_DAYS = [
  { key: 0, label: "Luni" },
  { key: 1, label: "Marti" },
  { key: 2, label: "Miercuri" },
  { key: 3, label: "Joi" },
  { key: 4, label: "Vineri" },
  { key: 5, label: "Sambata" },
  { key: 6, label: "Duminica" },
] as const;

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

type TabKey = "home" | "month" | "appointments" | "clients" | "reports" | "settings";
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
type SupabaseAppointmentRowWithoutNotes = Omit<SupabaseAppointmentRow, "notes">;
type SaveWarning = {
  title: string;
  details: string[];
};
type CalendarPointerDrag = {
  appointmentId: number;
  pointerId: number;
  originY: number;
  currentY: number;
  grabOffsetY: number;
  active: boolean;
};
type CalendarCreateDrag = {
  pointerId: number;
  originY: number;
  currentY: number;
  startMinutes: number;
  startedAt: number;
  active: boolean;
};
type DayBusinessSettings = {
  enabled: boolean;
  hasBreak: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
};

type BusinessSettings = {
  schedule: Record<number, DayBusinessSettings>;
  daysOff: string[];
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
const HIDDEN_RUNNING_TOTAL_START = "2026-05-04";

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

const fullDateLabel = (value: string) =>
  new Intl.DateTimeFormat("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));

const daysBetween = (fromDateIso: string, toDateIso: string) => {
  const from = new Date(`${fromDateIso}T12:00:00`).getTime();
  const to = new Date(`${toDateIso}T12:00:00`).getTime();
  return Math.round((to - from) / 86400000);
};

const daysToHuman = (days: number) => {
  if (days % 7 === 0) {
    const weeks = Math.floor(days / 7);
    if (weeks === 1) {
      return "1 saptamana";
    }
    return `${weeks} saptamani`;
  }
  if (days === 1) {
    return "1 zi";
  }
  return `${days} zile`;
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
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (total: number) => {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${`${hours}`.padStart(2, "0")}:${`${minutes}`.padStart(2, "0")}`;
};

const minutesToDurationInput = (total: number) => {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h${minutes}min`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}min`;
};

const CALENDAR_HOUR_HEIGHT = 72;
const CALENDAR_SNAP_MINUTES = 15;
const CALENDAR_MOVE_HOLD_MS = 900;
const CALENDAR_CREATE_HOLD_MS = 650;
const QUICK_APPOINTMENT_TIMES = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
const QUICK_DURATIONS = ["30min", "1h", "1h30min", "2h", "2h30min"];

const sortAppointmentsByDateTime = (items: Appointment[]) =>
  [...items].sort((a, b) => {
    if (a.date === b.date) {
      return a.start.localeCompare(b.start);
    }
    return a.date.localeCompare(b.date);
  });

const dateToWeekdayKey = (isoDate: string) =>
  (new Date(`${isoDate}T12:00:00`).getDay() + 6) % 7;

const getWorkWindowsForDate = (isoDate: string, settings: BusinessSettings) => {
  if (settings.daysOff.includes(isoDate)) {
    return [];
  }

  const weekdayKey = dateToWeekdayKey(isoDate);
  const day = settings.schedule[weekdayKey];
  if (!day || !day.enabled) {
    return [];
  }

  const start = timeToMinutes(day.start);
  const end = timeToMinutes(day.end);
  if (end <= start) {
    return [];
  }

  const breakStart = timeToMinutes(day.breakStart);
  const breakEnd = timeToMinutes(day.breakEnd);
  const hasValidBreak =
    day.hasBreak &&
    breakEnd > breakStart &&
    breakStart > start &&
    breakEnd < end;

  if (!hasValidBreak) {
    return [{ start, end }];
  }

  const windows: Array<{ start: number; end: number }> = [];
  if (breakStart > start) {
    windows.push({ start, end: breakStart });
  }
  if (end > breakEnd) {
    windows.push({ start: breakEnd, end });
  }
  return windows;
};

const getOverlapMinutesInWindows = (
  intervalStart: number,
  intervalEnd: number,
  windows: Array<{ start: number; end: number }>
) =>
  windows.reduce((sum, windowRange) => {
    const start = Math.max(intervalStart, windowRange.start);
    const end = Math.min(intervalEnd, windowRange.end);
    if (end <= start) {
      return sum;
    }
    return sum + (end - start);
  }, 0);

const SERVICE_COLORS = [
  { border: "border-[#8f6b2f]", bg: "bg-[#fff8e7]", name: "text-[#1f1a12]", meta: "text-[#6b5426]" },
  { border: "border-[#6b4a93]", bg: "bg-[#f5efff]", name: "text-[#221535]", meta: "text-[#5c3c86]" },
  { border: "border-[#2f6f8f]", bg: "bg-[#edf8ff]", name: "text-[#132733]", meta: "text-[#2f6f8f]" },
  { border: "border-[#3d8b65]", bg: "bg-[#ecfff5]", name: "text-[#11281f]", meta: "text-[#2e7253]" },
] as const;

const serviceColorClasses = (serviceName: string) => {
  let hash = 0;
  for (let index = 0; index < serviceName.length; index += 1) {
    hash = (hash * 31 + serviceName.charCodeAt(index)) >>> 0;
  }
  return SERVICE_COLORS[hash % SERVICE_COLORS.length];
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

const isPersonalClient = (client: Client) =>
  client.notes.includes(PERSONAL_CLIENT_MARKER) ||
  (client.phone === PERSONAL_BLOCK_PHONE && PERSONAL_BLOCK_PRESETS.includes(client.name));

const isPersonalBlock = (appointment: Appointment) =>
  appointment.service === PERSONAL_BLOCK_SERVICE ||
  appointment.notes.includes(PERSONAL_BLOCK_MARKER);

const readWhatsAppTemplate = () => {
  if (typeof window === "undefined") {
    return DEFAULT_WHATSAPP_TEMPLATE;
  }
  return window.localStorage.getItem(WHATSAPP_TEMPLATE_KEY) ?? DEFAULT_WHATSAPP_TEMPLATE;
};

const writeWhatsAppTemplate = (template: string) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(WHATSAPP_TEMPLATE_KEY, template);
};

const renderWhatsAppTemplate = (template: string, appointment: Appointment) => {
  const source = template.trim() || DEFAULT_WHATSAPP_TEMPLATE;
  const replacements: Record<string, string> = {
    clienta: appointment.clientName,
    data: humanDate(appointment.date),
    data_scurta: formatShortDate(appointment.date),
    ora: appointment.start,
    serviciu: appointment.service,
    durata: appointment.duration,
    pret: formatPrice(appointment.price),
  };

  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    source
  );
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

const statusShortLabel = (status: string) => {
  if (status === "Confirmata") return "✓ Confirmata";
  if (status === "Noua") return "• Noua";
  if (status === "Reminder maine") return "⏰ Reminder";
  if (status === "Finalizata") return "✔ Finalizata";
  if (status === "Anulata") return "✕ Anulata";
  return status;
};

const defaultSchedule = () =>
  WEEK_DAYS.reduce<Record<number, DayBusinessSettings>>((acc, day) => {
    acc[day.key] = {
      enabled: day.key !== 6,
      hasBreak: false,
      start: DEFAULT_DAY_START,
      end: DEFAULT_DAY_END,
      breakStart: DEFAULT_BREAK_START,
      breakEnd: DEFAULT_BREAK_END,
    };
    return acc;
  }, {});

const defaultBusinessSettings = (): BusinessSettings => ({
  schedule: defaultSchedule(),
  daysOff: [],
});

const normalizeTimeInput = (value: string, fallback: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return fallback;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return fallback;
  }
  return `${`${hours}`.padStart(2, "0")}:${`${minutes}`.padStart(2, "0")}`;
};

const normalizeBusinessSettings = (input?: Partial<BusinessSettings> | null): BusinessSettings => {
  const fallback = defaultBusinessSettings();
  const schedule = defaultSchedule();
  const providedSchedule = input?.schedule ?? {};
  for (const day of WEEK_DAYS) {
    const nextDay = providedSchedule[day.key];
    if (!nextDay) {
      continue;
    }
    schedule[day.key] = {
      enabled: typeof nextDay.enabled === "boolean" ? nextDay.enabled : fallback.schedule[day.key].enabled,
      hasBreak: typeof nextDay.hasBreak === "boolean" ? nextDay.hasBreak : fallback.schedule[day.key].hasBreak,
      start: normalizeTimeInput(nextDay.start, fallback.schedule[day.key].start),
      end: normalizeTimeInput(nextDay.end, fallback.schedule[day.key].end),
      breakStart: normalizeTimeInput(nextDay.breakStart, fallback.schedule[day.key].breakStart),
      breakEnd: normalizeTimeInput(nextDay.breakEnd, fallback.schedule[day.key].breakEnd),
    };
  }
  const rawDaysOff = Array.isArray(input?.daysOff) ? input?.daysOff : [];
  const daysOff = rawDaysOff
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
  return { schedule, daysOff };
};

const disableAllBreaks = (settings: BusinessSettings): BusinessSettings => ({
  ...settings,
  schedule: WEEK_DAYS.reduce<Record<number, DayBusinessSettings>>((acc, day) => {
    acc[day.key] = {
      ...settings.schedule[day.key],
      hasBreak: false,
    };
    return acc;
  }, {}),
});

const applyBusinessSettingsMigrations = (settings: BusinessSettings): BusinessSettings => {
  if (typeof window === "undefined") {
    return settings;
  }

  if (window.localStorage.getItem(BUSINESS_BREAKS_DISABLED_KEY)) {
    return settings;
  }

  const migrated = disableAllBreaks(settings);
  window.localStorage.setItem(BUSINESS_BREAKS_DISABLED_KEY, "true");
  window.localStorage.setItem(BUSINESS_SETTINGS_KEY, JSON.stringify(migrated));
  return migrated;
};

const readBusinessSettings = (): BusinessSettings => {
  if (typeof window === "undefined") {
    return defaultBusinessSettings();
  }

  const raw = window.localStorage.getItem(BUSINESS_SETTINGS_KEY);
  if (!raw) {
    return applyBusinessSettingsMigrations(defaultBusinessSettings());
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BusinessSettings>;
    return applyBusinessSettingsMigrations(normalizeBusinessSettings(parsed));
  } catch {
    return applyBusinessSettingsMigrations(defaultBusinessSettings());
  }
};

const writeBusinessSettings = (settings: BusinessSettings) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(BUSINESS_SETTINGS_KEY, JSON.stringify(settings));
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
  const calendarTimelineRef = useRef<HTMLDivElement | null>(null);
  const calendarMoveHoldTimerRef = useRef<number | null>(null);
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
  const [movingAppointmentId, setMovingAppointmentId] = useState<number | null>(null);
  const [draggingAppointmentId, setDraggingAppointmentId] = useState<number | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState("");
  const [calendarPointerDrag, setCalendarPointerDrag] = useState<CalendarPointerDrag | null>(null);
  const [calendarCreateDrag, setCalendarCreateDrag] = useState<CalendarCreateDrag | null>(null);
  const [serviceName, setServiceName] = useState("");
  const [serviceDuration, setServiceDuration] = useState("");
  const [servicePrice, setServicePrice] = useState(0);
  const [serviceActive, setServiceActive] = useState(true);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [appointmentSearch, setAppointmentSearch] = useState("");
  const [appointmentClientFilter, setAppointmentClientFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("toate");
  const [selectedMonth, setSelectedMonth] = useState(() => todayIso().slice(0, 7));
  const [reportMonth, setReportMonth] = useState(() => todayIso().slice(0, 7));
  const [scrollToEditorTick, setScrollToEditorTick] = useState(0);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(
    "default"
  );
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isRunningCloudBackup, setIsRunningCloudBackup] = useState(false);
  const [lastBackupPath, setLastBackupPath] = useState("");
  const [pushLogs, setPushLogs] = useState<PushLog[]>([]);
  const [isLoadingPushLogs, setIsLoadingPushLogs] = useState(false);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>(() =>
    readBusinessSettings()
  );
  const [daysOffInput, setDaysOffInput] = useState(() => readBusinessSettings().daysOff.join(", "));
  const [personalBlockTitle, setPersonalBlockTitle] = useState(PERSONAL_BLOCK_PRESETS[0]);
  const [personalBlockDate, setPersonalBlockDate] = useState(todayIso());
  const [personalBlockTime, setPersonalBlockTime] = useState("10:00");
  const [personalBlockDuration, setPersonalBlockDuration] = useState("1h");
  const [isSavingPersonalBlock, setIsSavingPersonalBlock] = useState(false);
  const [whatsappTemplate, setWhatsappTemplate] = useState(readWhatsAppTemplate);
  const [saveWarning, setSaveWarning] = useState<SaveWarning | null>(null);
  const [nextSlotIndex, setNextSlotIndex] = useState(0);
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
      const supabaseClient = supabase;

      const fetchAllRows = async <T,>(
        fetchPage: (
          from: number,
          to: number,
        ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
      ) => {
        let from = 0;
        const all: T[] = [];

        while (true) {
          const to = from + SUPABASE_PAGE_SIZE - 1;
          const page = await Promise.resolve(fetchPage(from, to));
          if (page.error) {
            return { data: null as T[] | null, error: page.error };
          }

          const rows = page.data ?? [];
          all.push(...rows);
          if (rows.length < SUPABASE_PAGE_SIZE) {
            break;
          }
          from += SUPABASE_PAGE_SIZE;
        }

        return { data: all, error: null as { message: string } | null };
      };

      const clientsPromise = fetchAllRows<SupabaseClientRow>((from, to) =>
        supabaseClient.from("clients").select("*").order("name", { ascending: true }).range(from, to),
      );

      const appointmentsWithNotesPromise = fetchAllRows<SupabaseAppointmentRow>((from, to) =>
        supabaseClient
          .from("appointments")
          .select(APPOINTMENT_SELECT_WITH_NOTES)
          .order("appointment_date", { ascending: true })
          .order("start_time", { ascending: true })
          .range(from, to),
      );

      const servicesPromise = fetchAllRows<SupabaseServiceRow>((from, to) =>
        supabaseClient.from("services").select("*").order("name", { ascending: true }).range(from, to),
      );

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
        const fallbackAppointments = await fetchAllRows<SupabaseAppointmentRowWithoutNotes>((from, to) =>
          supabaseClient
            .from("appointments")
            .select(APPOINTMENT_SELECT_WITHOUT_NOTES)
            .order("appointment_date", { ascending: true })
            .order("start_time", { ascending: true })
            .range(from, to),
        );

        if (fallbackAppointments.error || !fallbackAppointments.data) {
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

      if (clientsResponse.error || !clientsResponse.data) {
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
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  const selectedServiceForForm = useMemo(
    () => services.find((service) => service.id === selectedServiceId) ?? null,
    [selectedServiceId, services]
  );

  const movingAppointment = useMemo(
    () =>
      appointments.find(
        (appointment) =>
          appointment.id === (movingAppointmentId ?? draggingAppointmentId)
      ) ?? null,
    [appointments, draggingAppointmentId, movingAppointmentId]
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
        : statusFilter === "neconfirmate"
          ? list.filter(
              (appointment) =>
                appointment.status === "Noua" ||
                appointment.status === "Reminder maine"
            )
        : list.filter((appointment) => appointment.status === statusFilter);
    const term = appointmentSearch.trim().toLowerCase();
    const bySearch = !term
      ? filtered
      : filtered.filter(
          (appointment) =>
            appointment.clientName.toLowerCase().includes(term) ||
            appointment.service.toLowerCase().includes(term) ||
            appointment.phone.toLowerCase().includes(term)
        );
    return bySearch.sort((a, b) => a.start.localeCompare(b.start));
  }, [appointmentDate, appointments, statusFilter, appointmentSearch]);

  const mostUsedServiceId = useMemo(() => {
    const usage = new Map<number, number>();
    for (const appointment of appointments) {
      const service = services.find((item) => item.name === appointment.service);
      if (!service) continue;
      usage.set(service.id, (usage.get(service.id) ?? 0) + 1);
    }
    let bestId = activeServices[0]?.id ?? services[0]?.id ?? baseServices[0]?.id ?? 0;
    let bestCount = -1;
    for (const [id, count] of usage.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestId = id;
      }
    }
    return bestId;
  }, [appointments, services, activeServices]);

  const appointmentsForDayAll = useMemo(
    () =>
      appointments
        .filter((appointment) => appointment.date === appointmentDate)
        .sort((a, b) => a.start.localeCompare(b.start)),
    [appointmentDate, appointments]
  );

  const workWindowsForSelectedDate = useMemo(
    () => getWorkWindowsForDate(appointmentDate, businessSettings),
    [appointmentDate, businessSettings]
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
    const windows = workWindowsForSelectedDate;
    if (windows.length === 0) {
      return {
        segments,
        totalFreeMinutes: 0,
        totalWorkMinutes: 0,
        activeCount: 0,
        isDayOff: true,
      };
    }

    const dayStart = windows[0].start;
    const dayEnd = windows[windows.length - 1].end;

    const busySegments = active
      .map((appointment) => {
        const start = timeToMinutes(appointment.start);
        const end = start + parseDurationToMinutes(appointment.duration);
        return {
          appointment,
          start: Math.max(start, dayStart),
          end: Math.min(end, dayEnd),
        };
      })
      .filter((segment) => segment.end > segment.start)
      .sort((a, b) => a.start - b.start);

    let cursor = dayStart;
    for (const busy of busySegments) {
      if (busy.start > cursor) {
        segments.push({
          kind: "free",
          start: cursor,
          end: busy.start,
          minutes: busy.start - cursor,
        });
      }

      segments.push({
        kind: "busy",
        start: busy.start,
        end: busy.end,
        minutes: busy.end - busy.start,
        appointment: busy.appointment,
      });

      cursor = Math.max(cursor, busy.end);
    }

    if (cursor < dayEnd) {
      segments.push({
        kind: "free",
        start: cursor,
        end: dayEnd,
        minutes: dayEnd - cursor,
      });
    }

    const totalFreeMinutes = segments
      .filter((segment) => segment.kind === "free")
      .reduce((sum, segment) => sum + segment.minutes, 0);

    const totalWorkMinutes = windows.reduce((sum, windowRange) => {
      return sum + (windowRange.end - windowRange.start);
    }, 0);

    return {
      segments,
      totalFreeMinutes,
      totalWorkMinutes,
      activeCount: busySegments.length,
      isDayOff: false,
    };
  }, [appointmentsForDayAll, workWindowsForSelectedDate]);

  const nextAvailableSlots = useMemo(() => {
    const minimumSlotMinutes = 90;
    const maxSlots = 10;
    const now = new Date();
    const nowDateIso = isoFromDate(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const found: Array<{ date: string; start: number }> = [];

    for (let dayOffset = 0; dayOffset < 45; dayOffset += 1) {
      const date = new Date(now);
      date.setHours(12, 0, 0, 0);
      date.setDate(now.getDate() + dayOffset);
      const isoDate = isoFromDate(date);
      const windows = getWorkWindowsForDate(isoDate, businessSettings);
      if (windows.length === 0) continue;

      const busySegments = appointments
        .filter((appointment) => appointment.date === isoDate && appointment.status !== "Anulata")
        .map((appointment) => {
          const start = timeToMinutes(appointment.start);
          const end = start + parseDurationToMinutes(appointment.duration);
          return { start, end };
        })
        .sort((a, b) => a.start - b.start);

      for (const windowRange of windows) {
        let cursor = windowRange.start;
        if (isoDate === nowDateIso) {
          cursor = Math.max(cursor, nowMinutes);
        }

        for (const busy of busySegments) {
          if (busy.end <= windowRange.start) continue;
          if (busy.start >= windowRange.end) break;
          const clampedStart = Math.max(busy.start, windowRange.start);
          const clampedEnd = Math.min(busy.end, windowRange.end);
          if (clampedStart > cursor && clampedStart - cursor >= minimumSlotMinutes) {
            found.push({ date: isoDate, start: cursor });
            if (found.length >= maxSlots) {
              return found;
            }
          }
          if (clampedEnd > cursor) {
            cursor = clampedEnd;
          }
        }

        if (windowRange.end - cursor >= minimumSlotMinutes) {
          found.push({ date: isoDate, start: cursor });
          if (found.length >= maxSlots) {
            return found;
          }
        }
      }
    }

    return found;
  }, [appointments, businessSettings]);

  const nextAvailableSlot = nextAvailableSlots[nextSlotIndex] ?? null;

  useEffect(() => {
    if (nextAvailableSlots.length === 0) {
      if (nextSlotIndex !== 0) setNextSlotIndex(0);
      return;
    }
    if (nextSlotIndex > nextAvailableSlots.length - 1) {
      setNextSlotIndex(0);
    }
  }, [nextAvailableSlots, nextSlotIndex]);

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
      const windows = getWorkWindowsForDate(appointment.date, businessSettings);
      const start = timeToMinutes(appointment.start);
      const end = start + parseDurationToMinutes(appointment.duration);
      const minutes = getOverlapMinutesInWindows(start, end, windows);
      const current = stats.get(appointment.date) ?? { count: 0, busyMinutes: 0 };
      current.count += 1;
      current.busyMinutes += minutes;
      stats.set(appointment.date, current);
    }
    return stats;
  }, [appointments, businessSettings]);

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
      return {
        iso,
        day: date.getDate(),
        inCurrentMonth: toMonthKey(iso) === selectedMonth,
        isSelected: iso === appointmentDate,
        count: stat.count,
        busyMinutes: stat.busyMinutes,
      };
    });
  }, [appointmentDate, calendarDayStats, selectedMonth]);

  const calendarTimeline = useMemo(() => {
    const activeAppointments = appointmentsForDayAll.filter(
      (appointment) => appointment.status !== "Anulata"
    );
    const windowStarts = workWindowsForSelectedDate.map((windowRange) => windowRange.start);
    const windowEnds = workWindowsForSelectedDate.map((windowRange) => windowRange.end);
    const appointmentStarts = activeAppointments.map((appointment) =>
      timeToMinutes(appointment.start)
    );
    const appointmentEnds = activeAppointments.map((appointment) => {
      const start = timeToMinutes(appointment.start);
      return start + parseDurationToMinutes(appointment.duration);
    });
    const minMinute = Math.min(
      timeToMinutes(DEFAULT_DAY_START),
      ...windowStarts,
      ...appointmentStarts
    );
    const maxMinute = Math.max(
      timeToMinutes(DEFAULT_DAY_END),
      ...windowEnds,
      ...appointmentEnds
    );
    const rangeStart = Math.max(0, Math.floor(minMinute / 60) * 60);
    const rangeEnd = Math.min(24 * 60, Math.max(rangeStart + 60, Math.ceil(maxMinute / 60) * 60));
    const hourMarks = Array.from(
      { length: Math.floor((rangeEnd - rangeStart) / 60) + 1 },
      (_, index) => rangeStart + index * 60
    );
    const quarterMarks = Array.from(
      { length: Math.floor((rangeEnd - rangeStart) / CALENDAR_SNAP_MINUTES) },
      (_, index) => rangeStart + (index + 1) * CALENDAR_SNAP_MINUTES
    ).filter((minute) => minute < rangeEnd && minute % 60 !== 0);
    return {
      appointments: activeAppointments,
      rangeStart,
      rangeEnd,
      hourMarks,
      quarterMarks,
      height: ((rangeEnd - rangeStart) / 60) * CALENDAR_HOUR_HEIGHT,
    };
  }, [appointmentsForDayAll, workWindowsForSelectedDate]);

  const reportMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ro-RO", {
        month: "long",
        year: "numeric",
      }).format(new Date(`${reportMonth}-01T12:00:00`)),
    [reportMonth]
  );

  const reportYear = reportMonth.slice(0, 4);

  const reportYearOptions = useMemo(() => {
    const currentYear = todayIso().slice(0, 4);
    const years = new Set<string>([currentYear, ...appointments.map((appointment) => appointment.date.slice(0, 4))]);
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [appointments]);

  const reportMonthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, index) => {
      const month = `${index + 1}`.padStart(2, "0");
      return `${reportYear}-${month}`;
    });
  }, [reportYear]);

  const reportData = useMemo(() => {
    const allAppointments = appointments
      .filter((appointment) => appointment.date >= "2023-01-01")
      .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));
    const allNonCancelled = allAppointments.filter((appointment) => appointment.status !== "Anulata");

    const allRevenue = allNonCancelled.reduce((sum, appointment) => sum + appointment.price, 0);
    const allUniqueClients = new Set(allNonCancelled.map((appointment) => appointment.clientId)).size;
    const allAvgTicket = allNonCancelled.length > 0 ? Math.round(allRevenue / allNonCancelled.length) : 0;

    const yearAppointments = allAppointments.filter((appointment) => appointment.date.startsWith(`${reportYear}-`));
    const yearNonCancelled = yearAppointments.filter((appointment) => appointment.status !== "Anulata");
    const yearRevenue = yearNonCancelled.reduce((sum, appointment) => sum + appointment.price, 0);
    const yearUniqueClients = new Set(yearNonCancelled.map((appointment) => appointment.clientId)).size;
    const yearAvgTicket = yearNonCancelled.length > 0 ? Math.round(yearRevenue / yearNonCancelled.length) : 0;

    const monthAppointments = yearAppointments
      .filter((appointment) => toMonthKey(appointment.date) === reportMonth)
      .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));

    const nonCancelled = monthAppointments.filter((appointment) => appointment.status !== "Anulata");
    const totalRevenue = nonCancelled.reduce((sum, appointment) => sum + appointment.price, 0);
    const uniqueClients = new Set(nonCancelled.map((appointment) => appointment.clientId)).size;
    const avgTicket = nonCancelled.length > 0 ? Math.round(totalRevenue / nonCancelled.length) : 0;
    const hiddenRunningRevenue = allNonCancelled
      .filter((appointment) => appointment.date >= HIDDEN_RUNNING_TOTAL_START)
      .reduce((sum, appointment) => sum + appointment.price, 0);

    const statusMap = new Map<string, number>();
    for (const appointment of monthAppointments) {
      statusMap.set(appointment.status, (statusMap.get(appointment.status) ?? 0) + 1);
    }

    const serviceMap = new Map<string, { count: number; revenue: number }>();
    for (const appointment of nonCancelled) {
      const current = serviceMap.get(appointment.service) ?? { count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += appointment.price;
      serviceMap.set(appointment.service, current);
    }
    const topServices = [...serviceMap.entries()]
      .map(([name, values]) => ({
        name,
        count: values.count,
        revenue: values.revenue,
      }))
      .sort((a, b) => (b.count === a.count ? b.revenue - a.revenue : b.count - a.count))
      .slice(0, 8);

    const allTimeClientMap = new Map<number, { name: string; count: number; revenue: number; lastDate: string }>();
    for (const appointment of allNonCancelled) {
      const current = allTimeClientMap.get(appointment.clientId) ?? {
        name: appointment.clientName,
        count: 0,
        revenue: 0,
        lastDate: appointment.date,
      };
      current.count += 1;
      current.revenue += appointment.price;
      if (appointment.date > current.lastDate) {
        current.lastDate = appointment.date;
      }
      allTimeClientMap.set(appointment.clientId, current);
    }
    const topClientsAllTime = [...allTimeClientMap.values()]
      .sort((a, b) => (b.revenue === a.revenue ? b.count - a.count : b.revenue - a.revenue))
      .slice(0, 12);

    const yearClientMap = new Map<number, { name: string; count: number; revenue: number }>();
    for (const appointment of yearNonCancelled) {
      const current = yearClientMap.get(appointment.clientId) ?? {
        name: appointment.clientName,
        count: 0,
        revenue: 0,
      };
      current.count += 1;
      current.revenue += appointment.price;
      yearClientMap.set(appointment.clientId, current);
    }
    const topClientsYear = [...yearClientMap.values()]
      .sort((a, b) => (b.revenue === a.revenue ? b.count - a.count : b.revenue - a.revenue))
      .slice(0, 8);

    const clientMap = new Map<number, { name: string; count: number; revenue: number }>();
    for (const appointment of nonCancelled) {
      const current = clientMap.get(appointment.clientId) ?? {
        name: appointment.clientName,
        count: 0,
        revenue: 0,
      };
      current.count += 1;
      current.revenue += appointment.price;
      clientMap.set(appointment.clientId, current);
    }
    const topClients = [...clientMap.values()]
      .sort((a, b) => (b.count === a.count ? b.revenue - a.revenue : b.count - a.count))
      .slice(0, 8);

    const yearMonthMap = new Map<string, { revenue: number; count: number; clients: Set<number> }>();
    for (let month = 1; month <= 12; month += 1) {
      const mm = `${month}`.padStart(2, "0");
      yearMonthMap.set(`${reportYear}-${mm}`, { revenue: 0, count: 0, clients: new Set<number>() });
    }
    for (const appointment of yearNonCancelled) {
      const key = toMonthKey(appointment.date);
      const current = yearMonthMap.get(key) ?? { revenue: 0, count: 0, clients: new Set<number>() };
      current.revenue += appointment.price;
      current.count += 1;
      current.clients.add(appointment.clientId);
      yearMonthMap.set(key, current);
    }
    const monthlyInYear = [...yearMonthMap.entries()]
      .map(([key, value]) => ({
        key,
        label: new Intl.DateTimeFormat("ro-RO", { month: "short" }).format(new Date(`${key}-01T12:00:00`)),
        revenue: value.revenue,
        count: value.count,
        clients: value.clients.size,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    const yearMap = new Map<string, { revenue: number; count: number; clients: Set<number> }>();
    for (const appointment of allNonCancelled) {
      const y = appointment.date.slice(0, 4);
      const current = yearMap.get(y) ?? { revenue: 0, count: 0, clients: new Set<number>() };
      current.revenue += appointment.price;
      current.count += 1;
      current.clients.add(appointment.clientId);
      yearMap.set(y, current);
    }
    const byYear = [...yearMap.entries()]
      .map(([year, value]) => ({
        year,
        revenue: value.revenue,
        count: value.count,
        clients: value.clients.size,
      }))
      .sort((a, b) => b.year.localeCompare(a.year));

    const dayMap = new Map<string, number>();
    for (const appointment of nonCancelled) {
      dayMap.set(appointment.date, (dayMap.get(appointment.date) ?? 0) + 1);
    }
    const busiestDays = [...dayMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))
      .slice(0, 6);

    const hourMap = new Map<number, number>();
    for (const appointment of nonCancelled) {
      const hour = Number(appointment.start.split(":")[0]);
      if (Number.isFinite(hour)) {
        hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);
      }
    }
    const hourlyLoad = Array.from({ length: 14 }, (_, index) => {
      const hour = 8 + index;
      return {
        label: `${`${hour}`.padStart(2, "0")}:00`,
        count: hourMap.get(hour) ?? 0,
      };
    });

    const today = todayIso();
    const todayAppointments = allAppointments.filter((appointment) => appointment.date === today);
    const todayNonCancelled = todayAppointments.filter((appointment) => appointment.status !== "Anulata");
    const todayRevenue = todayNonCancelled.reduce((sum, appointment) => sum + appointment.price, 0);
    const todayPendingConfirmations = todayAppointments.filter(
      (appointment) => appointment.status === "Noua" || appointment.status === "Reminder maine"
    ).length;

    return {
      allAppointments,
      allNonCancelled,
      allRevenue,
      allUniqueClients,
      allAvgTicket,
      hiddenRunningRevenue,
      yearAppointments,
      yearNonCancelled,
      yearRevenue,
      yearUniqueClients,
      yearAvgTicket,
      monthAppointments,
      nonCancelled,
      totalRevenue,
      uniqueClients,
      avgTicket,
      statusMap,
      topServices,
      topClientsAllTime,
      topClientsYear,
      topClients,
      monthlyInYear,
      byYear,
      busiestDays,
      hourlyLoad,
      todayAppointments,
      todayRevenue,
      todayPendingConfirmations,
    };
  }, [appointments, reportMonth, reportYear]);

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
    const today = todayIso();

    for (const client of clients) {
      map.set(client.id, { visits: client.visits, lastVisit: client.lastVisit });
    }

    for (const client of clients) {
      const relatedAppointments = appointments
        .filter(
          (appointment) =>
            appointment.clientId === client.id &&
            appointment.status !== "Anulata"
        )
        .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));

      if (relatedAppointments.length > 0) {
        const pastAppointments = relatedAppointments.filter((appointment) => appointment.date <= today);
        const lastPast = pastAppointments[pastAppointments.length - 1];
        const latestAny = relatedAppointments[relatedAppointments.length - 1];
        const lastVisitLabel = lastPast
          ? formatShortDate(lastPast.date)
          : `urmeaza ${formatShortDate(latestAny.date)}`;

        map.set(client.id, {
          visits: relatedAppointments.length,
          lastVisit: lastVisitLabel,
        });
      }
    }

    return map;
  }, [appointments, clients]);

  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    const list = clients
      .filter((client) => !isPersonalClient(client))
      .sort((a, b) => a.name.localeCompare(b.name, "ro"));
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
    const list = clients
      .filter((client) => !isPersonalClient(client))
      .sort((a, b) => a.name.localeCompare(b.name, "ro"));
    if (!term) {
      return list;
    }
    return list.filter(
      (client) =>
        client.name.toLowerCase().includes(term) ||
        client.phone.toLowerCase().includes(term)
    );
  }, [appointmentClientFilter, clients]);

  const personalBlocks = useMemo(
    () =>
      appointments
        .filter(isPersonalBlock)
        .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date))),
    [appointments]
  );

  useEffect(() => {
    if (filteredClientsForAppointment.length === 0) {
      return;
    }
    const stillVisible = filteredClientsForAppointment.some(
      (client) => client.id === selectedClientId
    );
    if (!stillVisible) {
      setSelectedClientId(filteredClientsForAppointment[0].id);
    }
  }, [filteredClientsForAppointment, selectedClientId]);

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

  useEffect(() => {
    writeBusinessSettings(businessSettings);
  }, [businessSettings]);

  useEffect(() => {
    writeWhatsAppTemplate(whatsappTemplate);
  }, [whatsappTemplate]);

  useEffect(
    () => () => {
      if (calendarMoveHoldTimerRef.current) {
        window.clearTimeout(calendarMoveHoldTimerRef.current);
      }
    },
    []
  );

  const resetAppointmentForm = (service?: Service) => {
    const mostUsedService =
      services.find((item) => item.id === mostUsedServiceId) ??
      activeServices[0] ??
      services[0] ??
      baseServices[0];
    const source = service ?? mostUsedService;
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

  const updateBusinessDay = (
    dayKey: number,
    patch: Partial<DayBusinessSettings>
  ) => {
    setBusinessSettings((current) => ({
      ...current,
      schedule: {
        ...current.schedule,
        [dayKey]: {
          ...current.schedule[dayKey],
          ...patch,
        },
      },
    }));
  };

  const applyDaysOffInput = () => {
    const values = daysOffInput
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const valid = values.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
    if (valid.length !== values.length) {
      setToast({
        text: "Format invalid pentru zile libere. Foloseste YYYY-MM-DD, separate prin virgula.",
        type: "error",
      });
      return;
    }
    setBusinessSettings((current) => ({
      ...current,
      daysOff: [...new Set(valid)],
    }));
    setDaysOffInput([...new Set(valid)].join(", "));
    setToast({ text: "Zilele libere au fost actualizate.", type: "success" });
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

  const fitsInsideWorkWindows = (
    date: string,
    startTime: string,
    duration: string
  ) => {
    const start = timeToMinutes(startTime);
    const end = start + parseDurationToMinutes(duration);
    const windows = getWorkWindowsForDate(date, businessSettings);
    return windows.some(
      (windowRange) => start >= windowRange.start && end <= windowRange.end
    );
  };

  const buildReservationWarning = () => {
    if (!selectedClient) {
      return null;
    }

    const related = appointments
      .filter(
        (appointment) =>
          appointment.clientId === selectedClient.id &&
          appointment.id !== editingAppointmentId &&
          appointment.status !== "Anulata"
      )
      .sort((a, b) =>
        a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)
      );

    if (related.length === 0) {
      return null;
    }

    const windowDays = 21;
    const pastCandidate = [...related]
      .reverse()
      .find((appointment) => {
        const diff = daysBetween(appointment.date, appointmentDate);
        return diff > 0 && diff <= windowDays;
      });
    const futureCandidate = related.find((appointment) => {
      const diff = daysBetween(appointmentDate, appointment.date);
      return diff > 0 && diff <= windowDays;
    });

    const details: string[] = [];
    if (pastCandidate) {
      const days = daysBetween(pastCandidate.date, appointmentDate);
      details.push(
        `Clienta a avut o rezervare cu ${daysToHuman(days)} in urma (${fullDateLabel(
          pastCandidate.date
        )}, ${pastCandidate.start}), iar rezervarea de atunci a fost: ${pastCandidate.service}.`
      );
    }
    if (futureCandidate) {
      const days = daysBetween(appointmentDate, futureCandidate.date);
      details.push(
        `Clienta mai are o rezervare peste ${daysToHuman(days)} (${fullDateLabel(
          futureCandidate.date
        )}, ${futureCandidate.start}). Tip programare: ${futureCandidate.service}.`
      );
    }

    if (details.length === 0) {
      return null;
    }

    return {
      title: "Atentie la intervalul programarilor",
      details,
    } as SaveWarning;
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
    const text = renderWhatsAppTemplate(whatsappTemplate, appointment);
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

  const handleRunCloudBackup = async () => {
    if (!session?.access_token) {
      setToast({ text: "Trebuie sa fii autentificata pentru backup cloud.", type: "error" });
      return;
    }
    setIsRunningCloudBackup(true);
    try {
      const response = await fetch("/api/backups/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = (await response.json()) as {
        ok: boolean;
        path?: string;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Backup failed");
      }
      setLastBackupPath(result.path ?? "");
      setToast({
        text: "Backup cloud creat cu succes.",
        type: "success",
      });
    } catch (error) {
      setToast({
        text:
          error instanceof Error && error.message
            ? error.message
            : "Nu am putut crea backup-ul cloud.",
        type: "error",
      });
    } finally {
      setIsRunningCloudBackup(false);
    }
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

      const servicesRows = [...services]
        .sort((a, b) => a.name.localeCompare(b.name, "ro"))
        .map((service) => [
          service.name,
          service.duration,
          service.price,
          service.active ? "Activ" : "Inactiv",
        ]);

      const workbook = XLSX.utils.book_new();
      const clientsSheet = XLSX.utils.aoa_to_sheet([
        ["Nume", "Telefon", "Observatii", "Vizite", "Ultima vizita"],
        ...clientsRows,
      ]);
      const appointmentsSheet = XLSX.utils.aoa_to_sheet([
        ["Data", "Ora", "Clienta", "Telefon", "Serviciu", "Durata", "Pret", "Status", "Observatii"],
        ...appointmentsRows,
      ]);
      const servicesSheet = XLSX.utils.aoa_to_sheet([
        ["Serviciu", "Durata", "Pret", "Status"],
        ...servicesRows,
      ]);

      XLSX.utils.book_append_sheet(workbook, clientsSheet, "Cliente");
      XLSX.utils.book_append_sheet(workbook, appointmentsSheet, "Programari");
      XLSX.utils.book_append_sheet(workbook, servicesSheet, "Servicii");

      XLSX.writeFile(workbook, `solash-export-${todayIso()}.xlsx`);

      setToast({
        text: "Am exportat fisier Excel cu 3 sheet-uri: Cliente, Programari, Servicii.",
        type: "success",
      });
    } catch {
      setToast({ text: "Nu am putut exporta fisierul Excel.", type: "error" });
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

  const handleSaveAppointment = async (skipWarning = false) => {
    if (!selectedClient) {
      setToast({ text: "Adauga mai intai o clienta.", type: "error" });
      return;
    }
    if (!selectedClient.phone.trim()) {
      setToast({ text: "Clienta nu are numar de telefon. Completeaza telefonul.", type: "error" });
      return;
    }
    if (appointmentPrice <= 0) {
      setToast({ text: "Pretul trebuie sa fie mai mare ca 0.", type: "error" });
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

    if (!skipWarning) {
      const warning = buildReservationWarning();
      if (warning) {
        setSaveWarning(warning);
        return;
      }
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
      setSaveWarning(null);
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
        setSaveWarning(null);
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
    setSaveWarning(null);
    setIsSavingAppointment(false);
    setActiveTab("home");
  };

  const handleSavePersonalBlock = async () => {
    const title = personalBlockTitle.trim();
    const durationMinutes = parseDurationToMinutes(personalBlockDuration);
    if (!title) {
      setToast({ text: "Scrie numele blocajului, de exemplu Eu gene.", type: "error" });
      return;
    }
    if (durationMinutes <= 0) {
      setToast({ text: "Durata blocajului nu este valida.", type: "error" });
      return;
    }

    if (!fitsInsideWorkWindows(personalBlockDate, personalBlockTime, personalBlockDuration)) {
      setToast({ text: "Blocajul este in afara programului setat.", type: "error" });
      return;
    }

    const dayAppointments = appointments.filter(
      (appointment) => appointment.date === personalBlockDate
    );
    if (hasConflict(null, personalBlockTime, personalBlockDuration, dayAppointments)) {
      setToast({ text: "Blocajul se suprapune cu alta programare.", type: "error" });
      return;
    }

    setIsSavingPersonalBlock(true);

    const findPersonalClient = (list: Client[]) =>
      list.find(
        (client) =>
          client.name.toLowerCase() === title.toLowerCase() &&
          (client.notes.includes(PERSONAL_CLIENT_MARKER) ||
            client.phone === PERSONAL_BLOCK_PHONE)
      ) ?? null;

    let targetClient = findPersonalClient(clients);
    let nextClients = clients;

    if (!isSupabaseConfigured || !supabase || !session || !isOnline) {
      if (!targetClient) {
        const tempClientId = isSupabaseConfigured ? nextTempId() : Date.now();
        targetClient = {
          id: tempClientId,
          name: title,
          phone: PERSONAL_BLOCK_PHONE,
          notes: `${PERSONAL_CLIENT_MARKER} Clienta interna pentru blocaje personale.`,
          visits: 0,
          lastVisit: "blocaj personal",
        };
        nextClients = [...clients, targetClient].sort((a, b) =>
          a.name.localeCompare(b.name, "ro")
        );
        setClients(nextClients);
        if (isSupabaseConfigured) {
          enqueueOfflineOp({ type: "upsert_client", record: targetClient });
        }
      }

      const personalAppointment: Appointment = {
        id: isSupabaseConfigured ? nextTempId() - 1 : Date.now(),
        clientId: targetClient.id,
        clientName: targetClient.name,
        service: PERSONAL_BLOCK_SERVICE,
        date: personalBlockDate,
        start: personalBlockTime,
        duration: personalBlockDuration,
        price: 0,
        phone: targetClient.phone,
        status: "Confirmata",
        notes: `${PERSONAL_BLOCK_MARKER} ${title}`,
      };
      const nextAppointments = sortAppointmentsByDateTime([
        ...appointments,
        personalAppointment,
      ]);
      setAppointments(nextAppointments);
      persistLocalState({ clients: nextClients, appointments: nextAppointments });
      if (isSupabaseConfigured) {
        enqueueOfflineOp({ type: "upsert_appointment", record: personalAppointment });
      }
      setToast({
        text:
          !isOnline && isSupabaseConfigured
            ? "Blocaj salvat offline. Se sincronizeaza la reconectare."
            : "Blocajul personal a fost adaugat.",
        type: "success",
      });
      setIsSavingPersonalBlock(false);
      return;
    }

    if (!targetClient) {
      const { data, error } = await supabase
        .from("clients")
        .insert({
          name: title,
          phone: PERSONAL_BLOCK_PHONE,
          notes: `${PERSONAL_CLIENT_MARKER} Clienta interna pentru blocaje personale.`,
          visits: 0,
          last_visit_label: "blocaj personal",
        })
        .select("*")
        .single();

      if (error || !data) {
        setToast({ text: "Nu am putut crea clienta interna pentru blocaj.", type: "error" });
        setIsSavingPersonalBlock(false);
        return;
      }

      targetClient = mapClientRow(data as SupabaseClientRow);
      nextClients = [...clients, targetClient].sort((a, b) =>
        a.name.localeCompare(b.name, "ro")
      );
      setClients(nextClients);
    }

    const payloadBase = {
      client_id: targetClient.id,
      service: PERSONAL_BLOCK_SERVICE,
      appointment_date: personalBlockDate,
      start_time: personalBlockTime,
      duration: personalBlockDuration,
      price: 0,
      status: "Confirmata",
    };

    const response = await supabase
      .from("appointments")
      .insert(
        supportsAppointmentNotes
          ? { ...payloadBase, notes: `${PERSONAL_BLOCK_MARKER} ${title}` }
          : payloadBase
      )
      .select(
        supportsAppointmentNotes
          ? APPOINTMENT_SELECT_WITH_NOTES
          : APPOINTMENT_SELECT_WITHOUT_NOTES
      )
      .single();

    if (response.error) {
      setToast({ text: "Nu am putut salva blocajul in Supabase.", type: "error" });
      setIsSavingPersonalBlock(false);
      return;
    }

    const row = supportsAppointmentNotes
      ? (response.data as unknown as SupabaseAppointmentRow)
      : ({ ...(response.data as object), notes: `${PERSONAL_BLOCK_MARKER} ${title}` } as SupabaseAppointmentRow);
    const newAppointment = mapAppointmentRow(row);
    setAppointments((current) => sortAppointmentsByDateTime([...current, newAppointment]));
    setToast({ text: "Blocajul personal a fost adaugat.", type: "success" });
    setIsSavingPersonalBlock(false);
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

  const jumpToNextAvailableSlot = () => {
    if (!nextAvailableSlot) return;
    setActiveTab("appointments");
    setActivePanel("appointment");
    setAppointmentDate(nextAvailableSlot.date);
    setAppointmentTime(minutesToTime(nextAvailableSlot.start));
    setScrollToEditorTick((value) => value + 1);
  };

  const handleMoveAppointment = async (
    appointment: Appointment,
    nextDate: string,
    nextStart: string
  ) => {
    if (!fitsInsideWorkWindows(nextDate, nextStart, appointment.duration)) {
      setToast({
        text: "Nu pot muta programarea in afara programului sau peste pauza.",
        type: "error",
      });
      return;
    }

    const dayAppointments = appointments.filter((item) => item.date === nextDate);
    if (hasConflict(appointment.id, nextStart, appointment.duration, dayAppointments)) {
      setToast({ text: "Nu pot muta programarea: se suprapune cu alta.", type: "error" });
      return;
    }

    const updated = { ...appointment, date: nextDate, start: nextStart };
    const previousAppointments = appointments;
    const nextAppointments = sortAppointmentsByDateTime(
      previousAppointments.map((item) => (item.id === appointment.id ? updated : item))
    );

    setAppointments(nextAppointments);
    setMovingAppointmentId(null);
    setDraggingAppointmentId(null);
    setDragTargetKey("");

    if (!isSupabaseConfigured || !supabase || !session || !isOnline || appointment.id < 0) {
      persistLocalState({ appointments: nextAppointments });
      if (isSupabaseConfigured) {
        enqueueOfflineOp({ type: "upsert_appointment", record: updated });
      }
      setToast({
        text:
          !isOnline && isSupabaseConfigured
            ? `Programare mutata offline la ${nextStart}. Se sincronizeaza la reconectare.`
            : `Programare mutata la ${nextStart}.`,
        type: "success",
      });
      return;
    }

    const { error } = await supabase
      .from("appointments")
      .update({ appointment_date: nextDate, start_time: nextStart })
      .eq("id", appointment.id);

    if (error) {
      setAppointments((current) =>
        sortAppointmentsByDateTime(
          current.map((item) => (item.id === appointment.id ? appointment : item))
        )
      );
      setToast({ text: "Nu am putut muta programarea.", type: "error" });
      return;
    }

    setToast({ text: `Programare mutata la ${nextStart}.`, type: "success" });
  };

  const startDraggingAppointment = (
    event: DragEvent<HTMLElement>,
    appointment: Appointment
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(appointment.id));
    setDraggingAppointmentId(appointment.id);
    setMovingAppointmentId(null);
  };

  const stopDraggingAppointment = () => {
    setDraggingAppointmentId(null);
    setDragTargetKey("");
  };

  const canMoveToFreeSegment = (appointment: Appointment | null, minutes: number) => {
    if (!appointment) return false;
    return minutes >= parseDurationToMinutes(appointment.duration);
  };

  const moveAppointmentToFreeSegment = async (
    start: number,
    minutes: number
  ) => {
    const appointment = movingAppointment;
    if (!appointment) {
      return;
    }
    if (!canMoveToFreeSegment(appointment, minutes)) {
      setToast({ text: "Intervalul liber este prea scurt pentru programarea asta.", type: "error" });
      return;
    }
    await handleMoveAppointment(appointment, appointmentDate, minutesToTime(start));
  };

  const handleFreeSegmentDragOver = (
    event: DragEvent<HTMLElement>,
    targetKey: string,
    minutes: number
  ) => {
    if (!canMoveToFreeSegment(movingAppointment, minutes)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTargetKey(targetKey);
  };

  const getTimelineMinuteFromClientY = (clientY: number, grabOffsetY = 0) => {
    const element = calendarTimelineRef.current;
    if (!element) {
      return calendarTimeline.rangeStart;
    }
    const rect = element.getBoundingClientRect();
    const rawMinutes =
      calendarTimeline.rangeStart +
      ((clientY - grabOffsetY - rect.top + element.scrollTop) / CALENDAR_HOUR_HEIGHT) * 60;
    const snapped =
      Math.round(rawMinutes / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES;
    return Math.min(calendarTimeline.rangeEnd, Math.max(calendarTimeline.rangeStart, snapped));
  };

  const getTimelineStartFromClientY = (
    clientY: number,
    appointment: Appointment,
    grabOffsetY = 0
  ) => {
    const snapped = getTimelineMinuteFromClientY(clientY, grabOffsetY);
    const duration = parseDurationToMinutes(appointment.duration);
    const minStart = calendarTimeline.rangeStart;
    const maxStart = Math.max(minStart, calendarTimeline.rangeEnd - duration);
    return minutesToTime(Math.min(maxStart, Math.max(minStart, snapped)));
  };

  const clearCalendarMoveHoldTimer = () => {
    if (calendarMoveHoldTimerRef.current) {
      window.clearTimeout(calendarMoveHoldTimerRef.current);
      calendarMoveHoldTimerRef.current = null;
    }
  };

  const startCalendarPointerDrag = (
    event: PointerEvent<HTMLDivElement>,
    appointment: Appointment
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("button,a,input,textarea,select")
    ) {
      return;
    }
    clearCalendarMoveHoldTimer();
    const appointmentRect = event.currentTarget.getBoundingClientRect();
    const targetElement = event.currentTarget;
    const pointerId = event.pointerId;
    setCalendarPointerDrag({
      appointmentId: appointment.id,
      pointerId,
      originY: event.clientY,
      currentY: event.clientY,
      grabOffsetY: event.clientY - appointmentRect.top,
      active: false,
    });
    calendarMoveHoldTimerRef.current = window.setTimeout(() => {
      try {
        targetElement.setPointerCapture(pointerId);
      } catch {
        // Some mobile browsers can reject capture if the pointer ended quickly.
      }
      setDraggingAppointmentId(appointment.id);
      setCalendarPointerDrag((current) =>
        current &&
        current.pointerId === pointerId &&
        current.appointmentId === appointment.id
          ? { ...current, active: true }
          : current
      );
      calendarMoveHoldTimerRef.current = null;
    }, CALENDAR_MOVE_HOLD_MS);
    setMovingAppointmentId(null);
  };

  const updateCalendarPointerDrag = (
    event: PointerEvent<HTMLDivElement>,
    appointment: Appointment
  ) => {
    if (
      !calendarPointerDrag ||
      calendarPointerDrag.pointerId !== event.pointerId ||
      calendarPointerDrag.appointmentId !== appointment.id
    ) {
      return;
    }
    const movement = Math.abs(event.clientY - calendarPointerDrag.originY);
    if (!calendarPointerDrag.active && movement > 12) {
      clearCalendarMoveHoldTimer();
      setCalendarPointerDrag(null);
      return;
    }
    if (calendarPointerDrag.active) {
      event.preventDefault();
    }
    setCalendarPointerDrag((current) =>
      current &&
      current.pointerId === event.pointerId &&
      current.appointmentId === appointment.id
        ? { ...current, currentY: event.clientY }
        : current
    );
  };

  const finishCalendarPointerDrag = async (
    event: PointerEvent<HTMLDivElement>,
    appointment: Appointment
  ) => {
    if (
      !calendarPointerDrag ||
      calendarPointerDrag.pointerId !== event.pointerId ||
      calendarPointerDrag.appointmentId !== appointment.id
    ) {
      return;
    }
    clearCalendarMoveHoldTimer();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const wasActive = calendarPointerDrag.active;
    setCalendarPointerDrag(null);
    setDraggingAppointmentId(null);
    setDragTargetKey("");
    if (!wasActive) {
      return;
    }
    await handleMoveAppointment(
      appointment,
      appointmentDate,
      getTimelineStartFromClientY(event.clientY, appointment, calendarPointerDrag.grabOffsetY)
    );
  };

  const cancelCalendarPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (calendarPointerDrag?.pointerId === event.pointerId) {
      clearCalendarMoveHoldTimer();
      setCalendarPointerDrag(null);
      setDraggingAppointmentId(null);
      setDragTargetKey("");
    }
  };

  const handleCalendarTimelineDrop = async (event: DragEvent<HTMLDivElement>) => {
    const appointment = movingAppointment;
    if (!appointment) {
      return;
    }
    event.preventDefault();
    await handleMoveAppointment(
      appointment,
      appointmentDate,
      getTimelineStartFromClientY(event.clientY, appointment)
    );
  };

  const handleCalendarTimelineClick = async (event: MouseEvent<HTMLDivElement>) => {
    const appointment = movingAppointment;
    if (!appointment) {
      return;
    }
    await handleMoveAppointment(
      appointment,
      appointmentDate,
      getTimelineStartFromClientY(event.clientY, appointment)
    );
  };

  const openAppointmentDraftFromCalendar = (startMinutes: number, durationMinutes: number) => {
    const duration = minutesToDurationInput(durationMinutes);
    const startTime = minutesToTime(startMinutes);
    const dayAppointments = appointments.filter(
      (appointment) => appointment.date === appointmentDate
    );

    if (!fitsInsideWorkWindows(appointmentDate, startTime, duration)) {
      setToast({ text: "Intervalul ales este in afara programului.", type: "error" });
      return;
    }

    if (hasConflict(null, startTime, duration, dayAppointments)) {
      setToast({ text: "Intervalul ales se suprapune cu alta programare.", type: "error" });
      return;
    }

    const service =
      selectedServiceForForm ??
      activeServices[0] ??
      services[0] ??
      baseServices[0];

    setActiveTab("appointments");
    setActivePanel("appointment");
    setEditingAppointmentId(null);
    setAppointmentDate(appointmentDate);
    setAppointmentTime(startTime);
    setAppointmentDuration(duration);
    if (service) {
      setSelectedServiceId(service.id);
      setAppointmentPrice(service.price);
    }
    setAppointmentStatus("Noua");
    setAppointmentNotes("");
    setAppointmentClientFilter("");
    setScrollToEditorTick((value) => value + 1);
  };

  const startCalendarCreateDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (movingAppointment || calendarPointerDrag) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("[data-calendar-appointment],button,a,input,textarea,select")
    ) {
      return;
    }

    setMovingAppointmentId(null);
    setDraggingAppointmentId(null);
    setCalendarCreateDrag({
      pointerId: event.pointerId,
      originY: event.clientY,
      currentY: event.clientY,
      startMinutes: getTimelineMinuteFromClientY(event.clientY),
      startedAt: Date.now(),
      active: false,
    });
  };

  const updateCalendarCreateDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!calendarCreateDrag || calendarCreateDrag.pointerId !== event.pointerId) {
      return;
    }

    const shouldActivate =
      calendarCreateDrag.active ||
      (Date.now() - calendarCreateDrag.startedAt > CALENDAR_CREATE_HOLD_MS &&
        Math.abs(event.clientY - calendarCreateDrag.originY) > 6);

    if (shouldActivate) {
      event.preventDefault();
      if (!calendarCreateDrag.active) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is best-effort on mobile browsers.
        }
      }
    }

    setCalendarCreateDrag((current) =>
      current && current.pointerId === event.pointerId
        ? { ...current, currentY: event.clientY, active: shouldActivate }
        : current
    );
  };

  const finishCalendarCreateDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!calendarCreateDrag || calendarCreateDrag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const wasActive =
      calendarCreateDrag.active ||
      (Date.now() - calendarCreateDrag.startedAt > CALENDAR_CREATE_HOLD_MS &&
        Math.abs(event.clientY - calendarCreateDrag.originY) > 6);
    const endMinutes = getTimelineMinuteFromClientY(event.clientY);
    let startMinutes = Math.min(calendarCreateDrag.startMinutes, endMinutes);
    let finishMinutes = Math.max(calendarCreateDrag.startMinutes, endMinutes);

    setCalendarCreateDrag(null);
    if (!wasActive) {
      return;
    }

    if (finishMinutes - startMinutes < 30) {
      if (endMinutes >= calendarCreateDrag.startMinutes) {
        finishMinutes = Math.min(calendarTimeline.rangeEnd, startMinutes + 30);
      } else {
        startMinutes = Math.max(calendarTimeline.rangeStart, finishMinutes - 30);
      }
    }

    if (finishMinutes - startMinutes < 30) {
      return;
    }

    openAppointmentDraftFromCalendar(startMinutes, finishMinutes - startMinutes);
  };

  const cancelCalendarCreateDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (calendarCreateDrag?.pointerId === event.pointerId) {
      setCalendarCreateDrag(null);
    }
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

  const handleShiftAppointmentMinutes = async (appointment: Appointment, minutes: number) => {
    const nextStartMinutes = timeToMinutes(appointment.start) + minutes;
    const nextEndMinutes = nextStartMinutes + parseDurationToMinutes(appointment.duration);
    if (nextStartMinutes < 0 || nextEndMinutes > 24 * 60) {
      setToast({ text: "Nu pot muta programarea in afara zilei.", type: "error" });
      return;
    }
    await handleMoveAppointment(appointment, appointment.date, minutesToTime(nextStartMinutes));
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

        {saveWarning ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="gold-ring w-full max-w-sm rounded-[8px] border border-line bg-panel p-5">
              <p className="text-base font-semibold text-gold-strong">{saveWarning.title}</p>
              <div className="mt-3 grid gap-2">
                {saveWarning.details.map((detail, index) => (
                  <p key={`${detail}-${index}`} className="text-sm leading-6 text-[#ddd4c5]">
                    {detail}
                  </p>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted">Esti sigura ca vrei sa salvezi programarea?</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  className="rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-medium"
                  onClick={() => setSaveWarning(null)}
                  type="button"
                >
                  Nu
                </button>
                <button
                  className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black"
                  onClick={() => void handleSaveAppointment(true)}
                  type="button"
                >
                  Da, salveaza
                </button>
              </div>
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
              <div className="mt-3 gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                <p className="text-sm text-muted">Urmatorul slot disponibil (minim 1h 30m)</p>
                {nextAvailableSlot ? (
                  <>
                    <p className="mt-1 text-base font-semibold text-gold">
                      {formatShortDate(nextAvailableSlot.date)} • {minutesToTime(nextAvailableSlot.start)}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Slot {nextSlotIndex + 1} din {nextAvailableSlots.length}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="rounded-[8px] border border-line bg-panel px-3 py-2 text-sm font-medium disabled:opacity-40"
                        disabled={nextSlotIndex === 0}
                        onClick={() => setNextSlotIndex((value) => Math.max(0, value - 1))}
                        type="button"
                      >
                        Prev
                      </button>
                      <button
                        className="rounded-[8px] border border-line bg-panel px-3 py-2 text-sm font-medium disabled:opacity-40"
                        disabled={nextSlotIndex >= nextAvailableSlots.length - 1}
                        onClick={() =>
                          setNextSlotIndex((value) =>
                            Math.min(nextAvailableSlots.length - 1, value + 1)
                          )
                        }
                        type="button"
                      >
                        Next
                      </button>
                    </div>
                    <button
                      className="mt-3 rounded-[8px] border border-line bg-panel px-3 py-2 text-sm font-medium"
                      onClick={jumpToNextAvailableSlot}
                      type="button"
                    >
                      Programeaza pe acest slot
                    </button>
                    {nextAvailableSlots.length > 1 ? (
                      <div className="mt-3 space-y-1 text-xs text-muted">
                        {nextAvailableSlots.slice(0, 5).map((slot, index) => (
                          <p key={`${slot.date}-${slot.start}`}>
                            {index + 1}. {formatShortDate(slot.date)} • {minutesToTime(slot.start)}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted">
                    Nu exista slot disponibil in urmatoarele 45 de zile.
                  </p>
                )}
              </div>
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
                  {dayTimeline.segments.length > 0 ? (
                    dayTimeline.segments.map((segment) =>
                      segment.kind === "free" ? (
                        (() => {
                          const targetKey = `home-free-${segment.start}-${segment.end}`;
                          const canMoveHere = canMoveToFreeSegment(movingAppointment, segment.minutes);
                          return (
                            <div
                              key={targetKey}
                              className={`rounded-[8px] border border-[#2a7a58] bg-[#0f2b20] px-3 py-2 ${
                                dragTargetKey === targetKey ? "ring-2 ring-gold" : ""
                              }`}
                              onDragLeave={() => setDragTargetKey("")}
                              onDragOver={(event) =>
                                handleFreeSegmentDragOver(event, targetKey, segment.minutes)
                              }
                              onDrop={(event) => {
                                event.preventDefault();
                                void moveAppointmentToFreeSegment(segment.start, segment.minutes);
                              }}
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
                              {movingAppointment ? (
                                <button
                                  className="mt-2 rounded-[8px] border border-[#57b888] px-3 py-2 text-xs font-semibold text-[#b8ffd9] disabled:opacity-45"
                                  disabled={!canMoveHere}
                                  onClick={() =>
                                    void moveAppointmentToFreeSegment(segment.start, segment.minutes)
                                  }
                                  type="button"
                                >
                                  Muta aici
                                </button>
                              ) : null}
                            </div>
                          );
                        })()
                      ) : (
                        (() => {
                          const serviceColors = serviceColorClasses(segment.appointment.service);
                          const isMoving = movingAppointmentId === segment.appointment.id || draggingAppointmentId === segment.appointment.id;
                          return (
                            <div
                              key={`home-busy-${segment.appointment.id}-${segment.start}`}
                              className={`rounded-[8px] border px-3 py-2 ${serviceColors.border} ${serviceColors.bg} ${
                                isMoving ? "ring-2 ring-gold" : "cursor-grab active:cursor-grabbing"
                              }`}
                              draggable
                              onDragEnd={stopDraggingAppointment}
                              onDragStart={(event) =>
                                startDraggingAppointment(event, segment.appointment)
                              }
                            >
                              <div className="flex items-center justify-between">
                                <p className={`text-sm font-semibold ${serviceColors.name}`}>
                                  {segment.appointment.clientName}
                                </p>
                                <p className={`text-xs ${serviceColors.meta}`}>
                                  {minutesToTime(segment.start)} - {minutesToTime(segment.end)}
                                </p>
                              </div>
                              <p className={`mt-1 text-xs ${serviceColors.meta}`}>
                                {segment.appointment.service} • {segment.appointment.status}
                              </p>
                              <div className="mt-2 flex gap-2">
                                <button
                                  className="rounded-[8px] border border-line bg-white/70 px-3 py-2 text-xs font-semibold text-[#1f1a12]"
                                  onClick={() =>
                                    setMovingAppointmentId(
                                      isMoving ? null : segment.appointment.id
                                    )
                                  }
                                  type="button"
                                >
                                  {isMoving ? "Selectata" : "Muta"}
                                </button>
                                <button
                                  className="rounded-[8px] border border-line bg-white/70 px-3 py-2 text-xs font-semibold text-[#1f1a12]"
                                  onClick={() => startEditAppointment(segment.appointment)}
                                  type="button"
                                >
                                  Editeaza
                                </button>
                              </div>
                            </div>
                          );
                        })()
                      )
                    )
                  ) : (
                    <div className="rounded-[8px] border border-line bg-panel px-3 py-3 text-sm text-muted">
                      {dayTimeline.isDayOff
                        ? "Zi libera sau in afara programului setat."
                        : "Nu exista intervale pentru ziua selectata."}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </>
        ) : null}

        {activeTab === "month" ? (
          <section className="mt-4">
            <div className="mb-3 overflow-hidden rounded-[8px] border border-line bg-[#0b0b0c]">
              <div className="flex items-center justify-between border-b border-[#262626] bg-[#1f2022] px-3 py-3">
                <button
                  className="rounded-[8px] border border-line bg-black px-3 py-2 text-lg font-semibold"
                  onClick={() => setSelectedMonth(monthShift(selectedMonth, -1))}
                  type="button"
                >
                  ‹
                </button>
                <button
                  className="rounded-[8px] px-3 py-2 text-xl font-semibold capitalize"
                  onClick={() => setSelectedMonth(toMonthKey(todayIso()))}
                  type="button"
                >
                  {monthLabel}
                </button>
                <button
                  className="rounded-[8px] border border-line bg-black px-3 py-2 text-lg font-semibold"
                  onClick={() => setSelectedMonth(monthShift(selectedMonth, 1))}
                  type="button"
                >
                  ›
                </button>
              </div>

              <div className="grid grid-cols-7 border-b border-[#1b1b1b] bg-black px-2 py-2">
                {["L", "M", "M", "J", "V", "S", "D"].map((label, idx) => (
                  <p key={`${label}-${idx}`} className="text-center text-xs font-medium text-[#a8a8ad]">
                    {label}
                  </p>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 bg-black p-2">
                {monthGridDays.map((day) => {
                  const bars = Math.min(day.count, 5);
                  return (
                    <button
                      key={day.iso}
                      className={`min-h-[62px] rounded-[4px] px-1 py-2 text-center transition ${
                        day.isSelected
                          ? "bg-[#c8423d] text-white"
                          : day.inCurrentMonth
                            ? "bg-black text-foreground"
                            : "bg-black text-[#454545]"
                      }`}
                      onClick={() => {
                        setAppointmentDate(day.iso);
                        setSelectedMonth(toMonthKey(day.iso));
                      }}
                      type="button"
                    >
                      <p className="text-lg font-semibold leading-none">{day.day}</p>
                      <div className="mt-2 flex justify-center gap-0.5">
                        {Array.from({ length: 5 }, (_, index) => (
                          <span
                            key={`${day.iso}-bar-${index}`}
                            className={`h-1.5 w-1.5 rounded-[2px] ${
                              index < bars
                                ? index === 4 && day.count > 4
                                  ? "bg-[#b477e8]"
                                  : "bg-[#55b6e8]"
                                : day.inCurrentMonth
                                  ? "bg-[#1d1d1d]"
                                  : "bg-[#101010]"
                            }`}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase text-muted">
                  {new Intl.DateTimeFormat("ro-RO", { weekday: "short" }).format(
                    new Date(`${appointmentDate}T12:00:00`)
                  )}
                </p>
                <h2 className="text-lg font-semibold capitalize">{fullDateLabel(appointmentDate)}</h2>
              </div>
              <button
                className="rounded-[8px] bg-gold px-4 py-3 text-xl font-semibold text-black"
                onClick={() => {
                  setActiveTab("appointments");
                  setActivePanel("appointment");
                  setAppointmentDate(appointmentDate);
                  setScrollToEditorTick((value) => value + 1);
                }}
                type="button"
              >
                +
              </button>
            </div>

            {movingAppointmentId && movingAppointment ? (
              <div className="mb-3 rounded-[8px] border border-gold bg-[#211b0d] px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gold">Muti programarea</p>
                    <p className="mt-1 text-sm text-[#ddd4c5]">
                      {movingAppointment.clientName} • {movingAppointment.duration}
                    </p>
                  </div>
                  <button
                    className="rounded-[8px] border border-line bg-black px-3 py-2 text-sm"
                    onClick={() => {
                      setMovingAppointmentId(null);
                      setDraggingAppointmentId(null);
                    }}
                    type="button"
                  >
                    Anuleaza
                  </button>
                </div>
              </div>
            ) : null}

            <div className="overflow-hidden rounded-[8px] border border-[#303136] bg-[#202124]">
              <div className="flex items-center justify-between border-b border-[#34363a] bg-[#2c2d31] px-3 py-3">
                <div>
                  <p className="text-sm font-semibold">
                    {appointmentsForDayAll.length} programari
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#a8a8ad]">
                    Scroll normal. Tine apasat pe card ca sa muti sau pe liber ca sa creezi.
                  </p>
                </div>
                <p className="text-xs text-[#a8a8ad]">
                  Liber {Math.floor(dayTimeline.totalFreeMinutes / 60)}h {dayTimeline.totalFreeMinutes % 60}m
                </p>
              </div>

              <div className="max-h-[68vh] overflow-y-auto">
                <div
                  className="relative"
                  onClick={(event) => void handleCalendarTimelineClick(event)}
                  onDragLeave={() => setDragTargetKey("")}
                  onDragOver={(event) => {
                    if (!movingAppointment) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragTargetKey("calendar-timeline");
                  }}
                  onDrop={(event) => void handleCalendarTimelineDrop(event)}
                  onPointerCancel={cancelCalendarCreateDrag}
                  onPointerDown={startCalendarCreateDrag}
                  onPointerMove={updateCalendarCreateDrag}
                  onPointerUp={finishCalendarCreateDrag}
                  ref={calendarTimelineRef}
                  style={{ height: `${calendarTimeline.height}px` }}
                >
                  {calendarTimeline.quarterMarks.map((minute) => {
                    const top =
                      ((minute - calendarTimeline.rangeStart) / 60) * CALENDAR_HOUR_HEIGHT;
                    const isHalfHour = minute % 60 === 30;
                    return (
                      <div
                        key={`quarter-${minute}`}
                        className={`absolute left-[62px] right-0 ${
                          isHalfHour
                            ? "border-t border-[#34363a]/80"
                            : "border-t border-dashed border-[#2f3135]/70"
                        }`}
                        style={{ top }}
                      />
                    );
                  })}

                  {calendarTimeline.hourMarks.map((minute) => {
                    const top =
                      ((minute - calendarTimeline.rangeStart) / 60) * CALENDAR_HOUR_HEIGHT;
                    return (
                      <div
                        key={`hour-${minute}`}
                        className="absolute inset-x-0 border-t border-[#3a3c40]"
                        style={{ top }}
                      >
                        <span className="absolute -top-3 left-3 bg-[#202124] pr-2 text-xs text-[#a8a8ad]">
                          {minutesToTime(minute)}
                        </span>
                      </div>
                    );
                  })}

                  {dragTargetKey === "calendar-timeline" && movingAppointment ? (
                    <div className="absolute inset-y-0 left-[70px] right-3 rounded-[8px] border border-dashed border-gold/70" />
                  ) : null}

                  <div className="absolute bottom-0 left-[62px] top-0 border-l border-[#3a3c40]" />

                  {calendarCreateDrag?.active
                    ? (() => {
                        const endMinutes = getTimelineMinuteFromClientY(
                          calendarCreateDrag.currentY
                        );
                        let startMinutes = Math.min(
                          calendarCreateDrag.startMinutes,
                          endMinutes
                        );
                        let finishMinutes = Math.max(
                          calendarCreateDrag.startMinutes,
                          endMinutes
                        );
                        if (finishMinutes - startMinutes < 30) {
                          if (endMinutes >= calendarCreateDrag.startMinutes) {
                            finishMinutes = Math.min(
                              calendarTimeline.rangeEnd,
                              startMinutes + 30
                            );
                          } else {
                            startMinutes = Math.max(
                              calendarTimeline.rangeStart,
                              finishMinutes - 30
                            );
                          }
                        }
                        const top =
                          ((startMinutes - calendarTimeline.rangeStart) / 60) *
                          CALENDAR_HOUR_HEIGHT;
                        const height = Math.max(
                          36,
                          ((finishMinutes - startMinutes) / 60) * CALENDAR_HOUR_HEIGHT - 4
                        );
                        return (
                          <div
                            className="pointer-events-none absolute left-[76px] right-3 z-10 overflow-hidden rounded-[8px] border border-dashed border-gold bg-gold/20 px-3 py-2 text-sm text-gold shadow-sm"
                            style={{ top: `${top}px`, height: `${height}px` }}
                          >
                            <p className="font-semibold">Programare noua</p>
                            <p className="mt-0.5 text-xs">
                              {minutesToTime(startMinutes)} - {minutesToTime(finishMinutes)}
                            </p>
                          </div>
                        );
                      })()
                    : null}

                  {calendarTimeline.appointments.map((appointment) => {
                    const serviceColors = serviceColorClasses(appointment.service);
                    const start = timeToMinutes(appointment.start);
                    const end = start + parseDurationToMinutes(appointment.duration);
                    const previewStart =
                      calendarPointerDrag?.appointmentId === appointment.id &&
                      calendarPointerDrag.active
                        ? timeToMinutes(
                            getTimelineStartFromClientY(
                              calendarPointerDrag.currentY,
                              appointment,
                              calendarPointerDrag.grabOffsetY
                            )
                          )
                        : start;
                    const top =
                      ((previewStart - calendarTimeline.rangeStart) / 60) * CALENDAR_HOUR_HEIGHT;
                    const height = Math.max(
                      38,
                      ((end - start) / 60) * CALENDAR_HOUR_HEIGHT - 4
                    );
                    const isMoving =
                      movingAppointmentId === appointment.id ||
                      draggingAppointmentId === appointment.id ||
                      (calendarPointerDrag?.appointmentId === appointment.id &&
                        calendarPointerDrag.active);
                    return (
                      <div
                        key={`calendar-block-${appointment.id}`}
                        data-calendar-appointment
                        className={`absolute left-[76px] right-3 select-none overflow-hidden rounded-[8px] border px-3 py-2 shadow-sm ${serviceColors.border} ${serviceColors.bg} ${
                          isMoving ? "z-20 ring-2 ring-gold" : "cursor-grab active:cursor-grabbing"
                        }`}
                        draggable={false}
                        onClick={(event) => event.stopPropagation()}
                        onPointerCancel={cancelCalendarPointerDrag}
                        onPointerDown={(event) => startCalendarPointerDrag(event, appointment)}
                        onPointerMove={(event) => updateCalendarPointerDrag(event, appointment)}
                        onPointerUp={(event) => void finishCalendarPointerDrag(event, appointment)}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          touchAction: isMoving ? "none" : "pan-y",
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className={`truncate text-sm font-semibold ${serviceColors.name}`}>
                              {appointment.clientName}
                            </p>
                            <p className={`mt-0.5 truncate text-xs ${serviceColors.meta}`}>
                              {appointment.service}
                            </p>
                          </div>
                          <p className={`shrink-0 text-xs ${serviceColors.meta}`}>
                            {minutesToTime(previewStart)}
                          </p>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            className="rounded-[8px] border border-[#7a3131] bg-[#3a1515] px-2 py-1 text-xs font-semibold text-[#ffd1d1]"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteAppointment(appointment.id);
                            }}
                            type="button"
                          >
                            Sterge
                          </button>
                          <button
                            className="rounded-[8px] border border-line bg-white/70 px-2 py-1 text-xs font-semibold text-[#1f1a12]"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveTab("appointments");
                              startEditAppointment(appointment);
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {calendarTimeline.appointments.length === 0 ? (
                    <div className="absolute left-[76px] right-3 top-8 rounded-[8px] border border-line bg-[#18191b] px-3 py-3 text-sm text-muted">
                      Zi libera.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
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
                  className="gold-ring rounded-[8px] border border-[#3f3522] bg-[#181511] px-4 py-4"
                  ref={appointmentFormCardRef}
                >
                  <div className="grid gap-4">
                    <div className="border-b border-[#342d22] pb-3">
                      <p className="text-sm font-semibold">
                        {editingAppointmentId ? "Actualizeaza detaliile" : "Completeaza programarea"}
                      </p>
                      <p className="mt-1 text-xs text-[#bdb3a5]">
                        Alege clienta, serviciul si ora. Durata si pretul se completeaza automat din serviciu.
                      </p>
                    </div>

                    <label className="grid min-w-0 gap-2 text-sm">
                      <span className="text-muted">Clienta</span>
                      <input
                        className="w-full max-w-full rounded-[8px] border border-[#3f3522] bg-black/90 px-3 py-3 outline-none focus:border-gold"
                        onChange={(event) => setAppointmentClientFilter(event.target.value)}
                        placeholder="Cauta dupa nume sau telefon"
                        value={appointmentClientFilter}
                      />
                      <select
                        className="w-full max-w-full rounded-[8px] border border-[#3f3522] bg-black/90 px-3 py-3 outline-none focus:border-gold"
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

                    <div className="rounded-[8px] border border-[#3f3522] bg-black/55 px-3 py-3 text-sm">
                      <p className="text-xs uppercase text-muted">Clienta selectata</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{selectedClient?.name ?? "Nicio clienta"}</p>
                        <p className="rounded-[8px] bg-[#241d12] px-2 py-1 text-xs text-gold">
                          {selectedClient?.phone || "fara telefon"}
                        </p>
                      </div>
                    </div>

                    <label className="grid min-w-0 gap-2 text-sm">
                      <span className="text-muted">Serviciu</span>
                      <select
                        className="w-full max-w-full rounded-[8px] border border-[#3f3522] bg-black/90 px-3 py-3 outline-none focus:border-gold"
                        onChange={(event) => handleServiceSelection(Number(event.target.value))}
                        value={selectedServiceId}
                      >
                        {activeServices.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-[#bdb3a5]">
                        {selectedServiceForForm
                          ? `${selectedServiceForForm.duration} • ${formatPrice(selectedServiceForForm.price)}`
                          : "Alege un serviciu activ"}
                      </p>
                    </label>

                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                      <label className="grid min-w-0 gap-2 text-sm">
                        <span className="text-muted">Data</span>
                        <input
                          className="w-full max-w-full rounded-[8px] border border-[#3f3522] bg-black/90 px-3 py-3 outline-none focus:border-gold"
                          onChange={(event) => setAppointmentDate(event.target.value)}
                          type="date"
                          value={appointmentDate}
                        />
                      </label>
                      <label className="grid min-w-0 gap-2 text-sm">
                        <span className="text-muted">Ora</span>
                        <input
                          className="w-full max-w-full rounded-[8px] border border-[#3f3522] bg-black/90 px-3 py-3 outline-none focus:border-gold"
                          onChange={(event) => setAppointmentTime(event.target.value)}
                          type="time"
                          value={appointmentTime}
                        />
                      </label>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {QUICK_APPOINTMENT_TIMES.map((time) => (
                        <button
                          className={`shrink-0 rounded-[8px] border px-3 py-2 text-xs font-semibold ${
                            appointmentTime === time
                              ? "border-gold bg-gold text-black"
                              : "border-[#3f3522] bg-black/70 text-[#ddd4c5]"
                          }`}
                          key={time}
                          onClick={() => setAppointmentTime(time)}
                          type="button"
                        >
                          {time}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                      <label className="grid min-w-0 gap-2 text-sm">
                        <span className="text-muted">Durata</span>
                        <input
                          className="w-full max-w-full rounded-[8px] border border-[#3f3522] bg-black/90 px-3 py-3 outline-none focus:border-gold"
                          onChange={(event) => setAppointmentDuration(event.target.value)}
                          value={appointmentDuration}
                        />
                      </label>
                      <label className="grid min-w-0 gap-2 text-sm">
                        <span className="text-muted">Pret</span>
                        <input
                          className="w-full max-w-full rounded-[8px] border border-[#3f3522] bg-black/90 px-3 py-3 outline-none focus:border-gold"
                          min="0"
                          onChange={(event) =>
                            setAppointmentPrice(Number(event.target.value) || 0)
                          }
                          type="number"
                          value={appointmentPrice}
                        />
                      </label>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {QUICK_DURATIONS.map((duration) => (
                        <button
                          className={`shrink-0 rounded-[8px] border px-3 py-2 text-xs font-semibold ${
                            appointmentDuration === duration
                              ? "border-gold bg-gold text-black"
                              : "border-[#3f3522] bg-black/70 text-[#ddd4c5]"
                          }`}
                          key={duration}
                          onClick={() => setAppointmentDuration(duration)}
                          type="button"
                        >
                          {duration}
                        </button>
                      ))}
                    </div>

                    <label className="grid min-w-0 gap-2 text-sm">
                      <span className="text-muted">Status</span>
                      <select
                        className="w-full max-w-full rounded-[8px] border border-[#3f3522] bg-black/90 px-3 py-3 outline-none focus:border-gold"
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
                        className="min-h-[88px] w-full max-w-full rounded-[8px] border border-[#3f3522] bg-black/90 px-3 py-3 outline-none focus:border-gold"
                        onChange={(event) => setAppointmentNotes(event.target.value)}
                        placeholder="Detalii, preferinte, reminder..."
                        value={appointmentNotes}
                      />
                    </label>

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
                {["toate", "neconfirmate", "Noua", "Confirmata", "Reminder maine", "Finalizata", "Anulata"].map(
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
                      {status === "toate"
                        ? "Toate"
                        : status === "neconfirmate"
                          ? "Neconfirmate"
                          : status}
                    </button>
                  )
                )}
              </div>

              <label className="mb-3 grid gap-2 text-sm">
                <span className="text-muted">Cauta in programarile zilei</span>
                <input
                  className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                  onChange={(event) => setAppointmentSearch(event.target.value)}
                  placeholder="Nume, serviciu sau telefon"
                  value={appointmentSearch}
                />
              </label>

              <div className="gold-ring mb-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Calendarul zilei</h3>
                  <span className="text-xs text-muted">
                    Liber {Math.floor(dayTimeline.totalFreeMinutes / 60)}h{" "}
                    {dayTimeline.totalFreeMinutes % 60}m
                  </span>
                </div>
                <div className="space-y-2">
                  {dayTimeline.segments.length > 0 ? (
                    dayTimeline.segments.map((segment) =>
                      segment.kind === "free" ? (
                        (() => {
                          const targetKey = `free-${segment.start}-${segment.end}`;
                          const canMoveHere = canMoveToFreeSegment(movingAppointment, segment.minutes);
                          return (
                            <div
                              key={targetKey}
                              className={`rounded-[8px] border border-[#2a7a58] bg-[#0f2b20] px-3 py-2 ${
                                dragTargetKey === targetKey ? "ring-2 ring-gold" : ""
                              }`}
                              onDragLeave={() => setDragTargetKey("")}
                              onDragOver={(event) =>
                                handleFreeSegmentDragOver(event, targetKey, segment.minutes)
                              }
                              onDrop={(event) => {
                                event.preventDefault();
                                void moveAppointmentToFreeSegment(segment.start, segment.minutes);
                              }}
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
                              {movingAppointment ? (
                                <button
                                  className="mt-2 rounded-[8px] border border-[#57b888] px-3 py-2 text-xs font-semibold text-[#b8ffd9] disabled:opacity-45"
                                  disabled={!canMoveHere}
                                  onClick={() =>
                                    void moveAppointmentToFreeSegment(segment.start, segment.minutes)
                                  }
                                  type="button"
                                >
                                  Muta aici
                                </button>
                              ) : null}
                            </div>
                          );
                        })()
                      ) : (
                        (() => {
                          const serviceColors = serviceColorClasses(segment.appointment.service);
                          const isMoving = movingAppointmentId === segment.appointment.id || draggingAppointmentId === segment.appointment.id;
                          return (
                            <div
                              key={`busy-${segment.appointment.id}-${segment.start}`}
                              className={`rounded-[8px] border px-3 py-2 ${serviceColors.border} ${serviceColors.bg} ${
                                isMoving ? "ring-2 ring-gold" : "cursor-grab active:cursor-grabbing"
                              }`}
                              draggable
                              onDragEnd={stopDraggingAppointment}
                              onDragStart={(event) =>
                                startDraggingAppointment(event, segment.appointment)
                              }
                            >
                              <div className="flex items-center justify-between">
                                <p className={`text-sm font-semibold ${serviceColors.name}`}>
                                  {segment.appointment.clientName}
                                </p>
                                <p className={`text-xs ${serviceColors.meta}`}>
                                  {minutesToTime(segment.start)} - {minutesToTime(segment.end)}
                                </p>
                              </div>
                              <p className={`mt-1 text-xs ${serviceColors.meta}`}>
                                {segment.appointment.service} • {segment.appointment.status}
                              </p>
                              <div className="mt-2 flex gap-2">
                                <button
                                  className="rounded-[8px] border border-line bg-white/70 px-3 py-2 text-xs font-semibold text-[#1f1a12]"
                                  onClick={() =>
                                    setMovingAppointmentId(
                                      isMoving ? null : segment.appointment.id
                                    )
                                  }
                                  type="button"
                                >
                                  {isMoving ? "Selectata" : "Muta"}
                                </button>
                                <button
                                  className="rounded-[8px] border border-line bg-white/70 px-3 py-2 text-xs font-semibold text-[#1f1a12]"
                                  onClick={() => startEditAppointment(segment.appointment)}
                                  type="button"
                                >
                                  Editeaza
                                </button>
                              </div>
                            </div>
                          );
                        })()
                      )
                    )
                  ) : (
                    <div className="rounded-[8px] border border-line bg-panel px-3 py-3 text-sm text-muted">
                      {dayTimeline.isDayOff
                        ? "Zi libera sau in afara programului setat."
                        : "Nu exista intervale pentru ziua selectata."}
                    </div>
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
                        {statusShortLabel(appointment.status)}
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

                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <button
                        className="rounded-[8px] border border-line bg-panel px-3 py-2 text-xs font-medium"
                        onClick={() => void handleUpdateStatus(appointment.id, "Finalizata")}
                        type="button"
                      >
                        Finalizeaza
                      </button>
                      <button
                        className="rounded-[8px] border border-line bg-panel px-3 py-2 text-xs font-medium"
                        onClick={() => void handleShiftAppointmentMinutes(appointment, 15)}
                        type="button"
                      >
                        +15 min
                      </button>
                      <button
                        className="rounded-[8px] border border-line bg-panel px-3 py-2 text-xs font-medium"
                        onClick={() => void handleShiftAppointmentMinutes(appointment, -15)}
                        type="button"
                      >
                        -15 min
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

        {activeTab === "reports" ? (
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Rapoarte</h2>
              <span className="text-sm text-muted">Lunar</span>
            </div>

            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {reportYearOptions.map((year) => (
                <button
                  key={year}
                  className={`rounded-[8px] border px-3 py-2 text-sm whitespace-nowrap ${
                    reportYear === year
                      ? "border-gold bg-gold text-black"
                      : "border-line bg-panel text-muted"
                  }`}
                  onClick={() => setReportMonth(`${year}-${reportMonth.slice(5, 7)}`)}
                  type="button"
                >
                  {year}
                </button>
              ))}
            </div>

            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {reportMonthOptions.map((monthKey) => (
                <button
                  key={monthKey}
                  className={`rounded-[8px] border px-3 py-2 text-sm whitespace-nowrap ${
                    reportMonth === monthKey
                      ? "border-gold bg-gold text-black"
                      : "border-line bg-panel text-muted"
                  }`}
                  onClick={() => setReportMonth(monthKey)}
                  type="button"
                >
                  {new Intl.DateTimeFormat("ro-RO", {
                    month: "short",
                    year: "2-digit",
                  }).format(new Date(`${monthKey}-01T12:00:00`))}
                </button>
              ))}
            </div>

            <div className="mb-3 rounded-[8px] border border-line bg-panel-soft px-4 py-3">
              <p className="text-xs text-muted">Luna selectata</p>
              <p className="mt-1 text-sm capitalize text-foreground">{reportMonthLabel}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                <p className="text-xs text-muted">Venit luna</p>
                <p className="mt-1 text-xl font-semibold text-gold">{formatPrice(reportData.totalRevenue)}</p>
              </div>
              <div className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                <p className="text-xs text-muted">Programari luna</p>
                <p className="mt-1 text-xl font-semibold">{reportData.monthAppointments.length}</p>
              </div>
              <div className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                <p className="text-xs text-muted">Cliente active luna</p>
                <p className="mt-1 text-xl font-semibold">{reportData.uniqueClients}</p>
              </div>
              <div className="gold-ring rounded-[8px] border border-line bg-panel-soft px-4 py-4">
                <p className="text-xs text-muted">Bon mediu luna</p>
                <p className="mt-1 text-xl font-semibold">{formatPrice(reportData.avgTicket)}</p>
              </div>
            </div>

            <div className="gold-ring mt-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <p className="text-sm font-semibold">Status programari (luna)</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {["Noua", "Confirmata", "Reminder maine", "Finalizata", "Anulata"].map((status) => (
                  <div key={status} className="rounded-[8px] border border-line bg-black/70 px-3 py-2">
                    <p className="text-xs text-muted">{status}</p>
                    <p className="mt-1 font-semibold">{reportData.statusMap.get(status) ?? 0}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="gold-ring mt-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <p className="text-sm font-semibold">Top servicii (luna)</p>
              {reportData.topServices.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {reportData.topServices.map((service) => {
                    const max = reportData.topServices[0]?.count ?? 1;
                    const width = Math.max(8, Math.round((service.count / max) * 100));
                    return (
                      <div key={service.name} className="rounded-[8px] border border-line bg-black/70 px-3 py-2">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <p className="font-medium">{service.name}</p>
                          <p className="text-muted">{service.count} sedinte</p>
                        </div>
                        <div className="mt-2 h-2 rounded-[4px] bg-[#232323]">
                          <div className="h-2 rounded-[4px] bg-gold" style={{ width: `${width}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-muted">Venit {formatPrice(service.revenue)}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">Nu exista date pentru luna selectata.</p>
              )}
            </div>

            <div className="gold-ring mt-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <p className="text-sm font-semibold">Top cliente (luna)</p>
              {reportData.topClients.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {reportData.topClients.map((client) => (
                    <div key={`${client.name}-${client.count}`} className="rounded-[8px] border border-line bg-black/70 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">{client.name}</p>
                        <p className="text-sm text-muted">{client.count} vizite</p>
                      </div>
                      <p className="mt-1 text-xs text-muted">Valoare: {formatPrice(client.revenue)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">Nu exista cliente active in luna selectata.</p>
              )}
            </div>

            <div className="gold-ring mt-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <p className="text-sm font-semibold">Zile aglomerate</p>
              {reportData.busiestDays.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {reportData.busiestDays.map((day) => (
                    <div key={day.date} className="rounded-[8px] border border-line bg-black/70 px-3 py-2">
                      <p className="text-sm">{formatShortDate(day.date)}</p>
                      <p className="text-xs text-muted">{day.count} programari</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">Nu exista zile aglomerate in aceasta luna.</p>
              )}
            </div>

            <div className="gold-ring mt-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <p className="text-sm font-semibold">Distribuire pe ore</p>
              <div className="mt-3 space-y-2">
                {reportData.hourlyLoad.map((slot) => {
                  const max = Math.max(1, ...reportData.hourlyLoad.map((item) => item.count));
                  const width = slot.count === 0 ? 6 : Math.max(8, Math.round((slot.count / max) * 100));
                  return (
                    <div key={slot.label} className="grid grid-cols-[52px_1fr_38px] items-center gap-2">
                      <p className="text-xs text-muted">{slot.label}</p>
                      <div className="h-2 rounded-[4px] bg-[#232323]">
                        <div className="h-2 rounded-[4px] bg-[#d4b578]" style={{ width: `${width}%` }} />
                      </div>
                      <p className="text-right text-xs text-muted">{slot.count}</p>
                    </div>
                  );
                })}
              </div>
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
              <p className="text-sm font-semibold">Export date (Excel)</p>
              <p className="mt-2 text-sm text-[#ddd4c5]">
                Descarca un fisier Excel cu sheet-uri separate pentru cliente, programari si servicii.
              </p>
              <button
                className="mt-3 w-full rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                disabled={isExportingCsv}
                onClick={() => void handleExportCsv()}
                type="button"
              >
                {isExportingCsv ? "Se exporta..." : "Exporta Excel (3 sheet-uri)"}
              </button>
            </div>

            <div className="gold-ring mb-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <p className="text-sm font-semibold">Backup cloud automat</p>
              <p className="mt-2 text-sm text-[#ddd4c5]">
                Se face zilnic automat in cloud si poti porni manual backup oricand.
              </p>
              <button
                className="mt-3 w-full rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                disabled={isRunningCloudBackup || !session}
                onClick={() => void handleRunCloudBackup()}
                type="button"
              >
                {isRunningCloudBackup ? "Se urca backup-ul..." : "Ruleaza backup cloud acum"}
              </button>
              {lastBackupPath ? (
                <p className="mt-2 text-xs text-muted">Ultimul backup: {lastBackupPath}</p>
              ) : null}
            </div>

            <div className="gold-ring mb-4 rounded-[8px] border border-line bg-[#181511] px-4 py-4">
              <p className="text-sm font-semibold">Blocaje personale</p>
              <p className="mt-2 text-sm text-[#ddd4c5]">
                Pentru Eu gene, Eu par, Eu unghii sau alte lucruri personale. Ocupa loc in calendar, dar nu pune venit.
              </p>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {PERSONAL_BLOCK_PRESETS.map((preset) => (
                  <button
                    className={`shrink-0 rounded-[8px] border px-3 py-2 text-xs font-semibold ${
                      personalBlockTitle === preset
                        ? "border-gold bg-gold text-black"
                        : "border-[#3f3522] bg-black/70 text-[#ddd4c5]"
                    }`}
                    key={preset}
                    onClick={() => setPersonalBlockTitle(preset)}
                    type="button"
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-3">
                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Nume blocaj</span>
                  <input
                    className="w-full rounded-[8px] border border-[#3f3522] bg-black px-3 py-3 outline-none focus:border-gold"
                    onChange={(event) => setPersonalBlockTitle(event.target.value)}
                    placeholder="Eu gene"
                    value={personalBlockTitle}
                  />
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                  <label className="grid min-w-0 gap-2 text-sm">
                    <span className="text-muted">Data</span>
                    <input
                      className="w-full rounded-[8px] border border-[#3f3522] bg-black px-3 py-3 outline-none focus:border-gold"
                      onChange={(event) => setPersonalBlockDate(event.target.value)}
                      type="date"
                      value={personalBlockDate}
                    />
                  </label>
                  <label className="grid min-w-0 gap-2 text-sm">
                    <span className="text-muted">Ora</span>
                    <input
                      className="w-full rounded-[8px] border border-[#3f3522] bg-black px-3 py-3 outline-none focus:border-gold"
                      onChange={(event) => setPersonalBlockTime(event.target.value)}
                      type="time"
                      value={personalBlockTime}
                    />
                  </label>
                </div>
                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Durata</span>
                  <input
                    className="w-full rounded-[8px] border border-[#3f3522] bg-black px-3 py-3 outline-none focus:border-gold"
                    onChange={(event) => setPersonalBlockDuration(event.target.value)}
                    placeholder="1h30min"
                    value={personalBlockDuration}
                  />
                </label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {QUICK_DURATIONS.map((duration) => (
                    <button
                      className={`shrink-0 rounded-[8px] border px-3 py-2 text-xs font-semibold ${
                        personalBlockDuration === duration
                          ? "border-gold bg-gold text-black"
                          : "border-[#3f3522] bg-black/70 text-[#ddd4c5]"
                      }`}
                      key={`personal-${duration}`}
                      onClick={() => setPersonalBlockDuration(duration)}
                      type="button"
                    >
                      {duration}
                    </button>
                  ))}
                </div>
                <button
                  className="rounded-[8px] bg-gold px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
                  disabled={isSavingPersonalBlock}
                  onClick={() => void handleSavePersonalBlock()}
                  type="button"
                >
                  {isSavingPersonalBlock ? "Se salveaza..." : "Adauga blocaj in calendar"}
                </button>
              </div>

              {personalBlocks.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs uppercase text-muted">Blocaje existente</p>
                  {personalBlocks.slice(-6).reverse().map((block) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-[8px] border border-[#3f3522] bg-black/60 px-3 py-2"
                      key={block.id}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{block.clientName}</p>
                        <p className="mt-1 text-xs text-muted">
                          {formatShortDate(block.date)} • {block.start} • {block.duration}
                        </p>
                      </div>
                      <button
                        className="shrink-0 rounded-[8px] border border-[#7a3131] bg-[#3a1515] px-3 py-2 text-xs font-semibold text-[#ffd1d1]"
                        onClick={() => void handleDeleteAppointment(block.id)}
                        type="button"
                      >
                        Sterge
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="gold-ring mb-4 rounded-[8px] border border-line bg-panel-soft px-4 py-4">
              <p className="text-sm font-semibold">Mesaj WhatsApp</p>
              <p className="mt-2 text-sm text-[#ddd4c5]">
                Textul folosit la butonul Confirma pe WhatsApp.
              </p>
              <textarea
                className="mt-3 min-h-[132px] w-full rounded-[8px] border border-line bg-black px-3 py-3 text-sm outline-none focus:border-gold"
                onChange={(event) => setWhatsappTemplate(event.target.value)}
                value={whatsappTemplate}
              />
              <p className="mt-2 text-xs text-muted">
                Variabile: {"{clienta}"}, {"{data}"}, {"{data_scurta}"}, {"{ora}"}, {"{serviciu}"}, {"{durata}"}, {"{pret}"}.
              </p>
              <button
                className="mt-3 rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-medium"
                onClick={() => setWhatsappTemplate(DEFAULT_WHATSAPP_TEMPLATE)}
                type="button"
              >
                Reseteaza mesajul
              </button>
            </div>

            <div className="gold-ring mb-4 rounded-[8px] border border-line bg-[#181511] px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Program business</p>
                  <p className="mt-2 text-sm text-[#ddd4c5]">
                    Pauzele sunt oprite implicit. Bifeaza pauza doar in zilele in care vrei sa blocheze calendarul.
                  </p>
                </div>
                <span className="shrink-0 rounded-[8px] border border-[#3f3522] bg-black px-2 py-1 text-[11px] font-semibold text-gold">
                  15 min
                </span>
              </div>

              <div className="mt-4 grid gap-3">
                {WEEK_DAYS.map((day) => {
                  const settings = businessSettings.schedule[day.key];
                  const isDisabled = !settings.enabled;
                  return (
                    <div
                      key={day.key}
                      className={`rounded-[8px] border px-3 py-3 ${
                        isDisabled
                          ? "border-[#292929] bg-[#111]"
                          : "border-[#3f3522] bg-[#201c17]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{day.label}</p>
                          <p className="mt-1 text-xs text-muted">
                            {settings.enabled
                              ? `${settings.start} - ${settings.end}`
                              : "Zi inchisa"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <label className={`flex items-center gap-2 rounded-[8px] border px-2 py-1.5 text-xs font-semibold ${
                            settings.enabled
                              ? "border-gold bg-gold text-black"
                              : "border-line bg-black text-muted"
                          }`}>
                            <input
                              className="accent-[#e0bf68]"
                              checked={settings.enabled}
                              onChange={(event) =>
                                updateBusinessDay(day.key, { enabled: event.target.checked })
                              }
                              type="checkbox"
                            />
                            Activ
                          </label>
                          <label className={`flex items-center gap-2 rounded-[8px] border px-2 py-1.5 text-xs font-semibold ${
                            settings.hasBreak && settings.enabled
                              ? "border-[#8f6b2f] bg-[#2a2113] text-gold"
                              : "border-line bg-black text-muted"
                          }`}>
                            <input
                              className="accent-[#e0bf68]"
                              checked={settings.hasBreak}
                              disabled={!settings.enabled}
                              onChange={(event) =>
                                updateBusinessDay(day.key, { hasBreak: event.target.checked })
                              }
                              type="checkbox"
                            />
                            Pauza
                          </label>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="grid min-w-0 gap-1 text-xs text-muted">
                          <span>Start</span>
                          <input
                            className="min-w-0 w-full max-w-full rounded-[8px] border border-line bg-black px-2 py-2 text-sm text-white outline-none disabled:opacity-40"
                            disabled={!settings.enabled}
                            onChange={(event) =>
                              updateBusinessDay(day.key, { start: event.target.value })
                            }
                            type="time"
                            value={settings.start}
                          />
                        </label>
                        <label className="grid min-w-0 gap-1 text-xs text-muted">
                          <span>Final</span>
                          <input
                            className="min-w-0 w-full max-w-full rounded-[8px] border border-line bg-black px-2 py-2 text-sm text-white outline-none disabled:opacity-40"
                            disabled={!settings.enabled}
                            onChange={(event) =>
                              updateBusinessDay(day.key, { end: event.target.value })
                            }
                            type="time"
                            value={settings.end}
                          />
                        </label>
                        {settings.hasBreak ? (
                          <>
                            <label className="grid min-w-0 gap-1 text-xs text-muted">
                              <span>Pauza start</span>
                              <input
                                className="min-w-0 w-full max-w-full rounded-[8px] border border-line bg-black px-2 py-2 text-sm text-white outline-none disabled:opacity-40"
                                disabled={!settings.enabled}
                                onChange={(event) =>
                                  updateBusinessDay(day.key, { breakStart: event.target.value })
                                }
                                type="time"
                                value={settings.breakStart}
                              />
                            </label>
                            <label className="grid min-w-0 gap-1 text-xs text-muted">
                              <span>Pauza final</span>
                              <input
                                className="min-w-0 w-full max-w-full rounded-[8px] border border-line bg-black px-2 py-2 text-sm text-white outline-none disabled:opacity-40"
                                disabled={!settings.enabled}
                                onChange={(event) =>
                                  updateBusinessDay(day.key, { breakEnd: event.target.value })
                                }
                                type="time"
                                value={settings.breakEnd}
                              />
                            </label>
                          </>
                        ) : (
                          <p className="col-span-2 rounded-[8px] border border-dashed border-[#34302a] bg-black/40 px-3 py-2 text-xs text-[#a89f91]">
                            Fara pauza. Mutarea programarilor foloseste tot intervalul zilei.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 grid gap-2 rounded-[8px] border border-[#3f3522] bg-black/50 p-3">
                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Zile libere (YYYY-MM-DD, separate prin virgula)</span>
                  <input
                    className="rounded-[8px] border border-line bg-black px-3 py-3 outline-none"
                    onChange={(event) => setDaysOffInput(event.target.value)}
                    placeholder="2026-08-15, 2026-12-25"
                    value={daysOffInput}
                  />
                </label>
                <button
                  className="rounded-[8px] border border-line bg-panel px-4 py-3 text-sm font-medium"
                  onClick={applyDaysOffInput}
                  type="button"
                >
                  Salveaza zile libere
                </button>
              </div>
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

        <nav className="gold-ring fixed inset-x-4 bottom-4 mx-auto grid w-full max-w-md grid-cols-6 items-center gap-1 rounded-[8px] border border-line bg-black/95 px-2 py-2 backdrop-blur">
          {[
            {
              label: "Acasa",
              short: "Home",
              key: "home" as const,
              icon: [
                "M3 10.5 12 3l9 7.5",
                "M6 9.5V20h12V9.5",
                "M10 20v-5h4v5",
              ],
            },
            {
              label: "Luna",
              short: "Luna",
              key: "month" as const,
              icon: [
                "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z",
                "M8 3v4",
                "M16 3v4",
                "M4 10h16",
              ],
            },
            {
              label: "Programari",
              short: "Prog",
              key: "appointments" as const,
              icon: [
                "M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 17 20.5H7A1.5 1.5 0 0 1 5.5 19V6A1.5 1.5 0 0 1 7 4.5Z",
                "M9 9h6",
                "M9 12.5h6",
                "M9 16h4",
              ],
            },
            {
              label: "Cliente",
              short: "Cliente",
              key: "clients" as const,
              icon: [
                "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
                "M4 20a8 8 0 0 1 16 0",
              ],
            },
            {
              label: "Rapoarte",
              short: "Rap",
              key: "reports" as const,
              icon: [
                "M4 20h16",
                "M7 20v-7",
                "M12 20V9",
                "M17 20v-4",
              ],
            },
            {
              label: "Setari",
              short: "Setari",
              key: "settings" as const,
              icon: [
                "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
                "M19 12l-1.4.4a5.9 5.9 0 0 1-.3.8l.8 1.2-1.5 1.5-1.2-.8a5.9 5.9 0 0 1-.8.3L14.2 19h-2.4l-.4-1.4a5.9 5.9 0 0 1-.8-.3l-1.2.8-1.5-1.5.8-1.2a5.9 5.9 0 0 1-.3-.8L5 14.2v-2.4l1.4-.4a5.9 5.9 0 0 1 .3-.8l-.8-1.2L7.4 7.9l1.2.8a5.9 5.9 0 0 1 .8-.3L9.8 7h2.4l.4 1.4a5.9 5.9 0 0 1 .8.3l1.2-.8 1.5 1.5-.8 1.2a5.9 5.9 0 0 1 .3.8l1.4.4v2.4Z",
              ],
            },
          ].map(({ label, short, key, icon }) => (
            <button
              key={label}
              className={`min-w-0 overflow-hidden rounded-[8px] px-0.5 py-1 text-center text-[9px] font-medium leading-3 whitespace-nowrap sm:px-1 sm:py-2 sm:text-[10px] ${
                activeTab === key ? "bg-gold text-black" : "text-muted"
              }`}
              onClick={() => setActiveTab(key)}
              type="button"
            >
              <span className="mx-auto mb-1.5 block h-4 w-4">
                <svg
                  className="h-full w-full"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                >
                  {icon.map((path: string) => (
                    <path d={path} key={path} />
                  ))}
                </svg>
              </span>
              <span className="block">{short}</span>
            </button>
          ))}
        </nav>
      </div>
    </main>
  );
}
