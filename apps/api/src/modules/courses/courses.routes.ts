import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { authenticate, currentUser, requireRole, type AuthUser } from "../../middleware/auth.js";

const createCourseBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}\d{4}$/, "Course code must look like CSC4630"),
  title: z.string().trim().min(3).max(160),
  semester: z.string().trim().regex(/^\d{4}-S[12]$/, "Semester must look like 2026-S2"),
  lecturerId: z.string().optional(),
});

const idParam = z.object({ id: z.string().min(1) });

const enrolBody = z.object({
  studentIds: z.array(z.string()).min(1).max(500),
});

// Which courses a user may see: admins see all, lecturers the ones they teach,
// students the ones they are enrolled in.
function visibleCourses(user: AuthUser): Prisma.CourseWhereInput {
  if (user.role === "ADMIN") return {};
  if (user.role === "LECTURER") return { lecturer: { userId: user.id } };
  return { enrolments: { some: { student: { userId: user.id } } } };
}

const courseSelect = {
  id: true,
  code: true,
  title: true,
  semester: true,
  lecturer: { select: { id: true, staffNumber: true, user: { select: { firstName: true, lastName: true } } } },
  _count: { select: { enrolments: true } },
} as const;

export const coursesRouter = Router();

coursesRouter.use(authenticate);

coursesRouter.get("/", async (req, res) => {
  const courses = await db.course.findMany({
    where: visibleCourses(currentUser(req)),
    select: courseSelect,
    orderBy: { code: "asc" },
  });
  res.json({ items: courses });
});

// A course the user can't see returns 404, not 403, so its existence isn't revealed.
coursesRouter.get("/:id", async (req, res) => {
  const course = await db.course.findFirst({
    where: { id: req.params.id, ...visibleCourses(currentUser(req)) },
    select: courseSelect,
  });
  if (!course) throw notFound("Course not found");
  res.json(course);
});

coursesRouter.post("/", requireRole("ADMIN"), async (req, res) => {
  const body = createCourseBody.parse(req.body);
  if (body.lecturerId && !(await db.lecturer.findUnique({ where: { id: body.lecturerId } }))) {
    throw badRequest("lecturerId does not match a lecturer");
  }
  const course = await db.course.create({ data: body, select: courseSelect });
  await audit({ action: "course.create", actorId: currentUser(req).id, entityType: "Course", entityId: course.id, ip: req.ip });
  res.status(201).json(course);
});

coursesRouter.post("/:id/enrolments", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { studentIds } = enrolBody.parse(req.body);
  const course = await db.course.findUnique({ where: { id } });
  if (!course) throw notFound("Course not found");

  const found = await db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true } });
  const unknown = studentIds.filter((id) => !found.some((s) => s.id === id));
  if (unknown.length) throw badRequest(`Unknown student ids: ${unknown.join(", ")}`);

  // Enrolling someone twice is harmless: existing enrolments are skipped.
  const result = await db.enrolment.createMany({
    data: studentIds.map((studentId) => ({ studentId, courseId: course.id })),
    skipDuplicates: true,
  });
  await audit({
    action: "course.enrol",
    actorId: currentUser(req).id,
    entityType: "Course",
    entityId: course.id,
    metadata: { requested: studentIds.length, added: result.count },
    ip: req.ip,
  });
  res.status(201).json({ added: result.count, alreadyEnrolled: studentIds.length - result.count });
});

// Class list: admins and the course's own lecturer only.
coursesRouter.get("/:id/students", requireRole("ADMIN", "LECTURER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const user = currentUser(req);
  const course = await db.course.findFirst({ where: { id, ...visibleCourses(user) } });
  if (!course) throw notFound("Course not found");

  const enrolments = await db.enrolment.findMany({
    where: { courseId: course.id },
    select: {
      enrolledAt: true,
      student: {
        select: { id: true, studentNumber: true, programme: true, yearOfStudy: true, user: { select: { firstName: true, lastName: true, email: true } } },
      },
    },
    orderBy: { student: { studentNumber: "asc" } },
  });
  res.json({ items: enrolments });
});
