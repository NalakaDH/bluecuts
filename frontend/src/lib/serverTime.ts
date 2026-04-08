/**
 * Parse datetimes returned by the local Express API. SQLite uses `datetime('now')`, which is **UTC**
 * formatted as `YYYY-MM-DD HH:MM:SS` with no timezone. `new Date('2026-04-08 12:00:00')` is treated as
 * **local** time in browsers, which skews the displayed clock. This helper interprets that shape as UTC.
 */
export function dateFromServerUtc(raw: string | null | undefined): Date {
  if (raw == null || String(raw).trim() === '') return new Date(NaN);
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) {
    const time = m[2].length === 5 ? `${m[2]}:00` : m[2];
    return new Date(`${m[1]}T${time}Z`);
  }
  return new Date(s);
}
