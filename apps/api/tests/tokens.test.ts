import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashToken, newRefreshToken, signAccessToken, verifyAccessToken } from "../src/lib/tokens.js";

afterEach(() => vi.useRealTimers());

describe("access tokens", () => {
  it("round-trips the user id and role", () => {
    const token = signAccessToken({ sub: "user_1", role: "LECTURER" });
    expect(verifyAccessToken(token)).toEqual({ sub: "user_1", role: "LECTURER" });
  });

  it("rejects a token whose payload was edited", () => {
    const token = signAccessToken({ sub: "user_1", role: "STUDENT" });
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "user_1", role: "ADMIN", iss: "smart-campus-api" })).toString("base64url");
    expect(verifyAccessToken(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = jwt.sign({ role: "ADMIN" }, "some-other-secret-that-is-long-enough!!", { subject: "user_1", issuer: "smart-campus-api" });
    expect(verifyAccessToken(token)).toBeNull();
  });

  it("rejects an unsigned token (alg: none)", () => {
    const token = jwt.sign({ role: "ADMIN" }, "", { algorithm: "none", subject: "user_1", issuer: "smart-campus-api" });
    expect(verifyAccessToken(token)).toBeNull();
  });

  it("expires after 15 minutes", () => {
    vi.useFakeTimers();
    const token = signAccessToken({ sub: "user_1", role: "STUDENT" });
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(verifyAccessToken(token)).not.toBeNull();
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(verifyAccessToken(token)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyAccessToken("not-a-token")).toBeNull();
  });
});

describe("refresh tokens", () => {
  it("are long, random and URL-safe", () => {
    const tokens = new Set(Array.from({ length: 500 }, newRefreshToken));
    expect(tokens.size).toBe(500);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  it("are stored as a SHA-256 hash", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
