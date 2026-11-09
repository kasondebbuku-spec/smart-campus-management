import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { bearer, createUser, hasTestDb, resetDb, signIn } from "./helpers.js";

// Monday 9 November 2026, Lusaka time (UTC+2)
const at = (hhmm: string, day = "2026-11-09") => `${day}T${hhmm}:00+02:00`;

describe.skipIf(!hasTestDb)("class sessions", () => {
  const app = createApp();
  let admin: string, lecturerA: string, lecturerB: string, student: string, outsider: string;
  let courseA: string, courseB: string;

  beforeEach(async () => {
    await resetDb();
    const [a, la, lb, s, o] = await Promise.all([
      createUser("ADMIN"),
      createUser("LECTURER"),
      createUser("LECTURER"),
      createUser("STUDENT"),
      createUser("STUDENT"),
    ]);
    courseA = (await db.course.create({ data: { code: "CSC3011", title: "Software Engineering", semester: "2026-S2", lecturerId: la.lecturer!.id } })).id;
    courseB = (await db.course.create({ data: { code: "CSC3402", title: "Database Systems", semester: "2026-S2", lecturerId: lb.lecturer!.id } })).id;
    await db.enrolment.create({ data: { courseId: courseA, studentId: s.student!.id } });

    const tokens = await Promise.all([a, la, lb, s, o].map(async (u) => (await signIn(u.email, app)).token));
    [admin, lecturerA, lecturerB, student, outsider] = tokens as [string, string, string, string, string];
  });

  const create = (token: string, courseId: string, body: object) =>
    request(app).post(`/api/v1/courses/${courseId}/sessions`).set(bearer(token)).send(body);

  const lecture = { startsAt: at("08:00"), endsAt: at("10:00"), venue: "LT1" };

  describe("creating", () => {
    it("lets the course's lecturer schedule a session and logs it", async () => {
      const res = await create(lecturerA, courseA, lecture).expect(201);
      expect(res.body).toMatchObject({ courseId: courseA, venue: "LT1", course: { code: "CSC3011" } });
      expect(new Date(res.body.startsAt).toISOString()).toBe("2026-11-09T06:00:00.000Z");
      expect(await db.auditLog.count({ where: { action: "session.create", entityId: res.body.id } })).toBe(1);
    });

    it("lets admins schedule for any course", async () => {
      await create(admin, courseB, lecture).expect(201);
    });

    it("refuses other lecturers and students", async () => {
      await create(lecturerB, courseA, lecture).expect(404); // can't see the course at all
      await create(student, courseA, lecture).expect(403); // can see it, can't change it
      await create(outsider, courseA, lecture).expect(404);
    });

    it("validates times", async () => {
      await create(lecturerA, courseA, { ...lecture, endsAt: at("07:00") }).expect(400);
      await create(lecturerA, courseA, { ...lecture, endsAt: at("15:00") }).expect(400); // over 6 hours
      await create(lecturerA, courseA, { ...lecture, startsAt: "next monday" }).expect(400);
    });

    it("refuses a second session for the same course at an overlapping time", async () => {
      await create(lecturerA, courseA, lecture).expect(201);
      const res = await create(lecturerA, courseA, { startsAt: at("09:00"), endsAt: at("11:00"), venue: "LT2" }).expect(409);
      expect(res.body.error.message).toMatch(/already has a session/);
    });

    it("refuses to double-book a venue, whatever the course", async () => {
      await create(lecturerA, courseA, lecture).expect(201);
      const res = await create(lecturerB, courseB, { startsAt: at("09:30"), endsAt: at("11:00"), venue: "lt1" }).expect(409);
      expect(res.body.error.message).toBe("lt1 is already booked for CSC3011 at that time");
    });

    it("allows back-to-back sessions in the same venue", async () => {
      await create(lecturerA, courseA, lecture).expect(201);
      await create(lecturerB, courseB, { startsAt: at("10:00"), endsAt: at("12:00"), venue: "LT1" }).expect(201);
    });
  });

  describe("reading", () => {
    beforeEach(async () => {
      await create(lecturerA, courseA, { startsAt: at("08:00", "2026-11-16"), endsAt: at("10:00", "2026-11-16"), venue: "LT1" }).expect(201);
      await create(lecturerA, courseA, lecture).expect(201);
    });

    it("lists a course's sessions in time order for anyone who can see the course", async () => {
      for (const token of [admin, lecturerA, student]) {
        const res = await request(app).get(`/api/v1/courses/${courseA}/sessions`).set(bearer(token)).expect(200);
        expect(res.body.items.map((s: { startsAt: string }) => s.startsAt.slice(0, 10))).toEqual(["2026-11-09", "2026-11-16"]);
      }
      await request(app).get(`/api/v1/courses/${courseA}/sessions`).set(bearer(outsider)).expect(404);
    });

    it("filters by date range", async () => {
      const res = await request(app)
        .get(`/api/v1/courses/${courseA}/sessions?from=${encodeURIComponent(at("00:00", "2026-11-15"))}`)
        .set(bearer(student))
        .expect(200);
      expect(res.body.items).toHaveLength(1);
    });

    it("hides a single session from people outside the course", async () => {
      const [first] = (await request(app).get(`/api/v1/courses/${courseA}/sessions`).set(bearer(admin))).body.items;
      await request(app).get(`/api/v1/sessions/${first.id}`).set(bearer(student)).expect(200);
      await request(app).get(`/api/v1/sessions/${first.id}`).set(bearer(lecturerB)).expect(404);
    });
  });

  describe("changing and deleting", () => {
    let sessionId: string;
    beforeEach(async () => {
      sessionId = (await create(lecturerA, courseA, lecture).expect(201)).body.id;
    });

    it("moves a session and records what it was before", async () => {
      const res = await request(app).patch(`/api/v1/sessions/${sessionId}`).set(bearer(lecturerA)).send({ venue: "LT2" }).expect(200);
      expect(res.body.venue).toBe("LT2");

      const log = await db.auditLog.findFirst({ where: { action: "session.update", entityId: sessionId } });
      expect(log?.metadata).toMatchObject({ before: { venue: "LT1" }, changed: ["venue"] });
    });

    it("checks the combined times when only one end changes", async () => {
      await request(app).patch(`/api/v1/sessions/${sessionId}`).set(bearer(lecturerA)).send({ endsAt: at("07:30") }).expect(400);
    });

    it("doesn't treat a session as clashing with itself", async () => {
      await request(app).patch(`/api/v1/sessions/${sessionId}`).set(bearer(lecturerA)).send({ endsAt: at("10:30") }).expect(200);
    });

    it("refuses an empty change", async () => {
      await request(app).patch(`/api/v1/sessions/${sessionId}`).set(bearer(lecturerA)).send({}).expect(400);
    });

    it("only the course's lecturer or an admin can change or delete", async () => {
      await request(app).patch(`/api/v1/sessions/${sessionId}`).set(bearer(student)).send({ venue: "LT9" }).expect(403);
      await request(app).delete(`/api/v1/sessions/${sessionId}`).set(bearer(lecturerB)).expect(404);
      await request(app).delete(`/api/v1/sessions/${sessionId}`).set(bearer(admin)).expect(204);
    });

    it("won't delete a session that has attendance", async () => {
      const s = await db.student.findFirstOrThrow();
      await db.attendanceRecord.create({ data: { sessionId, studentId: s.id, status: "PRESENT", method: "MANUAL" } });

      await request(app).delete(`/api/v1/sessions/${sessionId}`).set(bearer(lecturerA)).expect(409);
      expect(await db.classSession.count({ where: { id: sessionId } })).toBe(1);
    });
  });
});
