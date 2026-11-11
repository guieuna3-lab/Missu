// Seoul-time helpers for the report and return screens. Figma shows every date as
// "2026.10.06 14:00" and the mock data is KST, so the device time zone must not change it
// (same approach as formatFoundAt in items.ts).
const KST_OFFSET_MS = 9 * 3_600_000;
const pad = (value: number) => String(value).padStart(2, '0');

function toSeoulParts(iso: string) {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  const d = new Date(time + KST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** "2026.10.06" */
export function formatDate(iso: string) {
  const p = toSeoulParts(iso);
  return p ? `${p.year}.${pad(p.month)}.${pad(p.day)}` : '';
}

/** "14:20" */
export function formatTime(iso: string) {
  const p = toSeoulParts(iso);
  return p ? `${pad(p.hour)}:${pad(p.minute)}` : '';
}

/** "2026.10.06 14:20" */
export function formatDateTime(iso: string) {
  const date = formatDate(iso);
  return date ? `${date} ${formatTime(iso)}` : '';
}

/** "2026.10.06 14:00~18:00" (same day), "2026.10.06 23:00 ~ 2026.10.07 01:00", or one value. */
export function formatDateTimeRange(fromIso: string, toIso?: string) {
  if (!toIso || toIso === fromIso) return formatDateTime(fromIso);
  if (formatDate(fromIso) === formatDate(toIso))
    return `${formatDateTime(fromIso)}~${formatTime(toIso)}`;
  return `${formatDateTime(fromIso)} ~ ${formatDateTime(toIso)}`;
}

function toIso(year: number, month: number, day: number, hour: number, minute: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  // Rejects dates that roll over, such as 02.30.
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+09:00`;
}

/** Parses "2026.10.06 14:00" (also "2026-10-06 14:00", "2026.10.06 · 14:20") as Seoul time. */
export function parseDateTime(text: string) {
  const m = text.trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*(?:·\s*)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  return toIso(year, month, day, hour, minute);
}

/** Parses "2026.10.06" as midnight in Seoul. */
export function parseDate(text: string) {
  const m = text.trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (!m) return null;
  const [year, month, day] = m.slice(1).map(Number);
  return toIso(year, month, day, 0, 0);
}

/** "17:00" or "9:05" */
export function isTimeText(text: string) {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

export function normalizeTimeText(text: string) {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : text.trim();
}
