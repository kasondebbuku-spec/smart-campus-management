import { describe, expect, it } from "vitest";
import { attendanceStats, courseReport, csvCell, toCsv } from "../src/modules/reports/stats.js";

const opts = { threshold: 0.8, minSessions: 3 };

describe("attendanceStats", () => {
  it("counts present and late as attending", () => {
    const s = attendanceStats(["PRESENT", "LATE", "ABSENT", "PRESENT"], opts);
    expect(s).toMatchObject({ sessions: 4, present: 2, late: 1, absent: 1, rate: 0.75, atRisk: true });
  });

  it("leaves excused sessions out of the rate", () => {
    // 3 attended out of 3 counted: 100%, even though 1 of 4 was excused
    expect(attendanceStats(["PRESENT", "EXCUSED", "PRESENT", "LATE"], opts)).toMatchObject({ excused: 1, rate: 1, atRisk: false });
  });

  it("counts a missing record as absent but reports it separately", () => {
    const s = attendanceStats(["PRESENT", null, "PRESENT", "PRESENT"], opts);
    expect(s).toMatchObject({ absent: 0, notRecorded: 1, rate: 0.75 });
  });

  it("doesn't flag anyone before enough sessions have happened", () => {
    expect(attendanceStats(["ABSENT", "ABSENT"], opts)).toMatchObject({ rate: 0, atRisk: false });
    expect(attendanceStats(["ABSENT", "ABSENT", "ABSENT"], opts)).toMatchObject({ rate: 0, atRisk: true });
  });

  it("treats exactly the threshold as fine", () => {
    expect(attendanceStats(["PRESENT", "PRESENT", "PRESENT", "PRESENT", "ABSENT"], opts)).toMatchObject({ rate: 0.8, atRisk: false });
  });

  it("has no rate when there's nothing to count", () => {
    expect(attendanceStats([], opts)).toMatchObject({ sessions: 0, rate: null, atRisk: false });
    expect(attendanceStats(["EXCUSED", "EXCUSED"], opts)).toMatchObject({ rate: null, atRisk: false });
  });

  it("rounds to three decimal places", () => {
    expect(attendanceStats(["PRESENT", "ABSENT", "ABSENT"], opts).rate).toBe(0.333);
  });
});

describe("courseReport", () => {
  const students = [
    { studentId: "a", studentNumber: "2023001", firstName: "Natasha", lastName: "Mwila" },
    { studentId: "b", studentNumber: "2023002", firstName: "Joseph", lastName: "Tembo" },
    { studentId: "c", studentNumber: "2023003", firstName: "Grace", lastName: "Zulu" },
  ];
  const sessions = ["s1", "s2", "s3", "s4"];
  const records = [
    ...sessions.map((sessionId) => ({ studentId: "a", sessionId, status: "PRESENT" as const })),
    { studentId: "b", sessionId: "s1", status: "PRESENT" as const },
    { studentId: "b", sessionId: "s2", status: "ABSENT" as const },
    { studentId: "b", sessionId: "s3", status: "ABSENT" as const },
    { studentId: "c", sessionId: "s1", status: "LATE" as const },
    { studentId: "c", sessionId: "s2", status: "PRESENT" as const },
    { studentId: "c", sessionId: "s3", status: "PRESENT" as const },
    // s4 for c: not recorded; and a record for a session that hasn't ended is ignored
    { studentId: "c", sessionId: "future", status: "ABSENT" as const },
  ];

  it("lists students at risk first, lowest rate first", () => {
    const r = courseReport(students, sessions, records, opts);
    expect(r.rows.map((x) => [x.studentNumber, x.rate, x.atRisk])).toEqual([
      ["2023002", 0.25, true],
      ["2023003", 0.75, true],
      ["2023001", 1, false],
    ]);
  });

  it("summarises the course", () => {
    const r = courseReport(students, sessions, records, opts);
    expect(r).toMatchObject({ sessionsCounted: 4, atRisk: 2, threshold: 0.8, averageRate: 0.667 });
    expect(r.rows.find((x) => x.studentId === "c")).toMatchObject({ notRecorded: 1, absent: 0 });
  });

  it("works before any session has ended", () => {
    const r = courseReport(students, [], records, opts);
    expect(r).toMatchObject({ sessionsCounted: 0, averageRate: null, atRisk: 0 });
    expect(r.rows.every((x) => x.rate === null)).toBe(true);
  });
});

describe("CSV export", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Mwila, "Tash"')).toBe('"Mwila, ""Tash"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("stops spreadsheet formulas from running (CSV injection)", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+260971234567")).toBe("'+260971234567");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("leaves ordinary values alone and blanks out nulls", () => {
    expect(csvCell("Grace")).toBe("Grace");
    expect(csvCell(0.75)).toBe("0.75");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(null)).toBe("");
  });

  it("builds a file with Windows line endings, which Excel expects", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });
});
