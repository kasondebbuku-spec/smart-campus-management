import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";
import { authenticate, currentUser, requireRole } from "../../middleware/auth.js";
import { hashPassword, revokeAllForUser } from "../auth/auth.service.js";

const base = {
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(10, "Password must be at least 10 characters"),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
};

// The body shape depends on the role: students need a student number, lecturers a staff number.
const createUserBody = z.discriminatedUnion("role", [
  z.object({ role: z.literal("ADMIN"), ...base }),
  z.object({
    role: z.literal("STUDENT"),
    ...base,
    studentNumber: z.string().trim().regex(/^\d{8,10}$/, "Student number must be 8 to 10 digits"),
    programme: z.string().trim().min(2).max(120),
    yearOfStudy: z.number().int().min(1).max(7),
  }),
  z.object({
    role: z.literal("LECTURER"),
    ...base,
    staffNumber: z.string().trim().min(3).max(20),
    department: z.string().trim().min(2).max(120),
  }),
]);

const listQuery = z.object({
  role: z.enum(["ADMIN", "LECTURER", "STUDENT"]).optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const publicUser = {
  id: true,
  email: true,
  role: true,
  firstName: true,
  lastName: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  student: { select: { id: true, studentNumber: true, programme: true, yearOfStudy: true } },
  lecturer: { select: { id: true, staffNumber: true, department: true } },
} as const;

export const usersRouter = Router();

usersRouter.use(authenticate, requireRole("ADMIN"));

usersRouter.post("/", async (req, res) => {
  const body = createUserBody.parse(req.body);
  const admin = currentUser(req);
  const passwordHash = await hashPassword(body.password);

  // The user, their profile and the audit entry are saved together or not at all.
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: body.email,
        passwordHash,
        role: body.role,
        firstName: body.firstName,
        lastName: body.lastName,
        student:
          body.role === "STUDENT"
            ? { create: { studentNumber: body.studentNumber, programme: body.programme, yearOfStudy: body.yearOfStudy } }
            : undefined,
        lecturer: body.role === "LECTURER" ? { create: { staffNumber: body.staffNumber, department: body.department } } : undefined,
      },
      select: publicUser,
    });
    await audit({ action: "user.create", actorId: admin.id, entityType: "User", entityId: created.id, metadata: { role: body.role }, ip: req.ip }, tx);
    return created;
  });

  res.status(201).json(user);
});

usersRouter.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = {
    role: q.role,
    ...(q.search
      ? {
          OR: [
            { email: { contains: q.search, mode: "insensitive" as const } },
            { firstName: { contains: q.search, mode: "insensitive" as const } },
            { lastName: { contains: q.search, mode: "insensitive" as const } },
            { student: { studentNumber: { contains: q.search } } },
          ],
        }
      : {}),
  };
  const [total, items] = await db.$transaction([
    db.user.count({ where }),
    db.user.findMany({
      where,
      select: publicUser,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  res.json({ items, page: q.page, pageSize: q.pageSize, total });
});

usersRouter.get("/:id", async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.params.id }, select: publicUser });
  if (!user) throw notFound("User not found");
  res.json(user);
});

// Deactivating signs the user out everywhere: their refresh tokens are revoked and
// authenticate() rejects their access token on the next request.
usersRouter.post("/:id/deactivate", async (req, res) => {
  const admin = currentUser(req);
  const user = await db.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw notFound("User not found");

  await db.user.update({ where: { id: user.id }, data: { isActive: false } });
  await revokeAllForUser(user.id);
  await audit({ action: "user.deactivate", actorId: admin.id, entityType: "User", entityId: user.id, ip: req.ip });
  res.status(204).end();
});
