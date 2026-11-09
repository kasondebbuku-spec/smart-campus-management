import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { bearer, createUser, hasTestDb, resetDb, signIn } from "./helpers.js";

const MIN = 60 * 1000;

describe.skipIf(!hasTestDb)("manual attendance", () => {
  const app = createApp();
  let admin: string, lecturer: string, otherLecturer: string, studentToken: string;
  let courseId: string;
  let s1: string, s2: string, s3: string, outsiderId: string;

  // startsInMinutes < 0 means the session has already started.
  const newSession = async (startsInMinutes = -30) =>
    (
      await db.classSession.create({
        data: {
          courseId,
          venue: `LT${Math.random().toString(36).slice(2, 6)}`,
          startsAt: new Date(Date.now() + startsInMinutes * MIN),
          endsAt: new Date(Date.now() + startsInMinutes * MIN + 120 * MIN),
        },
      })
    ).id;

  const mark = (sessionId: string, records: { studentId: string; status: string }[], token = lecturer) =>
    request(app).put(`/api/v1/sessions/${sessionId}/attendance`).set(bearer(token)).send({ records });

  const statusOf = async (sessionId: string, studentId: string) =>
    (await db.attendanceRecord.findUnique({ where: { sessionId_studentId: { sessionId, studentId } } }))?.status ?? null;

  beforeEach(async () => {
    await resetDb();
    const [a, l, ol, st1, st2, st3, out] = await Promise.all([
      createUser("ADMIN"),
      createUser("LECTURER"),
      createUser("LECTURER"),
      createUser("STUDENT"),
      createUser("STUDENT"),
      createUser("STUDENT"),
      createUser("STUDENT"),
    ]);
    courseId = (await db.course.create({ data: { code: "CSC3011", title: "Software Engineering", semester: "2026-S2", lecturerId: l.lecturer!.id } })).id;
    [s1, s2, s3, outsiderId] = [st1, st2, st3, out].map((u) => u.student!.id) as [string, string, string, string];
    await db.enrolment.createMany({ data: [s1, s2, s3].map((studentId) => ({ courseId, studentId })) });

    const tokens = await Promise.all([a, l, ol, st1].map(async (u) => (await signIn(u.email, app)).token));
    [admin, lecturer, otherLecturer, studentToken] = tokens as [string, string, string, string];
  });

  describe("marking by hand", () => {
    it("records several students at once", async () => {
      const id = await newSession();
      const res = await mark(id, [
        { studentId: s1, status: "PRESENT" },
        { studentId: s2, status: "LATE" },
      ]).expect(200);

      expect(res.body).toEqual({ created: 2, updated: 0, unchanged: 0 });
      expect(await statusOf(id, s1)).toBe("PRESENT");
      expect(await statusOf(id, s2)).toBe("LATE");
      const record = await db.attendanceRecord.findFirstOrThrow({ where: { sessionId: id, studentId: s1 } });
      expect(record.method).toBe("MANUAL");
    });

    it("corrects an existing record and audits old and new status", async () => {
      const id = await newSession();
      await db.attendanceRecord.create({ data: { sessionId: id, studentId: s1, status: "ABSENT", method: "MANUAL" } });

      const res = await mark(id, [{ studentId: s1, status: "EXCUSED" }]).expect(200);
      expect(res.body).toEqual({ created: 0, updated: 1, unchanged: 0 });

      const log = await db.auditLog.findFirstOrThrow({ where: { action: "attendance.mark", entityId: id } });
      expect(log.metadata).toEqual({ changes: [{ studentId: s1, from: "ABSENT", to: "EXCUSED" }] });
    });

    it("can correct a QR check-in, and marks it as a manual change", async () => {
      const id = await newSession();
      await db.attendanceRecord.create({ data: { sessionId: id, studentId: s1, status: "LATE", method: "QR" } });
      await mark(id, [{ studentId: s1, status: "PRESENT" }]).expect(200);

      const record = await db.attendanceRecord.findFirstOrThrow({ where: { sessionId: id, studentId: s1 } });
      expect(record).toMatchObject({ status: "PRESENT", method: "MANUAL" });
    });

    it("doesn't log anything when nothing changes", async () => {
      const id = await newSession();
      await mark(id, [{ studentId: s1, status: "PRESENT" }]).expect(200);
      const res = await mark(id, [{ studentId: s1, status: "PRESENT" }]).expect(200);

      expect(res.body).toEqual({ created: 0, updated: 0, unchanged: 1 });
      expect(await db.auditLog.count({ where: { action: "attendance.mark" } })).toBe(1);
    });

    it("rejects the whole batch if any student isn't enrolled", async () => {
      const id = await newSession();
      const res = await mark(id, [
        { studentId: s1, status: "PRESENT" },
        { studentId: outsiderId, status: "PRESENT" },
      ]).expect(400);

      expect(res.body.error.message).toContain(outsiderId);
      expect(await statusOf(id, s1)).toBeNull();
    });

    it("rejects the same student twice in one batch", async () => {
      const id = await newSession();
      await mark(id, [
        { studentId: s1, status: "PRESENT" },
        { studentId: s1, status: "ABSENT" },
      ]).expect(400);
    });

    it("rejects unknown statuses", async () => {
      const id = await newSession();
      await mark(id, [{ studentId: s1, status: "SICK" }]).expect(400);
    });

    it("only allows EXCUSED before the session starts", async () => {
      const id = await newSession(60);
      const res = await mark(id, [{ studentId: s1, status: "ABSENT" }]).expect(400);
      expect(res.body.error.message).toMatch(/only be marked EXCUSED/);

      await mark(id, [{ studentId: s1, status: "EXCUSED" }]).expect(200);
    });

    it("is only for the course's lecturer and admins", async () => {
      const id = await newSession();
      const records = [{ studentId: s1, status: "PRESENT" }];
      await mark(id, records, studentToken).expect(403);
      await mark(id, records, otherLecturer).expect(404);
      await mark(id, records, admin).expect(200);
    });
  });

  describe("marking everyone else absent", () => {
    const markAbsent = (sessionId: string, token = lecturer) =>
      request(app).post(`/api/v1/sessions/${sessionId}/attendance/mark-absent`).set(bearer(token));

    it("marks only students with no record yet", async () => {
      const id = await newSession();
      await mark(id, [{ studentId: s1, status: "PRESENT" }]).expect(200);

      const res = await markAbsent(id).expect(200);
      expect(res.body).toEqual({ markedAbsent: 2 });
      expect(await statusOf(id, s1)).toBe("PRESENT");
      expect(await statusOf(id, s2)).toBe("ABSENT");
      expect(await statusOf(id, s3)).toBe("ABSENT");
    });

    it("is safe to run twice", async () => {
      const id = await newSession();
      await markAbsent(id).expect(200);
      const again = await markAbsent(id).expect(200);
      expect(again.body).toEqual({ markedAbsent: 0 });
      expect(await db.auditLog.count({ where: { action: "attendance.mark_absent" } })).toBe(1);
    });

    it("waits until check-in is closed", async () => {
      const id = await newSession();
      await request(app).post(`/api/v1/sessions/${id}/check-in/open`).set(bearer(lecturer)).send({}).expect(200);
      await markAbsent(id).expect(409);

      await request(app).post(`/api/v1/sessions/${id}/check-in/close`).set(bearer(lecturer)).expect(204);
      await markAbsent(id).expect(200);
    });

    it("can't be used before the session starts", async () => {
      const id = await newSession(60);
      await markAbsent(id).expect(400);
    });

    it("is only for the course's lecturer and admins", async () => {
      const id = await newSession();
      await markAbsent(id, studentToken).expect(403);
      await markAbsent(id, otherLecturer).expect(404);
    });

    it("shows up in the roster summary", async () => {
      const id = await newSession();
      await mark(id, [{ studentId: s1, status: "LATE" }]).expect(200);
      await markAbsent(id).expect(200);

      const res = await request(app).get(`/api/v1/sessions/${id}/attendance`).set(bearer(lecturer)).expect(200);
      expect(res.body.summary).toEqual({ enrolled: 3, present: 0, late: 1, absent: 2, excused: 0, notRecorded: 0 });
    });
  });
});
