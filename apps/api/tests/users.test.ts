import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { bearer, createUser, hasTestDb, resetDb, signIn } from "./helpers.js";

const newStudent = {
  role: "STUDENT",
  email: "Natasha.Mwila@campus.test",
  password: "a-long-enough-password",
  firstName: "Natasha",
  lastName: "Mwila",
  studentNumber: "2023000123",
  programme: "BSc Computer Science",
  yearOfStudy: 3,
};

describe.skipIf(!hasTestDb)("users (admin only)", () => {
  const app = createApp();
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    const admin = await createUser("ADMIN");
    adminToken = (await signIn(admin.email, app)).token;
  });

  it("rejects requests without a token", async () => {
    await request(app).get("/api/v1/users").expect(401);
  });

  it.each(["STUDENT", "LECTURER"] as const)("forbids %s accounts", async (role) => {
    const user = await createUser(role);
    const { token } = await signIn(user.email, app);
    await request(app).get("/api/v1/users").set(bearer(token)).expect(403);
    await request(app).post("/api/v1/users").set(bearer(token)).send(newStudent).expect(403);
  });

  it("creates a student with their profile and logs it", async () => {
    const res = await request(app).post("/api/v1/users").set(bearer(adminToken)).send(newStudent).expect(201);

    expect(res.body).toMatchObject({
      email: "natasha.mwila@campus.test",
      role: "STUDENT",
      student: { studentNumber: "2023000123", yearOfStudy: 3 },
    });
    expect(res.body.passwordHash).toBeUndefined();
    expect(await db.auditLog.count({ where: { action: "user.create", entityId: res.body.id } })).toBe(1);

    // The new student can sign in with the password the admin set.
    await request(app).post("/api/v1/auth/login").send({ email: newStudent.email, password: newStudent.password }).expect(200);
  });

  it("creates a lecturer with their profile", async () => {
    const res = await request(app)
      .post("/api/v1/users")
      .set(bearer(adminToken))
      .send({ role: "LECTURER", email: "m.phiri@campus.test", password: "a-long-enough-password", firstName: "Mutale", lastName: "Phiri", staffNumber: "STF2001", department: "Computer Science" })
      .expect(201);
    expect(res.body.lecturer).toMatchObject({ staffNumber: "STF2001" });
  });

  it("explains which fields are invalid", async () => {
    const res = await request(app)
      .post("/api/v1/users")
      .set(bearer(adminToken))
      .send({ ...newStudent, studentNumber: "12", password: "short" })
      .expect(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["studentNumber", "password"]));
  });

  it("refuses a duplicate email or student number", async () => {
    await request(app).post("/api/v1/users").set(bearer(adminToken)).send(newStudent).expect(201);
    await request(app).post("/api/v1/users").set(bearer(adminToken)).send({ ...newStudent, studentNumber: "2023000999" }).expect(409);
    await request(app).post("/api/v1/users").set(bearer(adminToken)).send({ ...newStudent, email: "other@campus.test" }).expect(409);
  });

  it("does not leave a half-created user when the profile fails", async () => {
    await request(app).post("/api/v1/users").set(bearer(adminToken)).send(newStudent).expect(201);
    await request(app).post("/api/v1/users").set(bearer(adminToken)).send({ ...newStudent, email: "other@campus.test" }).expect(409);
    expect(await db.user.count({ where: { email: "other@campus.test" } })).toBe(0);
  });

  it("lists, filters and paginates users", async () => {
    for (let i = 0; i < 3; i++) await createUser("STUDENT");
    await createUser("LECTURER");

    const res = await request(app).get("/api/v1/users?role=STUDENT&pageSize=2").set(bearer(adminToken)).expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((u: { role: string }) => u.role === "STUDENT")).toBe(true);
  });

  it("deactivating a user signs them out everywhere at once", async () => {
    const student = await createUser("STUDENT");
    const { agent, token } = await signIn(student.email, app);
    await request(app).get("/api/v1/auth/me").set(bearer(token)).expect(200);

    await request(app).post(`/api/v1/users/${student.id}/deactivate`).set(bearer(adminToken)).expect(204);

    await request(app).get("/api/v1/auth/me").set(bearer(token)).expect(401); // access token no longer accepted
    await agent.post("/api/v1/auth/refresh").expect(401); // refresh token revoked
  });
});
