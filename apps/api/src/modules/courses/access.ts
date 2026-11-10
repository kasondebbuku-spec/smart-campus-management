import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../../middleware/auth.js";

// Who can see a course: admins see all, lecturers the ones they teach,
// students the ones they are enrolled in. Used inside queries so a missing
// check can never leak another course's data.
export function visibleCourses(user: AuthUser): Prisma.CourseWhereInput {
  if (user.role === "ADMIN") return {};
  if (user.role === "LECTURER") return { lecturer: { userId: user.id } };
  return { enrolments: { some: { student: { userId: user.id } } } };
}

// Who can change a course's timetable and attendance: admins and the course's own lecturer.
export function managedCourses(user: AuthUser): Prisma.CourseWhereInput {
  if (user.role === "ADMIN") return {};
  if (user.role === "LECTURER") return { lecturer: { userId: user.id } };
  return { id: { in: [] } }; // students manage nothing
}
