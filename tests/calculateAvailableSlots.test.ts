import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateAvailableSlots,
  type CalculateSlotsParams,
} from "../lib/calculateAvailableSlots";

const defaultParams: CalculateSlotsParams = {
  date: new Date("2030-01-15T00:00:00.000Z"),
  businessHours: { start: "09:00", end: "11:00" },
  serviceDuration: 30,
  slotIntervalMinutes: 30,
  existingBookings: [],
  manualBlockouts: [],
};

describe("calculateAvailableSlots", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates slots inside business hours and excludes starts that cannot fit", () => {
    expect(calculateAvailableSlots(defaultParams)).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ]);
  });

  it("rounds the occupied slot duration up to the configured interval", () => {
    expect(
      calculateAvailableSlots({
        ...defaultParams,
        serviceDuration: 40,
        slotIntervalMinutes: 30,
        businessHours: { start: "09:00", end: "11:00" },
      }),
    ).toEqual(["09:00", "09:30", "10:00"]);
  });

  it("excludes overlaps but permits adjacent bookings", () => {
    expect(
      calculateAvailableSlots({
        ...defaultParams,
        existingBookings: [
          { id: "1", start: "09:30", end: "10:00", status: "confirmed" },
        ],
        manualBlockouts: [{ start: "10:30", end: "11:00" }],
      }),
    ).toEqual(["09:00", "10:00"]);
  });

  it("only blocks pending bookings while their lock is active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-15T08:00:00.000Z"));

    expect(
      calculateAvailableSlots({
        ...defaultParams,
        existingBookings: [
          {
            id: "active",
            start: "09:00",
            end: "09:30",
            status: "pending",
            lockedUntil: new Date("2030-01-15T08:01:00.000Z"),
          },
          {
            id: "expired",
            start: "09:30",
            end: "10:00",
            status: "pending",
            lockedUntil: new Date("2030-01-15T07:59:00.000Z"),
          },
          { id: "cancelled", start: "10:00", end: "10:30", status: "cancelled" },
        ],
      }),
    ).toEqual(["09:30", "10:00", "10:30"]);
  });

  it.each([
    [0, 30],
    [-1, 30],
    [1.5, 30],
  ])("rejects invalid service duration %s", (serviceDuration, slotIntervalMinutes) => {
    expect(() =>
      calculateAvailableSlots({
        ...defaultParams,
        serviceDuration,
        slotIntervalMinutes,
      }),
    ).toThrow(RangeError);
  });

  it.each([0, -5, 2.5])("rejects invalid interval %s", (slotIntervalMinutes) => {
    expect(() =>
      calculateAvailableSlots({ ...defaultParams, slotIntervalMinutes }),
    ).toThrow(RangeError);
  });
});
