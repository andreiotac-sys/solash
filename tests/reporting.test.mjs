import test from "node:test";
import assert from "node:assert/strict";
import { getCustomerReportingAppointments, getReportRange, selectReportMonth, shiftReportDate, summarizeReportAppointments } from "../src/lib/reporting.ts";

test("customer reports exclude internal time without losing cancelled customer history or changing source rows", () => {
  const rows = [
    {
      id: 1,
      date: "2026-10-18",
      service: "Russian Volum",
      notes: "",
      status: "Programata",
      price: 300,
      clientId: 10,
    },
    {
      id: 2,
      date: "2026-10-18",
      service: "Blocaj personal",
      notes: "",
      status: "Programata",
      price: 0,
      clientId: 11,
    },
    {
      id: 3,
      date: "2026-10-18",
      service: "Legacy title",
      notes: "[solash-personal-block] Eu gene",
      status: "Programata",
      price: 0,
      clientId: 12,
    },
    {
      id: 4,
      date: "2026-10-18",
      service: "Russian Volum",
      notes: "",
      status: "Anulata",
      price: 300,
      clientId: 10,
    },
    {
      id: 5,
      date: "2022-12-31",
      service: "Russian Volum",
      notes: "",
      status: "Programata",
      price: 200,
      clientId: 13,
    },
  ];
  const before = JSON.stringify(rows);
  const report = getCustomerReportingAppointments(rows);
  assert.deepEqual(
    report.map((row) => row.id),
    [1, 4],
  );
  const active = report.filter((row) => row.status !== "Anulata");
  assert.equal(
    active.reduce((sum, row) => sum + row.price, 0) / active.length,
    300,
  );
  assert.equal(new Set(active.map((row) => row.clientId)).size, 1);
  assert.equal(JSON.stringify(rows), before);
});


test("day, Monday–Sunday week and leap-month boundaries use calendar dates", () => {
  assert.deepEqual(getReportRange("day", "2026-10-24"), { start: "2026-10-24", end: "2026-10-24" });
  assert.deepEqual(getReportRange("week", "2026-10-25"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(getReportRange("week", "2026-10-26"), { start: "2026-10-26", end: "2026-11-01" });
  assert.deepEqual(getReportRange("week", "2027-01-01"), { start: "2026-12-28", end: "2027-01-03" });
  assert.deepEqual(getReportRange("month", "2024-02-29"), { start: "2024-02-01", end: "2024-02-29" });
  assert.deepEqual(getReportRange("week", "2026-03-29"), { start: "2026-03-23", end: "2026-03-29" });
  assert.throws(() => getReportRange("day", "2026-02-30"));
  assert.throws(() => getReportRange("day", ""));
});

test("period navigation clamps short months and crosses DST and year boundaries", () => {
  assert.equal(selectReportMonth("2024-01-31", "2024-02"), "2024-02-29");
  assert.equal(shiftReportDate("2026-01-31", "month", 1), "2026-02-28");
  assert.equal(shiftReportDate("2026-12-31", "month", 1), "2027-01-31");
  assert.equal(shiftReportDate("2026-03-29", "day", 1), "2026-03-30");
  assert.equal(shiftReportDate("2026-10-25", "week", 1), "2026-11-01");
  assert.equal(shiftReportDate("2027-01-01", "day", -1), "2026-12-31");
});

test("cross-year weekly totals and daily rows retain cancellations, exclude personal blocks and include empty days", () => {
  const row = (id, date, price, extra = {}) => ({ id, date, price, clientId: 10, clientName: "Test", start: "09:00", duration: "1h", service: "Gene", status: "Programata", notes: "", ...extra });
  const source = [
    row(1, "2026-12-27", 999), row(2, "2026-12-28", 100),
    row(3, "2027-01-01", 200), row(4, "2027-01-03", 300, {clientId: 11}),
    row(5, "2027-01-04", 999), row(6, "2027-01-01", 500, {status: "Anulata"}),
    row(7, "2027-01-01", 700, {service: "Blocaj personal"}),
    row(8, "2027-01-01", 800, {notes: "[solash-personal-block]"}),
  ];
  const before = JSON.stringify(source);
  const summary = summarizeReportAppointments(source, getReportRange("week", "2027-01-01"));
  assert.deepEqual(summary.appointments.map(r => r.id), [2, 3, 6, 4]);
  assert.equal(summary.totalRevenue, 600);
  assert.equal(summary.avgTicket, 200);
  assert.equal(summary.uniqueClients, 2);
  assert.equal(summary.nonCancelled.length, 3);
  assert.equal(summary.daily.length, 7);
  assert.deepEqual(summary.daily[1], {date: "2026-12-29", count: 0, cancelled: 0, revenue: 0});
  assert.deepEqual(summary.daily[4], {date: "2027-01-01", count: 1, cancelled: 1, revenue: 200});
  assert.equal(summary.daily.reduce((sum, day) => sum + day.revenue, 0), summary.totalRevenue);
  const day = summarizeReportAppointments(source, getReportRange("day", "2027-01-01"));
  assert.equal(day.totalRevenue, 200);
  assert.equal(day.appointments.length, 2);
  const month = summarizeReportAppointments(source, getReportRange("month", "2027-01-01"));
  assert.equal(month.totalRevenue, 1499);
  const empty = summarizeReportAppointments([], getReportRange("day", "2026-10-24"));
  assert.equal(empty.avgTicket, 0);
  assert.equal(empty.uniqueClients, 0);
  assert.equal(empty.daily.length, 1);
  assert.equal(JSON.stringify(source), before);
});
