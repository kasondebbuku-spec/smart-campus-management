import { Router } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { authenticate, currentUser, requireRole, type AuthUser } from "../../middleware/auth.js";
import { managedCourses, visibleCourses } from "../courses/access.js";
import { attendanceStats, courseReport, toCsv, type Status } from "./stats.js";

// Byte-order mark: tells Excel the file is UTF-8, so names with accents display correctly.
const BOM = String.fromCharCode(0xfeff);
const idParam = z.object({ id: z.string().min(1) });
const opts = () => ({ threshold: config.ATTENDANCE_WARNING_THRESHOLD, minSessions: config.ATTENDANCE_MIN_SESSIONS });

async function findManagedCourse(id: string, user: AuthUser) {
  const course = await db.course.findFirst({ where: { id, ...managedCourses(user) } });
  if (course) return course;
  if (await db.course.findFirst({ where: { id, ...visibleCourses(user) } })) {
    throw forbidden("Only the course's lecturer or an admin can see the class report");
  }
  throw notFound("Course not found");
}

async function buildCourseReport(courseId: string) {
  const now = new Date();
  const [enrolments, sessions] = await Promise.all([
    db.enrolment.findMany({
      where: { courseId },
      select: { student: { select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } } } },
    }),
    db.classSession.findMany({ where: { courseId, endsAt: { lte: now } }, select: { id: true }, orderBy: { startsAt: "asc" } }),
  ]);
  const sessionIds = sessions.map((s) => s.id);
  const records = await db.attendanceRecord.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { studentId: true, sessionId: true, status: true },
  });
  const students = enrolments.map(({ student }) => ({
    studentId: student.id,
    studentNumber: student.studentNumber,
    firstName: student.user.firstName,
    lastName: student.user.lastName,
  }));
  return courseReport(students, sessionIds, records, opts());
}

export const reportsRouter = Router();

// Per-student attendance for one course. Students at risk are listed first.
reportsRouter.get("/courses/:id/report", authenticate, async (req, res) => {
  const { id } = idParam.parse(req.params);
  const course = await findManagedCourse(id, currentUser(req));
  const report = await buildCourseReport(course.id);
  res.json({ course: { id: course.id, code: course.code, title: course.title, semester: course.semester }, ...report });
});

// The same report as a spreadsheet. Downloads of personal data are audited.
reportsRouter.get("/courses/:id/report.csv", authenticate, async (req, res) => {
  const user = currentUser(req);
  const { id } = idParam.parse(req.params);
  const course = await findManagedCourse(id, user);
  const report = await buildCourseReport(course.id);

  const csv = toCsv(
    ["Student number", "First name", "Last name", "Sessions", "Present", "Late", "Absent", "Excused", "Not recorded", "Attendance rate (%)", "At risk"],
    report.rows.map((r) => [
      r.studentNumber,
      r.firstName,
      r.lastName,
      r.sessions,
      r.present,
      r.late,
      r.absent,
      r.excused,
      r.notRecorded,
      r.rate === null ? null : Math.round(r.rate * 1000) / 10,
      r.atRisk ? "yes" : "no",
    ]),
  );

  await audit({ action: "report.export", actorId: user.id, entityType: "Course", entityId: course.id, metadata: { rows: report.rows.length }, ip: req.ip });
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Disposition", `attachment; filename="${course.code}-attendance-${date}.csv"`);
  res.type("text/csv; charset=utf-8").send(BOM + csv);
});

// A student's own attendance in every course they're enrolled in, with each ended session.
reportsRouter.get("/me/attendance", authenticate, requireRole("STUDENT"), async (req, res) => {
  const user = currentUser(req);
  const student = await db.student.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!student) throw notFound("No student profile for this account");

  const now = new Date();
  const enrolments = await db.enrolment.findMany({
    where: { studentId: student.id },
    select: {
      course: {
        select: {
          id: true,
          code: true,
          title: true,
          sessions: {
            where: { endsAt: { lte: now } },
            orderBy: { startsAt: "desc" },
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              venue: true,
              attendance: { where: { studentId: student.id }, select: { status: true, method: true } },
            },
          },
        },
      },
    },
    orderBy: { course: { code: "asc" } },
  });

  const courses = enrolments.map(({ course }) => {
    const sessions = course.sessions.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      venue: s.venue,
      status: (s.attendance[0]?.status ?? null) as Status | null,
      method: s.attendance[0]?.method ?? null,
    }));
    return {
      course: { id: course.id, code: course.code, title: course.title },
      ...attendanceStats(
        sessions.map((s) => s.status),
        opts(),
      ),
      sessions,
    };
  });

  res.json({ threshold: config.ATTENDANCE_WARNING_THRESHOLD, minSessions: config.ATTENDANCE_MIN_SESSIONS, courses });
});
