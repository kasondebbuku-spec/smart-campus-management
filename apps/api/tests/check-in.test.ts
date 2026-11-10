import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { currentQrToken } from "../src/lib/qr-token.js";
import { bearer, createUser, hasTestDb, resetDb, signIn } from "./helpers.js";

const MIN = 60 * 1000;

describe.skipIf(!hasTestDb)("QR check-in", () => {
  const app = createApp();
  let admin: string, lecturer: string, otherLecturer: string, student: string, student2: string, outsider: string;
  let courseId: string;
  let studentId: string;

  // A session that started `startedMinutesAgo` minutes ago and lasts 2 hours.
  const newSession = async (startedMinutesAgo = 0) =>
    (
      await db.classSession.create({
        data: {
          courseId,
          venue: `LT${Math.random().toString(36).slice(2, 6)}`,
          startsAt: new Date(Date.now() - startedMinutesAgo * MIN),
          endsAt: new Date(Date.now() - startedMinutesAgo * MIN + 120 * MIN),
        },
      })
    ).id;

  const open = (sessionId: string, token = lecturer, body: object = {}) =>
    request(app).post(`/api/v1/sessions/${sessionId}/check-in/open`).set(bearer(token)).send(body);

  const scan = (token: string, qr: string) => request(app).post("/api/v1/check-in").set(bearer(token)).send({ token: qr });

  const qrFor = async (sessionId: string) =>
    (await request(app).get(`/api/v1/sessions/${sessionId}/check-in/qr`).set(bearer(lecturer)).expect(200)).body.token as string;

  beforeEach(async () => {
    await resetDb();
    const [a, l, ol, s, s2, o] = await Promise.all([
      createUser("ADMIN"),
      createUser("LECTURER"),
      createUser("LECTURER"),
      createUser("STUDENT"),
      createUser("STUDENT"),
      createUser("STUDENT"),
    ]);
    courseId = (await db.course.create({ data: { code: "CSC3011", title: "Software Engineering", semester: "2026-S2", lecturerId: l.lecturer!.id } })).id;
    await db.enrolment.createMany({ data: [s, s2].map((u) => ({ courseId, studentId: u.student!.id })) });
    studentId = s.student!.id;

    const tokens = await Promise.all([a, l, ol, s, s2, o].map(async (u) => (await signIn(u.email, app)).token));
    [admin, lecturer, otherLecturer, student, student2, outsider] = tokens as [string, string, string, string, string, string];
  });

  describe("opening and closing", () => {
    it("opens for 15 minutes with a 10-minute grace by default", async () => {
      const id = await newSession();
      const res = await open(id).expect(200);

      const closesIn = new Date(res.body.checkInClosesAt).getTime() - Date.now();
      expect(closesIn).toBeGreaterThan(14 * MIN);
      expect(closesIn).toBeLessThanOrEqual(15 * MIN);
      const session = await db.classSession.findUniqueOrThrow({ where: { id } });
      expect(session.lateAfter!.getTime() - session.startsAt.getTime()).toBe(10 * MIN);
      expect(await db.auditLog.count({ where: { action: "attendance.check_in_open", entityId: id } })).toBe(1);
    });

    it("is only for the course's lecturer and admins", async () => {
      const id = await newSession();
      await open(id, student).expect(403);
      await open(id, otherLecturer).expect(404);
      await open(id, admin).expect(200);
    });

    it("can't be opened for a session that has ended", async () => {
      const id = await newSession(180);
      await open(id).expect(409);
    });

    it("only shows a QR code while check-in is open", async () => {
      const id = await newSession();
      await request(app).get(`/api/v1/sessions/${id}/check-in/qr`).set(bearer(lecturer)).expect(409);

      await open(id).expect(200);
      const res = await request(app).get(`/api/v1/sessions/${id}/check-in/qr`).set(bearer(lecturer)).expect(200);
      expect(res.body.token).toMatch(new RegExp(`^${id}\\.\\d+\\.`));
      expect(res.body.refreshInSeconds).toBeGreaterThan(0);
      expect(res.body.refreshInSeconds).toBeLessThanOrEqual(30);
      expect(res.body.checkedIn).toBe(0);

      await request(app).get(`/api/v1/sessions/${id}/check-in/qr`).set(bearer(student)).expect(403);
    });

    it("closing stops further check-ins", async () => {
      const id = await newSession();
      await open(id).expect(200);
      const qr = await qrFor(id);

      await request(app).post(`/api/v1/sessions/${id}/check-in/close`).set(bearer(lecturer)).expect(204);
      const res = await scan(student, qr).expect(409);
      expect(res.body.error.message).toBe("Check-in for CSC3011 is closed");
    });
  });

  describe("scanning", () => {
    it("marks an on-time student PRESENT", async () => {
      const id = await newSession(2);
      await open(id);
      const res = await scan(student, await qrFor(id)).expect(201);
      expect(res.body).toMatchObject({ alreadyCheckedIn: false, status: "PRESENT", course: "CSC3011" });

      const record = await db.attendanceRecord.findFirstOrThrow({ where: { sessionId: id } });
      expect(record).toMatchObject({ studentId, status: "PRESENT", method: "QR" });
    });

    it("marks a student LATE after the grace period", async () => {
      const id = await newSession(20);
      await open(id, lecturer, { lateAfterMinutes: 10 });
      const res = await scan(student, await qrFor(id)).expect(201);
      expect(res.body.status).toBe("LATE");
    });

    it("treats a second scan as already checked in", async () => {
      const id = await newSession();
      await open(id);
      const qr = await qrFor(id);
      await scan(student, qr).expect(201);
      const again = await scan(student, qr).expect(200);
      expect(again.body.alreadyCheckedIn).toBe(true);
      expect(await db.attendanceRecord.count({ where: { sessionId: id } })).toBe(1);
    });

    it("records one check-in when the same student scans twice at once", async () => {
      const id = await newSession();
      await open(id);
      const qr = await qrFor(id);
      const results = await Promise.all([scan(student, qr), scan(student, qr), scan(student, qr)]);
      expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      expect(await db.attendanceRecord.count({ where: { sessionId: id } })).toBe(1);
    });

    it("never overwrites what a lecturer marked by hand", async () => {
      const id = await newSession();
      await db.attendanceRecord.create({ data: { sessionId: id, studentId, status: "EXCUSED", method: "MANUAL" } });
      await open(id);
      const res = await scan(student, await qrFor(id)).expect(200);
      expect(res.body).toMatchObject({ alreadyCheckedIn: true, status: "EXCUSED" });
    });

    it("refuses students who aren't enrolled, and logs it", async () => {
      const id = await newSession();
      await open(id);
      const res = await scan(outsider, await qrFor(id)).expect(403);
      expect(res.body.error.message).toBe("You're not enrolled in CSC3011");
      expect(await db.auditLog.count({ where: { action: "attendance.check_in_rejected", entityId: id } })).toBe(1);
    });

    it("refuses forged codes, and logs them", async () => {
      const id = await newSession();
      await open(id);
      const [sid, window] = (await qrFor(id)).split(".");
      await scan(student, `${sid}.${window}.forgedforgedforgedforg`).expect(400);
      expect(await db.auditLog.count({ where: { action: "attendance.check_in_rejected" } })).toBe(1);
    });

    it("refuses an old code with a clear message", async () => {
      const id = await newSession();
      await open(id);
      const old = currentQrToken(id, Date.now() - 2 * MIN).token;
      const res = await scan(student, old).expect(400);
      expect(res.body.error.message).toMatch(/expired/);
    });

    it("is for students only", async () => {
      const id = await newSession();
      await open(id);
      await scan(lecturer, await qrFor(id)).expect(403);
    });
  });

  describe("attendance roster", () => {
    it("lists every enrolled student with their status and a summary", async () => {
      const id = await newSession();
      await open(id);
      await scan(student, await qrFor(id)).expect(201);

      const res = await request(app).get(`/api/v1/sessions/${id}/attendance`).set(bearer(lecturer)).expect(200);
      expect(res.body.session).toMatchObject({ course: "CSC3011", checkInOpen: true });
      expect(res.body.summary).toEqual({ enrolled: 2, present: 1, late: 0, absent: 0, excused: 0, notRecorded: 1 });
      expect(res.body.items.map((i: { status: string | null }) => i.status).sort()).toEqual(["PRESENT", null].sort());

      await request(app).get(`/api/v1/sessions/${id}/attendance`).set(bearer(student2)).expect(403);
    });
  });
});
