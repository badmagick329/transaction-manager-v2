import { describe, expect, test } from "bun:test";
import { capEndDateToCoverage, coverageIntervalForStart, intersectCoverageIntervals, mergeCoverageIntervals } from "./data-coverage";
import { standardImportFileSchema } from "./contracts/standard-import";

describe("data coverage intervals", () => {
  test("validates optional import coverage dates", () => {
    const base = { source: { slug: "bank", name: "Bank", kind: "bank", fileName: "statement.pdf", account: { externalId: null, name: "Current", currencyCode: "GBP" } }, records: [] };
    expect(standardImportFileSchema.parse(base).source.coveragePeriods).toBeUndefined();
    expect(() => standardImportFileSchema.parse({ ...base, source: { ...base.source, coveragePeriods: [{ startDate: "2026-02-31", endDate: "2026-03-01", account: null }] } })).toThrow();
    expect(() => standardImportFileSchema.parse({ ...base, source: { ...base.source, coveragePeriods: [{ startDate: "2026-03-02", endDate: "2026-03-01", account: null }] } })).toThrow();
  });

  test("merges overlapping and adjacent periods while retaining gaps", () => {
    expect(mergeCoverageIntervals([
      { startDate: "2026-01-10", endDate: "2026-01-20" },
      { startDate: "2026-01-01", endDate: "2026-01-09" },
      { startDate: "2026-02-01", endDate: "2026-02-10" },
    ])).toEqual([
      { startDate: "2026-01-01", endDate: "2026-01-20" },
      { startDate: "2026-02-01", endDate: "2026-02-10" },
    ]);
  });

  test("intersects required-account periods and finds the interval containing a start", () => {
    const common = intersectCoverageIntervals([
      [{ startDate: "2026-01-01", endDate: "2026-03-31" }],
      [
        { startDate: "2026-01-15", endDate: "2026-02-15" },
        { startDate: "2026-03-01", endDate: "2026-04-01" },
      ],
    ]);
    expect(common).toEqual([
      { startDate: "2026-01-15", endDate: "2026-02-15" },
      { startDate: "2026-03-01", endDate: "2026-03-31" },
    ]);
    expect(coverageIntervalForStart(common, "2026-03-10")).toEqual({ startDate: "2026-03-01", endDate: "2026-03-31" });
    expect(coverageIntervalForStart(common, "2026-02-20")).toBeNull();
    expect(capEndDateToCoverage("2026-04-30", common[1])).toBe("2026-03-31");
    expect(capEndDateToCoverage("2026-03-15", common[1])).toBe("2026-03-15");
    expect(capEndDateToCoverage("", common[1])).toBe("2026-03-31");
  });
});
