// All times are shown and entered in Lusaka time (UTC+2, no daylight saving),
// whatever time zone the device is set to.
export const TZ = "Africa/Lusaka";
const OFFSET = "+02:00";

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });
const dayFmt = fmt({ weekday: "short", day: "numeric", month: "short" });
const timeFmt = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
const isoDayFmt = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });

export const formatDay = (iso: string | Date) => dayFmt.format(new Date(iso));
export const formatTime = (iso: string | Date) => timeFmt.format(new Date(iso));
export const formatRange = (start: string | Date, end: string | Date) => `${formatDay(start)}, ${formatTime(start)}–${formatTime(end)}`;

/** "2026-11-16" for the given moment, in Lusaka. Useful as a date input's value. */
export function lusakaDate(d: Date = new Date()): string {
  const parts = Object.fromEntries(isoDayFmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Combines a date input ("2026-11-16") and a time input ("08:00") into an ISO string in Lusaka time. */
export function toLusakaIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Expected YYYY-MM-DD and HH:MM");
  return `${date}T${time}:00${OFFSET}`;
}

/** "in 5 min", "12 min ago", "now". */
export function relative(iso: string | Date, now = Date.now()): string {
  const mins = Math.round((new Date(iso).getTime() - now) / 60000);
  if (mins === 0) return "now";
  if (Math.abs(mins) >= 60 * 24) return formatDay(iso);
  if (Math.abs(mins) >= 60) {
    const h = Math.round(Math.abs(mins) / 60);
    return mins > 0 ? `in ${h} h` : `${h} h ago`;
  }
  return mins > 0 ? `in ${mins} min` : `${-mins} min ago`;
}

export type SessionPhase = "upcoming" | "in-progress" | "ended";

export function sessionPhase(s: { startsAt: string; endsAt: string }, now = Date.now()): SessionPhase {
  if (now < new Date(s.startsAt).getTime()) return "upcoming";
  if (now < new Date(s.endsAt).getTime()) return "in-progress";
  return "ended";
}
