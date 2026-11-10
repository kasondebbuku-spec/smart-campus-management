import type { AttendanceStatus } from "@campus/shared";
import { ApiError } from "./api";

export type CheckInResponse = { alreadyCheckedIn: boolean; status: AttendanceStatus; course: string; recordedAt: string };

// Everything a student can see after scanning, in plain words.
export type CheckInOutcome =
  | { kind: "success"; status: AttendanceStatus; course: string; recordedAt: string; already: boolean }
  | { kind: "problem"; title: string; detail: string; tryAgain: boolean };

export function outcomeFromResponse(r: CheckInResponse): CheckInOutcome {
  return { kind: "success", status: r.status, course: r.course, recordedAt: r.recordedAt, already: r.alreadyCheckedIn };
}

export function outcomeFromError(e: unknown): CheckInOutcome {
  if (!(e instanceof ApiError)) {
    return { kind: "problem", title: "No connection", detail: "Check your internet connection, then scan the code again.", tryAgain: true };
  }
  if (e.status === 400 && /expired/i.test(e.message)) {
    return {
      kind: "problem",
      title: "That code has expired",
      detail: "Codes change every 30 seconds. Scan the code on the screen again.",
      tryAgain: true,
    };
  }
  if (e.status === 400) {
    return { kind: "problem", title: "That isn't a check-in code", detail: "Scan the QR code shown on your lecturer's screen.", tryAgain: true };
  }
  if (e.status === 403 && /not enrolled/i.test(e.message)) {
    return {
      kind: "problem",
      title: "You're not on this class list",
      detail: `${e.message}. If you think this is wrong, speak to your lecturer or the registry.`,
      tryAgain: false,
    };
  }
  if (e.status === 403) {
    return { kind: "problem", title: "Only students check in", detail: "You're signed in with a staff account.", tryAgain: false };
  }
  if (e.status === 409) {
    return { kind: "problem", title: "Check-in is closed", detail: `${e.message}. Ask your lecturer to mark your attendance.`, tryAgain: false };
  }
  return { kind: "problem", title: "Something went wrong", detail: e.message, tryAgain: true };
}

/** Reads the code from a scanned link: /check-in?t=<token>. */
export function tokenFromSearch(search: string): string | null {
  const t = new URLSearchParams(search).get("t")?.trim();
  return t ? t : null;
}
