"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Appointment } from "@/lib/types";

export function StudioBrand() {
  return (
    <div className="studio-brand" aria-label="SoLash, beauty studio">
      <span className="studio-brand-symbol" aria-hidden="true">
        <svg
          viewBox="0 0 64 48"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 19c11 15 35 15 46 0" strokeWidth="3.2" />
          <path d="m12 23-5 6m12-1-4 8m11-6-1 9m10-9 1 9m7-11 4 8m4-13 6 6" />
          <path
            d="m47 7 1.5 3.5L52 12l-3.5 1.5L47 17l-1.5-3.5L42 12l3.5-1.5Z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      </span>
      <div>
        <p className="studio-brand-name">
          So<span>Lash</span>
          <span className="studio-brand-dot">.</span>
        </p>
        <p className="studio-brand-caption">LASH & BEAUTY STUDIO</p>
      </div>
    </div>
  );
}

export function SettingsGroup({
  title,
  description,
  children,
  legacy,
  forceOpen = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  legacy: boolean;
  forceOpen?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (forceOpen && ref.current) ref.current.open = true;
  }, [forceOpen]);
  if (legacy) return <>{children}</>;
  return (
    <details className="studio-settings-group" ref={ref}>
      <summary>
        <span className="settings-symbol" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 7h16M4 17h16" />
            <circle cx="9" cy="7" r="3" fill="var(--panel)" />
            <circle cx="15" cy="17" r="3" fill="var(--panel)" />
          </svg>
        </span>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <span className="settings-chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="settings-group-content">{children}</div>
    </details>
  );
}

export function StudioEmptyState({
  title,
  children,
  action,
  onAction,
}: {
  title: string;
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="studio-empty">
      <span className="empty-orbit" aria-hidden="true">
        ✧
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action && onAction ? (
        <button className="studio-secondary" type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}

export function StudioDashboard({
  date,
  count,
  freeMinutes,
  revenue,
  next,
  onPrevious,
  onNext,
  onDate,
  onToday,
  onCreate,
  onClients,
  onEditNext,
}: {
  date: string;
  count: number;
  freeMinutes: number;
  revenue: string;
  next: Appointment | null;
  onPrevious: () => void;
  onNext: () => void;
  onDate: () => void;
  onToday: () => void;
  onCreate: () => void;
  onClients: () => void;
  onEditNext: () => void;
}) {
  const selected = new Date(`${date}T12:00:00`);
  return (
    <header className="studio-dashboard" data-ui="dashboard">
      <div className="studio-topline">
        <StudioBrand />
        <button className="studio-today" type="button" onClick={onToday}>
          Astăzi <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="studio-greeting">
        <p className="studio-eyebrow">UN PIC DE FRUMUSEȚE. ÎN FIECARE ZI.</p>
        <h1>
          O zi frumoasă
          <br />
          începe cu ordine<span>.</span>
        </h1>
      </div>
      <div className="studio-date-strip">
        <button aria-label="Ziua precedenta" type="button" onClick={onPrevious}>
          ‹
        </button>
        <button aria-label="Alege data" type="button" onClick={onDate}>
          <span>
            {new Intl.DateTimeFormat("ro-RO", { weekday: "long" }).format(
              selected,
            )}
          </span>
          <strong>
            {new Intl.DateTimeFormat("ro-RO", {
              day: "numeric",
              month: "long",
            }).format(selected)}
          </strong>
        </button>
        <button aria-label="Ziua urmatoare" type="button" onClick={onNext}>
          ›
        </button>
      </div>
      <div className="studio-stats">
        <div>
          <strong>{count}</strong>
          <span>în agendă</span>
        </div>
        <div>
          <strong>
            {Math.floor(freeMinutes / 60)}
            <small>h</small>{" "}
            {freeMinutes % 60 ? (
              <>
                {freeMinutes % 60}
                <small>m</small>
              </>
            ) : null}
          </strong>
          <span>timp disponibil</span>
        </div>
        <div>
          <strong>{revenue}</strong>
          <span>valoarea zilei</span>
        </div>
      </div>
      <div className="studio-quick">
        <button className="studio-primary" type="button" onClick={onCreate}>
          <span aria-hidden="true">＋</span> Programare nouă
        </button>
        <button className="studio-secondary" type="button" onClick={onClients}>
          Cliente <span aria-hidden="true">↗</span>
        </button>
      </div>
      {next ? (
        <button className="studio-next" onClick={onEditNext} type="button">
          <span className="studio-live-dot" />
          <span>
            <small>
              URMĂTOAREA ÎN AGENDĂ ·{" "}
              {new Intl.DateTimeFormat("ro-RO", {
                day: "numeric",
                month: "short",
              }).format(new Date(`${next.date}T12:00:00`))}
            </small>
            <strong>{next.clientName}</strong>
          </span>
          <span className="studio-next-time">
            {next.start}
            <small>{next.service}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      ) : null}
    </header>
  );
}

export function StudioUpdateNotice() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let controlled = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (controlled) setAvailable(true);
      controlled = true;
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    return () =>
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
  }, []);
  if (!available) return null;
  return (
    <div className="studio-connection studio-update-notice" role="status">
      <p>
        O versiune nouă este disponibilă. Salvează ce ai început înainte de
        reîncărcare.
      </p>
      <button
        type="button"
        className="studio-secondary"
        onClick={() => window.location.reload()}
      >
        Actualizează aplicația
      </button>
    </div>
  );
}

export function StudioClientCard({
  name,
  phone,
  notes,
  visits,
  lastVisit,
  cancellations,
  historyProtected,
  onBook,
  onHistory,
  onEdit,
  onDelete,
}: {
  name: string;
  phone: string;
  notes: string;
  visits: number;
  lastVisit: string;
  cancellations: number;
  historyProtected: boolean;
  onBook: () => void;
  onHistory: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="studio-client-card">
      <div className="client-identity">
        <span className="agenda-avatar" aria-hidden="true">
          {name
            .split(" ")
            .map((word) => word[0])
            .slice(0, 2)
            .join("")}
        </span>
        <div>
          <h3>{name}</h3>
          <a href={`tel:${phone}`}>{phone}</a>
        </div>
        <span className="client-visits">
          {visits}
          <small>{visits === 1 ? "vizită" : "vizite"}</small>
        </span>
      </div>
      <p className="client-activity">
        {lastVisit}
        {cancellations ? ` · ${cancellations} anulări` : ""}
      </p>
      <div className="studio-client-quick">
        <button type="button" onClick={onBook}>
          ＋ Programare
        </button>
        <button type="button" onClick={onHistory}>
          Istoric ↗
        </button>
      </div>
      <details className="studio-more-actions">
        <summary>
          Contact și notițe <span aria-hidden="true">⌄</span>
        </summary>
        <p className="client-notes">
          {notes || "Fără notițe pentru această clientă."}
        </p>
        <div className="studio-client-quick">
          <a aria-label={`Sună ${name}`} href={`tel:${phone}`}>
            Sună
          </a>
          <a
            aria-label={`WhatsApp ${name}`}
            href={`https://wa.me/${phone.replace(/[^0-9]/g, "").replace(/^0/, "40")}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
          <button type="button" onClick={onEdit}>
            Editează clienta
          </button>
          <button type="button" disabled={historyProtected} onClick={onDelete}>
            {historyProtected ? "Istoric protejat" : "Șterge clienta"}
          </button>
        </div>
      </details>
    </article>
  );
}
