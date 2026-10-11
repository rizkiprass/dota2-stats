import type { MatchRecord, MatchesPayload } from "../types/stats";

/**
 * Calendar helpers for the match-history page. Everything buckets by the
 * reader's local calendar date: a late-evening lobby must not slide into the
 * next day because the payload stores UTC epoch seconds.
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function dayKeyOfParts(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** Local-time day key (YYYY-MM-DD), or null when the match has no timestamp. */
export function dayKey(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return dayKeyOfParts(date.getFullYear(), date.getMonth(), date.getDate());
}

export interface MonthCursor {
  year: number;
  /** 0-based, matching Date#getMonth. */
  month: number;
}

export function monthOf(seconds: number | null | undefined, fallback: Date = new Date()): MonthCursor {
  if (seconds === null || seconds === undefined) {
    return { year: fallback.getFullYear(), month: fallback.getMonth() };
  }
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return { year: fallback.getFullYear(), month: fallback.getMonth() };
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function addMonths(cursor: MonthCursor, delta: number): MonthCursor {
  const date = new Date(cursor.year, cursor.month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function monthLabel(cursor: MonthCursor): string {
  return new Date(cursor.year, cursor.month, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function sameMonth(a: MonthCursor, b: MonthCursor): boolean {
  return a.year === b.year && a.month === b.month;
}

/** Negative when `a` is earlier than `b`. */
export function compareMonths(a: MonthCursor, b: MonthCursor): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** Weekday headings, Monday first. */
export function weekdayHeadings(): string[] {
  // 2024-01-01 was a Monday, so this yields Mon..Sun in any locale.
  return Array.from({ length: 7 }, (_, index) =>
    new Date(2024, 0, 1 + index).toLocaleDateString("en-GB", { weekday: "short" }),
  );
}

export interface CalendarDay {
  key: string;
  day: number;
  /** False for the leading/trailing days that complete the first and last week. */
  inMonth: boolean;
  isToday: boolean;
  matches: MatchRecord[];
}

export interface CalendarMonth {
  cursor: MonthCursor;
  label: string;
  weeks: CalendarDay[][];
  /** Matches in this month only, newest first. */
  matches: MatchRecord[];
  activeDays: number;
  totalDuration: number;
}

/** Bucket every published match by its local day key. */
export function bucketByDay(payload: MatchesPayload | undefined): Map<string, MatchRecord[]> {
  const buckets = new Map<string, MatchRecord[]>();
  for (const match of payload?.matches ?? []) {
    const key = dayKey(match.start_time);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(match);
    else buckets.set(key, [match]);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0));
  }
  return buckets;
}

export function buildMonth(
  payload: MatchesPayload | undefined,
  cursor: MonthCursor,
  now: Date = new Date(),
): CalendarMonth {
  const buckets = bucketByDay(payload);
  const first = new Date(cursor.year, cursor.month, 1);
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Monday-first column index
  const weekCount = Math.ceil((leading + daysInMonth) / 7);

  const todayKey = dayKeyOfParts(now.getFullYear(), now.getMonth(), now.getDate());
  const weeks: CalendarDay[][] = [];
  const monthMatches: MatchRecord[] = [];

  for (let week = 0; week < weekCount; week += 1) {
    const days: CalendarDay[] = [];
    for (let column = 0; column < 7; column += 1) {
      // `offset` is the 0-based day index in the month, so the day of month is 1 + offset.
      // Offset -1 yields the previous month's last day, which is what a leading cell needs.
      const offset = week * 7 + column - leading;
      const date = new Date(cursor.year, cursor.month, offset + 1);
      const key = dayKeyOfParts(date.getFullYear(), date.getMonth(), date.getDate());
      const inMonth = offset >= 0 && offset < daysInMonth;
      const matches = inMonth ? (buckets.get(key) ?? []) : [];
      if (inMonth) monthMatches.push(...matches);
      days.push({
        key,
        day: date.getDate(),
        inMonth,
        isToday: key === todayKey,
        matches,
      });
    }
    weeks.push(days);
  }

  monthMatches.sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0));

  return {
    cursor,
    label: monthLabel(cursor),
    weeks,
    matches: monthMatches,
    activeDays: weeks.flat().filter((day) => day.inMonth && day.matches.length > 0).length,
    totalDuration: monthMatches.reduce((sum, match) => sum + (Number(match.duration) || 0), 0),
  };
}

/** Whether the published cap hides older matches. */
export function coverage(payload: MatchesPayload | undefined): { truncated: boolean; hidden: number } {
  const total = Number(payload?.match_count) || 0;
  const published = payload?.matches?.length ?? 0;
  return { truncated: total > published, hidden: Math.max(0, total - published) };
}

/* ------------------------------------------------------------------ */
/* Display formatting                                                  */
/* ------------------------------------------------------------------ */

export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "Date unknown";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
