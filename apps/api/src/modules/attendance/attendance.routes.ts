import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { currentQrToken, verifyQrToken } from "../../lib/qr-token.js";
import { authenticate, currentUser, requireRole, type AuthUser } from "../../middleware/auth.js";
import { managedCourses, visibleCourses } from "../courses/access.js";

const MINUTE = 60 * 1000;

const idParam = z.object({ id: z.string().min(1) });

const openBody = z
  .object({
    durationMinutes: z.number().int().min(1).max(180).default(15),
    // Students arriving more than this many minutes after the session starts are LATE.
    lateAfterMinutes: z.number().int().min(0).max(180).default(10),
  })
  .default({});

const checkInBody = z.object({ token: z.string().min(1).max(200) });

const isOpen = (s: { checkInClosesAt: Date | null }, now = new Date()) => Boolean(s.checkInClosesAt && s.checkInClosesAt > now);

async function findManagedSession(id: string, user: AuthUser) {
  const session = await db.classSession.findFirst({ where: { id, course: managedCourses(user) }, include: { course: true } });
  if (session) return session;
  if (await db.classSession.findFirst({ where: { id, course: visibleCourses(user) } })) {
    throw forbidden("Only the course's lecturer or an admin can run check-in");
  }
  throw notFound("Session not found");
}

export const attendanceRouter = Router();

// Lecturer opens check-in. Opening again extends it.
attendanceRouter.post("/sessions/:id/check-in/open", authenticate, async (req, res) => {
  const user = currentUser(req);
  const { id } = idParam.parse(req.params);
  const body = openBody.parse(req.body ?? {});
  const session = await findManagedSession(id, user);

  const now = new Date();
  if (session.endsAt < now) throw conflict("This session has already ended");

  const updated = await db.classSession.update({
    where: { id },
    data: {
      checkInOpenedAt: session.checkInOpenedAt && isOpen(session, now) ? session.checkInOpenedAt : now,
      checkInClosesAt: new Date(now.getTime() + body.durationMinutes * MINUTE),
      lateAfter: new Date(session.startsAt.getTime() + body.lateAfterMinutes * MINUTE),
    },
    select: { id: true, checkInOpenedAt: true, checkInClosesAt: true, lateAfter: true },
  });
  await audit({ action: "attendance.check_in_open", actorId: user.id, entityType: "ClassSession", entityId: id, metadata: body, ip: req.ip });
  res.json(updated);
});

attendanceRouter.post("/sessions/:id/check-in/close", authenticate, async (req, res) => {
  const user = currentUser(req);
  const { id } = idParam.parse(req.params);
  const session = await findManagedSession(id, user);
  if (isOpen(session)) {
    await db.classSession.update({ where: { id }, data: { checkInClosesAt: new Date() } });
    await audit({ action: "attendance.check_in_close", actorId: user.id, entityType: "ClassSession", entityId: id, ip: req.ip });
  }
  res.status(204).end();
});

// The lecturer's screen polls this and redraws the QR code when it changes.
attendanceRouter.get("/sessions/:id/check-in/qr", authenticate, async (req, res) => {
  const { id } = idParam.parse(req.params);
  const session = await findManagedSession(id, currentUser(req));
  if (!isOpen(session)) throw conflict("Check-in is not open for this session");

  const checkedIn = await db.attendanceRecord.count({ where: { sessionId: id, method: "QR" } });
  res.json({ ...currentQrToken(id), closesAt: session.checkInClosesAt, checkedIn });
});

// A student scans the code on the screen.
attendanceRouter.post("/check-in", authenticate, requireRole("STUDENT"), async (req, res) => {
  const user = currentUser(req);
  const { token } = checkInBody.parse(req.body);

  const check = verifyQrToken(token);
  if (!check.ok) {
    if (check.reason === "expired") throw badRequest("This QR code has expired. Scan the code on the screen again.");
    await audit({ action: "attendance.check_in_rejected", actorId: user.id, metadata: { reason: check.reason }, ip: req.ip });
    throw badRequest("This isn't a valid check-in code");
  }

  const session = await db.classSession.findUnique({ where: { id: check.sessionId }, include: { course: { select: { id: true, code: true } } } });
  if (!session) throw badRequest("This isn't a valid check-in code");

  const now = new Date();
  if (!isOpen(session, now)) throw conflict(`Check-in for ${session.course.code} is closed`);

  const student = await db.student.findFirst({
    where: { userId: user.id, enrolments: { some: { courseId: session.course.id } } },
    select: { id: true },
  });
  if (!student) {
    await audit({ action: "attendance.check_in_rejected", actorId: user.id, entityType: "ClassSession", entityId: session.id, metadata: { reason: "not_enrolled" }, ip: req.ip });
    throw forbidden(`You're not enrolled in ${session.course.code}`);
  }

  // Scanning twice is harmless, and never overwrites what a lecturer marked by hand.
  const existing = await db.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } } });
  if (existing) {
    res.json({ alreadyCheckedIn: true, status: existing.status, course: session.course.code, recordedAt: existing.recordedAt });
    return;
  }

  const status = session.lateAfter && now > session.lateAfter ? "LATE" : "PRESENT";
  try {
    const record = await db.attendanceRecord.create({
      data: { sessionId: session.id, studentId: student.id, status, method: "QR", recordedById: user.id },
    });
    res.status(201).json({ alreadyCheckedIn: false, status: record.status, course: session.course.code, recordedAt: record.recordedAt });
  } catch (e) {
    // Two scans at the same instant: the database's unique rule lets only one through.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const record = await db.attendanceRecord.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } } });
      res.json({ alreadyCheckedIn: true, status: record.status, course: session.course.code, recordedAt: record.recordedAt });
      return;
    }
    throw e;
  }
});

// Every enrolled student with their status for this session; null means not checked in yet.
attendanceRouter.get("/sessions/:id/attendance", authenticate, async (req, res) => {
  const { id } = idParam.parse(req.params);
  const session = await findManagedSession(id, currentUser(req));

  const enrolments = await db.enrolment.findMany({
    where: { courseId: session.courseId },
    select: {
      student: {
        select: {
          id: true,
          studentNumber: true,
          user: { select: { firstName: true, lastName: true } },
          attendance: { where: { sessionId: id }, select: { status: true, method: true, recordedAt: true } },
        },
      },
    },
    orderBy: { student: { studentNumber: "asc" } },
  });

  const items = enrolments.map(({ student: { attendance, ...s } }) => ({
    ...s,
    status: attendance[0]?.status ?? null,
    method: attendance[0]?.method ?? null,
    recordedAt: attendance[0]?.recordedAt ?? null,
  }));
  const summary = { enrolled: items.length, present: 0, late: 0, absent: 0, excused: 0, notRecorded: 0 };
  for (const i of items) {
    if (i.status === null) summary.notRecorded++;
    else summary[i.status.toLowerCase() as "present" | "late" | "absent" | "excused"]++;
  }

  res.json({ session: { id: session.id, course: session.course.code, startsAt: session.startsAt, checkInOpen: isOpen(session) }, summary, items });
});


const STATUSES = ["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const;

const markBody = z.object({
  records: z
    .array(z.object({ studentId: z.string().min(1), status: z.enum(STATUSES) }))
    .min(1)
    .max(500)
    .refine((r) => new Set(r.map((x) => x.studentId)).size === r.length, "Each student can appear only once"),
});

// Lecturer marks or corrects attendance by hand. Every change is audited with the old
// and new status, and the whole batch is saved together or not at all.
attendanceRouter.put("/sessions/:id/attendance", authenticate, async (req, res) => {
  const user = currentUser(req);
  const { id } = idParam.parse(req.params);
  const { records } = markBody.parse(req.body);
  const session = await findManagedSession(id, user);

  // Before class, only pre-approved absences (EXCUSED) make sense.
  if (session.startsAt > new Date() && records.some((r) => r.status !== "EXCUSED")) {
    throw badRequest("Before a session starts, students can only be marked EXCUSED");
  }

  const enrolled = await db.enrolment.findMany({
    where: { courseId: session.courseId, studentId: { in: records.map((r) => r.studentId) } },
    select: { studentId: true },
  });
  const enrolledIds = new Set(enrolled.map((e) => e.studentId));
  const notEnrolled = records.filter((r) => !enrolledIds.has(r.studentId)).map((r) => r.studentId);
  if (notEnrolled.length) throw badRequest(`Not enrolled in ${session.course.code}: ${notEnrolled.join(", ")}`);

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.attendanceRecord.findMany({ where: { sessionId: id, studentId: { in: records.map((r) => r.studentId) } } });
    const before = new Map(existing.map((e) => [e.studentId, e.status]));
    const changes: { studentId: string; from: string | null; to: string }[] = [];

    for (const r of records) {
      const from = before.get(r.studentId) ?? null;
      if (from === r.status) continue; // nothing to change
      await tx.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId: id, studentId: r.studentId } },
        create: { sessionId: id, studentId: r.studentId, status: r.status, method: "MANUAL", recordedById: user.id },
        update: { status: r.status, method: "MANUAL", recordedById: user.id, recordedAt: new Date() },
      });
      changes.push({ studentId: r.studentId, from, to: r.status });
    }

    if (changes.length) {
      await audit({ action: "attendance.mark", actorId: user.id, entityType: "ClassSession", entityId: id, metadata: { changes }, ip: req.ip }, tx);
    }
    return {
      created: changes.filter((c) => c.from === null).length,
      updated: changes.filter((c) => c.from !== null).length,
      unchanged: records.length - changes.length,
    };
  });

  res.json(result);
});

// After class: everyone enrolled who has no record yet is marked ABSENT.
attendanceRouter.post("/sessions/:id/attendance/mark-absent", authenticate, async (req, res) => {
  const user = currentUser(req);
  const { id } = idParam.parse(req.params);
  const session = await findManagedSession(id, user);

  if (session.startsAt > new Date()) throw badRequest("This session hasn't started yet");
  if (isOpen(session)) throw conflict("Close check-in first, so nobody still scanning is marked absent");

  const missing = await db.enrolment.findMany({
    where: { courseId: session.courseId, student: { attendance: { none: { sessionId: id } } } },
    select: { studentId: true },
  });

  const { count } = await db.attendanceRecord.createMany({
    data: missing.map((m) => ({ sessionId: id, studentId: m.studentId, status: "ABSENT" as const, method: "MANUAL" as const, recordedById: user.id })),
    skipDuplicates: true, // someone recorded in the meantime keeps their record
  });
  if (count) {
    await audit({ action: "attendance.mark_absent", actorId: user.id, entityType: "ClassSession", entityId: id, metadata: { markedAbsent: count }, ip: req.ip });
  }
  res.json({ markedAbsent: count });
});
