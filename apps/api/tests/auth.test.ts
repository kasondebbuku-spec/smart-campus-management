import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { bearer, createUser, hasTestDb, PASSWORD, refreshCookie, resetDb, signIn } from "./helpers.js";

describe.skipIf(!hasTestDb)("auth", () => {
  const app = createApp();
  beforeEach(resetDb);

  describe("login", () => {
    it("returns an access token, the user and an httpOnly refresh cookie", async () => {
      const user = await createUser("STUDENT");
      const { res } = await signIn(user.email);

      expect(res.body.accessToken).toBeTypeOf("string");
      expect(res.body.user).toMatchObject({ id: user.id, role: "STUDENT" });
      expect(res.body.user.passwordHash).toBeUndefined();
      const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("refresh_token="))!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    });

    it("gives the same answer for a wrong password and an unknown email", async () => {
      const user = await createUser("STUDENT");
      const wrongPassword = await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "nope" });
      const unknownEmail = await request(app).post("/api/v1/auth/login").send({ email: "nobody@campus.test", password: "nope" });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });

    it("records failed attempts in the audit log", async () => {
      const user = await createUser("STUDENT");
      await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "nope" });

      const log = await db.auditLog.findFirst({ where: { action: "auth.login_failed" } });
      expect(log?.actorId).toBe(user.id);
      expect(log?.metadata).toMatchObject({ reason: "bad_password" });
    });

    it("refuses deactivated accounts", async () => {
      const user = await createUser("STUDENT", { isActive: false });
      await request(app).post("/api/v1/auth/login").send({ email: user.email, password: PASSWORD }).expect(401);
    });

    it("is case-insensitive about the email", async () => {
      const user = await createUser("ADMIN");
      await request(app).post("/api/v1/auth/login").send({ email: user.email.toUpperCase(), password: PASSWORD }).expect(200);
    });

    it("validates the body", async () => {
      const res = await request(app).post("/api/v1/auth/login").send({ email: "not-an-email" }).expect(400);
      expect(res.body.error.code).toBe("validation_error");
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["email", "password"]));
    });

    it("rate-limits repeated attempts from one address", async () => {
      const limited = createApp({ loginRateLimit: 3 });
      for (let i = 0; i < 3; i++) await request(limited).post("/api/v1/auth/login").send({ email: "x@campus.test", password: "nope" }).expect(401);
      const blocked = await request(limited).post("/api/v1/auth/login").send({ email: "x@campus.test", password: "nope" });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("too_many_requests");
    });
  });

  describe("/me", () => {
    it("requires a token", async () => {
      await request(app).get("/api/v1/auth/me").expect(401);
    });

    it("returns the signed-in user's profile", async () => {
      const user = await createUser("LECTURER");
      const { token } = await signIn(user.email, app);
      const res = await request(app).get("/api/v1/auth/me").set(bearer(token)).expect(200);
      expect(res.body).toMatchObject({ id: user.id, role: "LECTURER", lecturer: { staffNumber: user.lecturer!.staffNumber } });
    });
  });

  describe("refresh token rotation", () => {
    it("swaps the refresh token for a new one", async () => {
      const user = await createUser("STUDENT");
      const { agent, res: loginRes } = await signIn(user.email, app);

      const res = await agent.post("/api/v1/auth/refresh").expect(200);
      expect(res.body.accessToken).toBeTypeOf("string");
      expect(refreshCookie(res)).toBeDefined();
      expect(refreshCookie(res)).not.toBe(refreshCookie(loginRes));
    });

    it("treats reuse of an old refresh token as theft and ends the whole session", async () => {
      const user = await createUser("STUDENT");
      const { agent, res: loginRes } = await signIn(user.email, app);
      const stolen = refreshCookie(loginRes)!;

      await agent.post("/api/v1/auth/refresh").expect(200); // the real user refreshes

      // The attacker replays the old token: rejected, and the family is revoked...
      await request(app).post("/api/v1/auth/refresh").set("Cookie", stolen).expect(401);
      // ...so the real user's current token stops working too.
      await agent.post("/api/v1/auth/refresh").expect(401);

      // One theft alert, not one per rejected request afterwards.
      expect(await db.auditLog.count({ where: { action: "auth.refresh_reuse_detected", actorId: user.id } })).toBe(1);
      expect(await db.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    });

    it("only lets one of two simultaneous refreshes succeed", async () => {
      const user = await createUser("STUDENT");
      const { res: loginRes } = await signIn(user.email, app);
      const cookie = refreshCookie(loginRes)!;

      const results = await Promise.all([
        request(app).post("/api/v1/auth/refresh").set("Cookie", cookie),
        request(app).post("/api/v1/auth/refresh").set("Cookie", cookie),
      ]);
      expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    });

    it("rejects a missing or unknown refresh token", async () => {
      await request(app).post("/api/v1/auth/refresh").expect(401);
      await request(app).post("/api/v1/auth/refresh").set("Cookie", "refresh_token=made-up").expect(401);
    });

    it("rejects an expired refresh token", async () => {
      const user = await createUser("STUDENT");
      const { agent } = await signIn(user.email, app);
      await db.refreshToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await agent.post("/api/v1/auth/refresh").expect(401);
    });
  });

  describe("logout", () => {
    it("revokes the refresh token and clears the cookie", async () => {
      const user = await createUser("STUDENT");
      const { agent, res: loginRes } = await signIn(user.email, app);
      const cookie = refreshCookie(loginRes)!;

      await agent.post("/api/v1/auth/logout").expect(204);
      await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie).expect(401);
      // Using a logged-out token is not reported as theft.
      expect(await db.auditLog.count({ where: { action: "auth.refresh_reuse_detected" } })).toBe(0);
    });
  });
});
