import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { authenticate, currentUser } from "../../middleware/auth.js";
import { managedCourses, visibleCourses } from "../courses/access.js";

const MAX_SESSION_HOURS = 6;

const forbiddenToManage = () => forbidden("Only the course's lecturer or an admin can change its sessions");

const timing = {
  startsAt: z.string().datetime({ offset: true }).transform((s) => new Date(s)),
  endsAt: z.string().datetime({ offset: true }).transform((s) => new Date(s)),
  venue: z.string().trim().min(2).max(120),
};

const createBody = z.object(timing);
const updateBody = z.object(timing).partial().refine((b) => Object.keys(b).length > 0, "Send at least one field to change");

const listQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const courseParam = z.object({ courseId: z.string().min(1) });
const idParam = z.object({ id: z.string().min(1) });

const sessionSelect = {
  id: true,
  courseId: true,
  startsAt: true,
  endsAt: true,
  venue: true,
  course: { select: { code: true, title: true } },
  _count: { select: { attendance: true } },
} as const;

function checkTiming(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) throw badRequest("endsAt must be after startsAt");
  if (endsAt.getTime() - startsAt.getTime() > MAX_SESSION_HOURS * 60 * 60 * 1000) {
    throw badRequest(`A session can't be longer than ${MAX_SESSION_HOURS} hours`);
  }
}

// Two time ranges overlap when each starts before the other ends.
// A session ending at 10:00 and the next starting at 10:00 do not overlap.
async function checkClashes(s: { courseId: string; startsAt: Date; endsAt: Date; venue: string }, excludeId?: string) {
  const overlapping: Prisma.ClassSessionWhereInput = {
    startsAt: { lt: s.endsAt },
    endsAt: { gt: s.startsAt },
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };

  const sameCourse = await db.classSession.findFirst({ where: { ...overlapping, courseId: s.courseId } });
  if (sameCourse) throw conflict("This course already has a session at that time");

  const sameVenue = await db.classSession.findFirst({
    where: { ...overlapping, venue: { equals: s.venue, mode: "insensitive" } },
    include: { course: { select: { code: true } } },
  });
  if (sameVenue) throw conflict(`${s.venue} is already booked for ${sameVenue.course.code} at that time`);
}

export const sessionsRouter = Router();

sessionsRouter.post("/courses/:courseId/sessions", authenticate, async (req, res) => {
  const user = currentUser(req);
  const { courseId } = courseParam.parse(req.params);
  const body = createBody.parse(req.body);

  const course = await db.course.findFirst({ where: { id: courseId, ...managedCourses(user) } });
  if (!course) {
    // A student or another lecturer who can see the course gets 403; everyone else 404.
    const visible = await db.course.findFirst({ where: { id: courseId, ...visibleCourses(user) } });
    if (visible) throw forbiddenToManage();
    throw notFound("Course not found");
  }

  checkTiming(body.startsAt, body.endsAt);
  await checkClashes({ courseId, ...body });

  const session = await db.classSession.create({ data: { courseId, ...body }, select: sessionSelect });
  await audit({ action: "session.create", actorId: user.id, entityType: "ClassSession", entityId: session.id, ip: req.ip });
  res.status(201).json(session);
});

sessionsRouter.get("/courses/:courseId/sessions", authenticate, async (req, res) => {
  const user = currentUser(req);
  const { courseId } = courseParam.parse(req.params);
  const q = listQuery.parse(req.query);

  const course = await db.course.findFirst({ where: { id: courseId, ...visibleCourses(user) } });
  if (!course) throw notFound("Course not found");

  const sessions = await db.classSession.findMany({
    where: {
      courseId,
      ...(q.from || q.to ? { startsAt: { gte: q.from ? new Date(q.from) : undefined, lt: q.to ? new Date(q.to) : undefined } } : {}),
    },
    select: sessionSelect,
    orderBy: { startsAt: "asc" },
  });
  res.json({ items: sessions });
});

sessionsRouter.get("/sessions/:id", authenticate, async (req, res) => {
  const { id } = idParam.parse(req.params);
  const session = await db.classSession.findFirst({
    where: { id, course: visibleCourses(currentUser(req)) },
    select: sessionSelect,
  });
  if (!session) throw notFound("Session not found");
  res.json(session);
});

sessionsRouter.patch("/sessions/:id", authenticate, async (req, res) => {
  const user = currentUser(req);
  const { id } = idParam.parse(req.params);
  const body = updateBody.parse(req.body);

  const existing = await findManagedSession(id, user);
  const next = {
    courseId: existing.courseId,
    startsAt: body.startsAt ?? existing.startsAt,
    endsAt: body.endsAt ?? existing.endsAt,
    venue: body.venue ?? existing.venue,
  };
  checkTiming(next.startsAt, next.endsAt);
  await checkClashes(next, id);

  const session = await db.classSession.update({ where: { id }, data: body, select: sessionSelect });
  await audit({
    action: "session.update",
    actorId: user.id,
    entityType: "ClassSession",
    entityId: id,
    metadata: { before: { startsAt: existing.startsAt.toISOString(), endsAt: existing.endsAt.toISOString(), venue: existing.venue }, changed: Object.keys(body) },
    ip: req.ip,
  });
  res.json(session);
});

// Sessions with attendance can't be deleted, so attendance history is never lost by accident.
sessionsRouter.delete("/sessions/:id", authenticate, async (req, res) => {
  const user = currentUser(req);
  const { id } = idParam.parse(req.params);
  await findManagedSession(id, user);

  if (await db.attendanceRecord.count({ where: { sessionId: id } })) {
    throw conflict("This session already has attendance records and can't be deleted");
  }
  await db.classSession.delete({ where: { id } });
  await audit({ action: "session.delete", actorId: user.id, entityType: "ClassSession", entityId: id, ip: req.ip });
  res.status(204).end();
});

async function findManagedSession(id: string, user: ReturnType<typeof currentUser>) {
  const session = await db.classSession.findFirst({ where: { id, course: managedCourses(user) } });
  if (session) return session;
  const visible = await db.classSession.findFirst({ where: { id, course: visibleCourses(user) } });
  if (visible) throw forbiddenToManage();
  throw notFound("Session not found");
}
