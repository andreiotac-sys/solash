import test from "node:test";
import assert from "node:assert/strict";
import { getCustomerReportingAppointments } from "../src/lib/reporting.ts";

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
