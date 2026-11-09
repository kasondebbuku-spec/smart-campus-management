import bcrypt from "bcryptjs";
import request from "supertest";
import type { Role } from "@prisma/client";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export const PASSWORD = "correct-horse-battery";
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

export async function resetDb() {
  await db.$executeRawUnsafe(
    `TRUNCATE "AttendanceRecord", "ClassSession", "Enrolment", "Course", "Student", "Lecturer", "RefreshToken", "AuditLog", "User" CASCADE`,
  );
}

let n = 0;
export async function createUser(role: Role, overrides: { isActive?: boolean } = {}) {
  n++;
  return db.user.create({
    data: {
      email: `${role.toLowerCase()}${n}@campus.test`,
      passwordHash,
      role,
      firstName: role[0] + role.slice(1).toLowerCase(),
      lastName: `Number${n}`,
      isActive: overrides.isActive ?? true,
      student: role === "STUDENT" ? { create: { studentNumber: String(20240000 + n), programme: "BSc Computer Science", yearOfStudy: 2 } } : undefined,
      lecturer: role === "LECTURER" ? { create: { staffNumber: `STF${n}`, department: "Computer Science" } } : undefined,
    },
    include: { student: true, lecturer: true },
  });
}

// Signs in and returns a supertest agent (which keeps the refresh cookie) and the access token.
export async function signIn(email: string, app = createApp()) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
  return { agent, token: res.body.accessToken as string, res };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export function refreshCookie(res: request.Response): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith("refresh_token="))?.split(";")[0];
}
