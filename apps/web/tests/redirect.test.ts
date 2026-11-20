import { describe, expect, it } from "vitest";
import { safeNextPath } from "../src/lib/redirect";

describe("safeNextPath", () => {
  it.each(["/dashboard", "/courses/abc", "/sessions/1?tab=roster"])("keeps the on-site path %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });

  it.each([
    [null, "missing"],
    ["", "empty"],
    ["dashboard", "relative"],
    ["https://evil.example", "another site"],
    ["//evil.example", "protocol-relative"],
    ["/\\evil.example", "backslash trick"],
    ["/%0d%0aSet-Cookie", "fine once encoded"],
    ["/\nevil", "control character"],
    ["/login?next=/login", "login loop"],
  ])("handles %j (%s)", (input, why) => {
    const result = safeNextPath(input);
    if (why === "fine once encoded") expect(result).toBe(input);
    else expect(result).toBe("/dashboard");
  });
});
