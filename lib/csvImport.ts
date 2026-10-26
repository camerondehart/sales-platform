// CSV parsing for uploads.
//
// Exports build CSV with their own local csvCell helpers (unchanged — that
// path is long-proven). Reading is the harder direction: a spreadsheet will
// happily produce quoted fields containing commas, quotes and line breaks,
// so a real parser is needed rather than splitting on commas.

/**
 * Parse a CSV document into rows of strings.
 *
 * Handles quoted fields, escaped quotes (""), commas and newlines inside
 * quotes, and both \n and \r\n endings. Strips the UTF-8 byte order mark
 * that Excel adds, which would otherwise corrupt the first column name.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop entirely blank lines
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Parse into objects keyed by lower-cased column name. Tolerates extra
 * columns and any column order, so a file exported from another system
 * usually works without being reformatted.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (r[i] ?? "").trim();
    });
    return rec;
  });
}

/** First non-empty value among several possible column names. */
export function pick(rec: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = rec[n.toLowerCase()];
    if (v) return v;
  }
  return "";
}

/** Column names we accept for an email address. */
export const EMAIL_COLUMNS = ["email", "email address", "e-mail", "email_address", "emailaddress"];
/** Column names we accept for a person's name. */
export const NAME_COLUMNS = ["name", "full name", "fullname", "customer", "first name", "firstname"];
/** Column names we accept for a status, used to skip rows that shouldn't be mailed. */
export const STATUS_COLUMNS = ["status", "state", "subscribed"];
