import type { AttendanceStatus } from "@campus/shared";

// Shapes returned by the API (see /api/docs).

export type Course = {
  id: string;
  code: string;
  title: string;
  semester: string;
  lecturer: { id: string; user: { firstName: string; lastName: string } } | null;
  _count: { enrolments: number };
};

export type ClassSession = {
  id: string;
  courseId: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  course: { code: string; title: string };
  _count: { attendance: number };
};

export type RosterEntry = {
  id: string;
  studentNumber: string;
  user: { firstName: string; lastName: string };
  status: AttendanceStatus | null;
  method: "QR" | "MANUAL" | null;
  recordedAt: string | null;
};

export type Roster = {
  session: { id: string; course: string; startsAt: string; checkInOpen: boolean };
  summary: { enrolled: number; present: number; late: number; absent: number; excused: number; notRecorded: number };
  items: RosterEntry[];
};

export type CheckInWindow = { id: string; checkInOpenedAt: string; checkInClosesAt: string; lateAfter: string };

export type QrCode = { token: string; refreshInSeconds: number; closesAt: string; checkedIn: number };
