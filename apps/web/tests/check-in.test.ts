import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api";
import { outcomeFromError, outcomeFromResponse, tokenFromSearch } from "../src/lib/check-in";
import { safeNextPath } from "../src/lib/redirect";

describe("reading the code from a scanned link", () => {
  it("finds the token", () => {
    expect(tokenFromSearch("?t=clx1.59383200.abc")).toBe("clx1.59383200.abc");
  });

  it("decodes characters the QR link encoded", () => {
    expect(tokenFromSearch("?t=a%2Bb%2Fc")).toBe("a+b/c");
  });

  it("returns null when there's no code", () => {
    expect(tokenFromSearch("")).toBeNull();
    expect(tokenFromSearch("?t=")).toBeNull();
    expect(tokenFromSearch("?t=%20%20")).toBeNull();
  });
});

describe("a signed-out student who scans", () => {
  it("keeps the code through the sign-in redirect", () => {
    // RequireAuth sends them to /login?next=<path + query>; the login page reads it back.
    const next = new URLSearchParams(`next=${encodeURIComponent("/check-in?t=clx1.59383200.abc")}`).get("next");
    expect(safeNextPath(next)).toBe("/check-in?t=clx1.59383200.abc");
  });
});

describe("what the student sees", () => {
  const err = (status: number, message: string) => new ApiError(status, "x", message);

  it("success, on time or late", () => {
    expect(outcomeFromResponse({ alreadyCheckedIn: false, status: "LATE", course: "CSC3011", recordedAt: "2026-11-10T19:02:00Z" })).toEqual({
      kind: "success",
      status: "LATE",
      course: "CSC3011",
      recordedAt: "2026-11-10T19:02:00Z",
      already: false,
    });
  });

  it("an expired code says to scan again", () => {
    const o = outcomeFromError(err(400, "This QR code has expired. Scan the code on the screen again."));
    expect(o).toMatchObject({ kind: "problem", title: "That code has expired", tryAgain: true });
  });

  it("a forged or mistyped code", () => {
    expect(outcomeFromError(err(400, "This isn't a valid check-in code"))).toMatchObject({ title: "That isn't a check-in code" });
  });

  it("not enrolled names the course and who to ask", () => {
    const o = outcomeFromError(err(403, "You're not enrolled in CSC3011"));
    expect(o).toMatchObject({ title: "You're not on this class list", tryAgain: false });
    expect(o.kind === "problem" && o.detail).toContain("CSC3011");
  });

  it("staff accounts", () => {
    expect(outcomeFromError(err(403, "You do not have permission to do that"))).toMatchObject({ title: "Only students check in" });
  });

  it("closed check-in", () => {
    expect(outcomeFromError(err(409, "Check-in for CSC3011 is closed"))).toMatchObject({ title: "Check-in is closed", tryAgain: false });
  });

  it("no connection", () => {
    expect(outcomeFromError(new TypeError("Failed to fetch"))).toMatchObject({ title: "No connection", tryAgain: true });
  });
});
