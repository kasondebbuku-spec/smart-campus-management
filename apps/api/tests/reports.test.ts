import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { bearer, createUser, hasTestDb, resetDb, signIn } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!hasTestDb)("attendance reports", () => {
  const app = createApp();
  let admin: string, lecturer: string, otherLecturer: string, goodStudent: string, poorStudent: string;
  let courseId: string;
  let good: string, poor: string, quiet: string; // student ids

  beforeEach(async () => {
    await resetDb();
    const [a, l, ol, s1, s2, s3] = await Promise.all([
      createUser("ADMIN"),
      createUser("LECTURER"),
      createUser("LECTURER"),
      createUser("STUDENT"),
      createUser("STUDENT"),
      createUser("STUDENT"),
    ]);
    courseId = (await db.course.create({ data: { code: "CSC3011", title: "Software Engineering", semester: "2026-S2", lecturerId: l.lecturer!.id } })).id;
    [good, poor, quiet] = [s1, s2, s3].map((u) => u.student!.id) as [string, string, string];
    await db.enrolment.createMany({ data: [good, poor, quiet].map((studentId) => ({ courseId, studentId })) });

    // Four past sessions and one in the future.
    const sessionIds: string[] = [];
    for (let i = 4; i >= 1; i--) {
      const s = await db.classSession.create({
        data: { courseId, venue: `LT${i}`, startsAt: new Date(Date.now() - i * DAY), endsAt: new Date(Date.now() - i * DAY + 2 * 3600_000) },
      });
      sessionIds.push(s.id);
    }
    const future = await db.classSession.create({
      data: { courseId, venue: "LT9", startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + DAY + 2 * 3600_000) },
    });

    // good: present at all 4. poor: present once, absent twice, one not recorded.
    // quiet: excused once, late once, present twice. A record on the future session is ignored.
    const mark = (studentId: string, i: number, status: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED") =>
      ({ studentId, sessionId: sessionIds[i]!, status, method: "MANUAL" as const });
    await db.attendanceRecord.createMany({
      data: [
        ...[0, 1, 2, 3].map((i) => mark(good, i, "PRESENT")),
        mark(poor, 0, "PRESENT"),
        mark(poor, 1, "ABSENT"),
        mark(poor, 2, "ABSENT"),
        mark(quiet, 0, "EXCUSED"),
        mark(quiet, 1, "LATE"),
        mark(quiet, 2, "PRESENT"),
        mark(quiet, 3, "PRESENT"),
        { studentId: poor, sessionId: future.id, status: "EXCUSED", method: "MANUAL" },
      ],
    });

    const tokens = await Promise.all([a, l, ol, s1, s2].map(async (u) => (await signIn(u.email, app)).token));
    [admin, lecturer, otherLecturer, goodStudent, poorStudent] = tokens as [string, string, string, string, string];
  });

  describe("course report", () => {
    it("gives each student's rate, counting only sessions that have ended, at-risk students first", async () => {
      const res = await request(app).get(`/api/v1/courses/${courseId}/report`).set(bearer(lecturer)).expect(200);

      expect(res.body).toMatchObject({ course: { code: "CSC3011" }, sessionsCounted: 4, atRisk: 1, threshold: 0.8 });
      const rows = res.body.rows.map((r: { studentId: string; rate: number; atRisk: boolean; notRecorded: number; excused: number }) => ({
        id: r.studentId,
        rate: r.rate,
        atRisk: r.atRisk,
        notRecorded: r.notRecorded,
        excused: r.excused,
      }));
      expect(rows[0]).toEqual({ id: poor, rate: 0.25, atRisk: true, notRecorded: 1, excused: 0 });
      expect(rows).toContainEqual({ id: good, rate: 1, atRisk: false, notRecorded: 0, excused: 0 });
      expect(rows).toContainEqual({ id: quiet, rate: 1, atRisk: false, notRecorded: 0, excused: 1 });
    });

    it("is for the course's lecturer and admins", async () => {
      await request(app).get(`/api/v1/courses/${courseId}/report`).set(bearer(admin)).expect(200);
      await request(app).get(`/api/v1/courses/${courseId}/report`).set(bearer(otherLecturer)).expect(404);
      await request(app).get(`/api/v1/courses/${courseId}/report`).set(bearer(goodStudent)).expect(403);
      await request(app).get(`/api/v1/courses/${courseId}/report`).expect(401);
    });
  });

  describe("CSV export", () => {
    it("downloads a spreadsheet with one row per student", async () => {
      const res = await request(app).get(`/api/v1/courses/${courseId}/report.csv`).set(bearer(lecturer)).expect(200);

      expect(res.headers["content-type"]).toMatch(/^text\/csv/);
      expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="CSC3011-attendance-\d{4}-\d{2}-\d{2}\.csv"$/);
      const lines = res.text.replace(String.fromCharCode(0xfeff), "").trim().split("\r\n");
      expect(lines[0]).toBe("Student number,First name,Last name,Sessions,Present,Late,Absent,Excused,Not recorded,Attendance rate (%),At risk");
      expect(lines).toHaveLength(4);
      expect(lines[1]).toMatch(/,4,1,0,2,0,1,25,yes$/); // the at-risk student comes first
    });

    it("records who downloaded it", async () => {
      await request(app).get(`/api/v1/courses/${courseId}/report.csv`).set(bearer(lecturer)).expect(200);
      expect(await db.auditLog.count({ where: { action: "report.export", entityId: courseId } })).toBe(1);
    });

    it("protects spreadsheet users from formulas hidden in names", async () => {
      await db.user.updateMany({ where: { student: { id: good } }, data: { firstName: "=HYPERLINK(\"http://evil\",\"x\")" } });
      const res = await request(app).get(`/api/v1/courses/${courseId}/report.csv`).set(bearer(lecturer)).expect(200);
      expect(res.text).toContain("\"'=HYPERLINK(");
      expect(res.text).not.toMatch(/,=HYPERLINK/);
    });

    it("has the same access rules as the report", async () => {
      await request(app).get(`/api/v1/courses/${courseId}/report.csv`).set(bearer(goodStudent)).expect(403);
      await request(app).get(`/api/v1/courses/${courseId}/report.csv`).set(bearer(otherLecturer)).expect(404);
    });
  });

  describe("my attendance (students)", () => {
    it("shows a student their own rate and each past session, newest first", async () => {
      const res = await request(app).get("/api/v1/me/attendance").set(bearer(poorStudent)).expect(200);

      expect(res.body).toMatchObject({ threshold: 0.8, minSessions: 3 });
      expect(res.body.courses).toHaveLength(1);
      const c = res.body.courses[0];
      expect(c).toMatchObject({ course: { code: "CSC3011" }, sessions: expect.any(Array), rate: 0.25, atRisk: true, notRecorded: 1 });
      expect(c.sessions).toHaveLength(4); // the future session isn't listed
      expect(c.sessions.map((s: { status: string | null }) => s.status)).toEqual([null, "ABSENT", "ABSENT", "PRESENT"]);
    });

    it("never includes other students' records", async () => {
      const res = await request(app).get("/api/v1/me/attendance").set(bearer(goodStudent)).expect(200);
      expect(res.body.courses[0]).toMatchObject({ rate: 1, atRisk: false });
      expect(JSON.stringify(res.body)).not.toContain(poor);
    });

    it("is for students only", async () => {
      await request(app).get("/api/v1/me/attendance").set(bearer(lecturer)).expect(403);
    });
  });
});
