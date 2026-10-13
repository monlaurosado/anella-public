import { describe, expect, it } from "vitest";

import {
  formatDateTimeInTimeZone,
  formatDateTimeLocalInTimeZone,
  TimeZoneError,
  zonedDateTimeLocalToUtc,
} from "@/lib/time-zone";

function captureError(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }

  return undefined;
}

describe("datetime-local in an IANA time zone", () => {
  it("converts a winter Madrid wall-clock time to UTC", () => {
    expect(zonedDateTimeLocalToUtc("2026-01-15T12:30").toISOString()).toBe(
      "2026-01-15T11:30:00.000Z",
    );
  });

  it("converts a summer Madrid wall-clock time to UTC", () => {
    expect(zonedDateTimeLocalToUtc("2026-07-15T12:30").toISOString()).toBe(
      "2026-07-15T10:30:00.000Z",
    );
  });

  it("rejects a wall-clock time skipped by the spring DST change", () => {
    const error = captureError(() =>
      zonedDateTimeLocalToUtc("2026-03-29T02:30"),
    );

    expect(error).toBeInstanceOf(TimeZoneError);
    expect(error).toMatchObject({ code: "NONEXISTENT_LOCAL_TIME" });
  });

  it("rejects an autumn DST overlap unless its occurrence is explicit", () => {
    const error = captureError(() =>
      zonedDateTimeLocalToUtc("2026-10-25T02:30"),
    );

    expect(error).toBeInstanceOf(TimeZoneError);
    expect(error).toMatchObject({ code: "AMBIGUOUS_LOCAL_TIME" });
    expect(
      zonedDateTimeLocalToUtc("2026-10-25T02:30", "Europe/Madrid", {
        disambiguation: "earlier",
      }).toISOString(),
    ).toBe("2026-10-25T00:30:00.000Z");
    expect(
      zonedDateTimeLocalToUtc("2026-10-25T02:30", "Europe/Madrid", {
        disambiguation: "later",
      }).toISOString(),
    ).toBe("2026-10-25T01:30:00.000Z");
  });

  it("formats UTC instants for Spanish display and datetime-local controls", () => {
    expect(formatDateTimeInTimeZone("2026-01-15T11:30:00.000Z")).toBe(
      "15/01/2026, 12:30 CET",
    );
    expect(formatDateTimeInTimeZone("2026-07-15T10:30:00.000Z")).toBe(
      "15/07/2026, 12:30 CEST",
    );
    expect(formatDateTimeLocalInTimeZone("2026-07-15T10:30:00.000Z")).toBe(
      "2026-07-15T12:30",
    );
  });

  it("rejects invalid local dates, implicit-zone instants and time zones", () => {
    expect(
      captureError(() => zonedDateTimeLocalToUtc("2026-02-30T12:00")),
    ).toMatchObject({ code: "INVALID_DATE_TIME_LOCAL" });
    expect(
      captureError(() => formatDateTimeInTimeZone("2026-07-15T10:30")),
    ).toMatchObject({ code: "INVALID_INSTANT" });
    expect(
      captureError(() =>
        zonedDateTimeLocalToUtc("2026-07-15T12:30", "Mars/Olympus"),
      ),
    ).toMatchObject({ code: "INVALID_TIME_ZONE" });
  });
});
