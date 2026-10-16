import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import { createBackupWorkbook } from "../src/lib/backup-workbook.ts";

test("cloud workbook retains more than the old 1,000-row limit and IDs", async () => {
  const rows = Array.from({ length: 1205 }, (_, index) => ({
    id: index + 1,
    client_id: index + 10,
    status: "Programata",
    notes: index === 1204 ? "=HYPERLINK(\"https://invalid.example\")" : "",
  }));
  const buffer = await createBackupWorkbook(
    [["appointments", "Programari"], ["clients", "Cliente"]],
    { appointments: rows, clients: [{ id: 10, name: "Synthetic" }] }
  );
  const files = unzipSync(new Uint8Array(buffer));
  const workbook = new TextDecoder().decode(files["xl/workbook.xml"]);
  const sheet = new TextDecoder().decode(files["xl/worksheets/sheet1.xml"]);
  assert.match(workbook, /Programari/);
  assert.match(workbook, /Cliente/);
  assert.equal((sheet.match(/<row\b/g) ?? []).length, 1206);
  assert.match(sheet, /1205/);
  assert.doesNotMatch(sheet, /<f>/);
});
