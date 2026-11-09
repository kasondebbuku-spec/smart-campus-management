// Types and constants shared by the API and the web app.

export const ROLES = ["ADMIN", "LECTURER", "STUDENT"] as const;
export type Role = (typeof ROLES)[number];

export const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

// Students below this attendance rate get a warning. Adjust to the institution's policy.
export const ATTENDANCE_WARNING_THRESHOLD = 0.8;
