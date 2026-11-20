import { describe, expect, it } from "vitest";
import { formatRange, formatTime, lusakaDate, relative, sessionPhase, toLusakaIso } from "../src/lib/time";

describe("Lusaka time helpers", () => {
  it("shows times in Lusaka whatever the device's time zone", () => {
    // 06:00 UTC is 08:00 in Lusaka
    expect(formatTime("2026-11-16T06:00:00Z")).toBe("08:00");
    expect(formatRange("2026-11-16T06:00:00Z", "2026-11-16T08:00:00Z")).toBe("Mon 16 Nov, 08:00–10:00");
  });

  it("turns form inputs into an ISO time with the Lusaka offset", () => {
    expect(toLusakaIso("2026-11-16", "08:00")).toBe("2026-11-16T08:00:00+02:00");
    expect(new Date(toLusakaIso("2026-11-16", "08:00")).toISOString()).toBe("2026-11-16T06:00:00.000Z");
  });

  it("rejects malformed inputs", () => {
    expect(() => toLusakaIso("16/11/2026", "08:00")).toThrow();
    expect(() => toLusakaIso("2026-11-16", "8am")).toThrow();
  });

  it("gives today's date in Lusaka, even late at night UTC", () => {
    // 23:30 UTC on the 15th is already 01:30 on the 16th in Lusaka
    expect(lusakaDate(new Date("2026-11-15T23:30:00Z"))).toBe("2026-11-16");
  });

  it("describes times relative to now", () => {
    const now = Date.parse("2026-11-16T06:00:00Z");
    expect(relative("2026-11-16T06:05:00Z", now)).toBe("in 5 min");
    expect(relative("2026-11-16T05:48:00Z", now)).toBe("12 min ago");
    expect(relative("2026-11-16T08:00:00Z", now)).toBe("in 2 h");
    expect(relative("2026-11-16T06:00:20Z", now)).toBe("now");
  });

  it("knows whether a session is upcoming, in progress or over", () => {
    const s = { startsAt: "2026-11-16T06:00:00Z", endsAt: "2026-11-16T08:00:00Z" };
    expect(sessionPhase(s, Date.parse("2026-11-16T05:59:00Z"))).toBe("upcoming");
    expect(sessionPhase(s, Date.parse("2026-11-16T06:00:00Z"))).toBe("in-progress");
    expect(sessionPhase(s, Date.parse("2026-11-16T08:00:00Z"))).toBe("ended");
  });
});
