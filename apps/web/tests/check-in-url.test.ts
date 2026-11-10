import { describe, expect, it } from "vitest";
import { checkInUrl } from "../src/components/QrDisplay";

describe("check-in QR link", () => {
  it("points at this site's check-in page with the token", () => {
    expect(checkInUrl("https://campus.example", "clx1.59383200.abcDEF_-12")).toBe("https://campus.example/check-in?t=clx1.59383200.abcDEF_-12");
  });

  it("round-trips the token through the URL unchanged", () => {
    const token = "clx1.59383200.a+b/c=d";
    const url = new URL(checkInUrl("http://localhost:3100", token));
    expect(url.pathname).toBe("/check-in");
    expect(url.searchParams.get("t")).toBe(token);
  });
});
