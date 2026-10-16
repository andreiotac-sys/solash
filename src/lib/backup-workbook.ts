import writeExcelFile from "write-excel-file/node";

type BackupCell = string | number | boolean | null;

const asCell = (value: unknown): BackupCell =>
  value === null || value === undefined ? null
    : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value
      : JSON.stringify(value);

export const createBackupWorkbook = async (
  tables: readonly (readonly [string, string])[],
  rowsByTable: Record<string, Record<string, unknown>[]>
): Promise<Buffer> => writeExcelFile(tables.map(([table, sheet]) => {
  const rows = rowsByTable[table];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : ["id"];
  return {
    sheet,
    data: [columns, ...rows.map((row) => columns.map((column) => asCell(row[column])))],
  };
})).toBuffer();
