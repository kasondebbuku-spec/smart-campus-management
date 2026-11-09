import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { bearer, createUser, hasTestDb, resetDb, signIn } from "./helpers.js";

describe.skipIf(!hasTestDb)("courses", () => {
  const app = createApp();
  let admin: string, lecturerA: string, lecturerB: string, enrolled: string, notEnrolled: string;
  let courseA: { id: string }, courseB: { id: string };
  let enrolledStudentId: string;

  beforeEach(async () => {
    await resetDb();
    const [a, la, lb, s1, s2] = await Promise.all([
      createUser("ADMIN"),
      createUser("LECTURER"),
      createUser("LECTURER"),
      createUser("STUDENT"),
      createUser("STUDENT"),
    ]);
    courseA = await db.course.create({ data: { code: "CSC3011", title: "Software Engineering", semester: "2026-S2", lecturerId: la.lecturer!.id } });
    courseB = await db.course.create({ data: { code: "CSC3402", title: "Database Systems", semester: "2026-S2", lecturerId: lb.lecturer!.id } });
    await db.enrolment.create({ data: { courseId: courseA.id, studentId: s1.student!.id } });
    enrolledStudentId = s1.student!.id;

    const tokens = await Promise.all([a, la, lb, s1, s2].map(async (u) => (await signIn(u.email, app)).token));
    [admin, lecturerA, lecturerB, enrolled, notEnrolled] = tokens as [string, string, string, string, string];
  });

  const codes = (res: request.Response) => res.body.items.map((c: { code: string }) => c.code);

  it("admins see every course", async () => {
    const res = await request(app).get("/api/v1/courses").set(bearer(admin)).expect(200);
    expect(codes(res)).toEqual(["CSC3011", "CSC3402"]);
  });

  it("lecturers see only the courses they teach", async () => {
    const res = await request(app).get("/api/v1/courses").set(bearer(lecturerA)).expect(200);
    expect(codes(res)).toEqual(["CSC3011"]);
  });

  it("students see only the courses they are enrolled in", async () => {
    expect(codes(await request(app).get("/api/v1/courses").set(bearer(enrolled)))).toEqual(["CSC3011"]);
    expect(codes(await request(app).get("/api/v1/courses").set(bearer(notEnrolled)))).toEqual([]);
  });

  it("hides other courses behind a 404", async () => {
    await request(app).get(`/api/v1/courses/${courseB.id}`).set(bearer(lecturerA)).expect(404);
    await request(app).get(`/api/v1/courses/${courseA.id}`).set(bearer(notEnrolled)).expect(404);
    await request(app).get(`/api/v1/courses/${courseA.id}`).set(bearer(enrolled)).expect(200);
  });

  it("only admins create courses, with a valid code", async () => {
    const body = { code: "csc4630", title: "Mobile Application Development", semester: "2026-S2" };
    await request(app).post("/api/v1/courses").set(bearer(lecturerA)).send(body).expect(403);

    const res = await request(app).post("/api/v1/courses").set(bearer(admin)).send(body).expect(201);
    expect(res.body.code).toBe("CSC4630");

    await request(app).post("/api/v1/courses").set(bearer(admin)).send({ ...body, code: "BAD" }).expect(400);
    await request(app).post("/api/v1/courses").set(bearer(admin)).send(body).expect(409);
  });

  it("enrolling is idempotent and rejects unknown students", async () => {
    const other = await createUser("STUDENT");
    const res = await request(app)
      .post(`/api/v1/courses/${courseA.id}/enrolments`)
      .set(bearer(admin))
      .send({ studentIds: [enrolledStudentId, other.student!.id] })
      .expect(201);
    expect(res.body).toEqual({ added: 1, alreadyEnrolled: 1 });

    await request(app).post(`/api/v1/courses/${courseA.id}/enrolments`).set(bearer(admin)).send({ studentIds: ["missing"] }).expect(400);
    expect(await db.auditLog.count({ where: { action: "course.enrol", entityId: courseA.id } })).toBe(1);
  });

  it("class lists are for admins and the course's own lecturer", async () => {
    const res = await request(app).get(`/api/v1/courses/${courseA.id}/students`).set(bearer(lecturerA)).expect(200);
    expect(res.body.items).toHaveLength(1);

    await request(app).get(`/api/v1/courses/${courseA.id}/students`).set(bearer(lecturerB)).expect(404);
    await request(app).get(`/api/v1/courses/${courseA.id}/students`).set(bearer(enrolled)).expect(403);
    await request(app).get(`/api/v1/courses/${courseA.id}/students`).set(bearer(admin)).expect(200);
  });
});
