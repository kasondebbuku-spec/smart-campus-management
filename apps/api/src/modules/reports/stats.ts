// Attendance statistics, kept free of database code so every rule is easy to test.
//
// Rules:
// - Only sessions that have ended count. A class still running or in the future doesn't
//   lower anyone's rate.
// - PRESENT and LATE both count as attending.
// - EXCUSED sessions are left out of the rate entirely.
// - An ended session with no record counts as absent, but is reported separately as
//   `notRecorded` so a lecturer can spot sessions where marking was forgotten.
// - A student is flagged "at risk" only once enough sessions have happened, so missing
//   the first class of the semester doesn't trigger a warning.

export type Status = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";

export type StatsOptions = { threshold: number; minSessions: number };

export type AttendanceStats = {
  sessions: number; // ended sessions
  present: number;
  late: number;
  absent: number; // marked absent
  excused: number;
  notRecorded: number; // ended, but no record: counted as absent in the rate
  rate: number | null; // attended / (sessions - excused), null when nothing to count yet
  atRisk: boolean;
};

export function attendanceStats(statuses: (Status | null)[], opts: StatsOptions): AttendanceStats {
  const s: AttendanceStats = { sessions: statuses.length, present: 0, late: 0, absent: 0, excused: 0, notRecorded: 0, rate: null, atRisk: false };
  for (const status of statuses) {
    if (status === null) s.notRecorded++;
    else s[status.toLowerCase() as "present" | "late" | "absent" | "excused"]++;
  }

  const counted = s.sessions - s.excused;
  if (counted > 0) {
    s.rate = round((s.present + s.late) / counted);
    s.atRisk = counted >= opts.minSessions && s.rate < opts.threshold;
  }
  return s;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export type StudentRow = { studentId: string; studentNumber: string; firstName: string; lastName: string };

/** One row per student, from the class list and the course's ended sessions. */
export function courseReport(
  students: StudentRow[],
  endedSessionIds: string[],
  records: { studentId: string; sessionId: string; status: Status }[],
  opts: StatsOptions,
) {
  const byStudent = new Map<string, Map<string, Status>>();
  for (const r of records) {
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, new Map());
    byStudent.get(r.studentId)!.set(r.sessionId, r.status);
  }

  const rows = students.map((st) => {
    const mine = byStudent.get(st.studentId);
    const statuses = endedSessionIds.map((id) => mine?.get(id) ?? null);
    return { ...st, ...attendanceStats(statuses, opts) };
  });

  // Students at risk first, lowest rate first, then by student number.
  rows.sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || (a.rate ?? 1) - (b.rate ?? 1) || a.studentNumber.localeCompare(b.studentNumber));

  const rated = rows.filter((r) => r.rate !== null);
  return {
    sessionsCounted: endedSessionIds.length,
    averageRate: rated.length ? round(rated.reduce((sum, r) => sum + r.rate!, 0) / rated.length) : null,
    atRisk: rows.filter((r) => r.atRisk).length,
    threshold: opts.threshold,
    rows,
  };
}

// Spreadsheet apps run cells that start with = + - @ (or a tab/return) as formulas.
// Prefixing a ' stops a student's name like "=HYPERLINK(...)" from running in Excel.
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | boolean | null)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
