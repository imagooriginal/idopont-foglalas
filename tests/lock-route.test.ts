import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../lib/supabase/public", () => ({
  createSupabasePublicClient: () => supabase,
}));

import { POST } from "../app/api/bookings/lock/route";

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const serviceId = "550e8400-e29b-41d4-a716-446655440001";

function request(body: unknown) {
  return new Request("http://localhost/api/bookings/lock", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("booking lock route", () => {
  beforeEach(() => {
    supabase.rpc.mockResolvedValue({
      data: [
        {
          booking_id: "booking-1",
          lock_token: "lock-1",
          locked_until: "2030-01-15T10:00:00.000Z",
        },
      ],
      error: null,
    });
  });

  it("returns a bad request for invalid JSON and malformed booking data", async () => {
    const malformedJson = await POST(
      new Request("http://localhost/api/bookings/lock", {
        method: "POST",
        body: "{",
      }),
    );
    const invalidData = await POST(
      request({
        companyId,
        serviceIds: [serviceId, serviceId],
        start: "2030-01-15T09:00:00Z",
        vehicleMake: "Honda",
        vehicleModel: "Civic",
        vehicleRegistration: "ABC123",
      }),
    );

    expect(malformedJson.status).toBe(400);
    expect(invalidData.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("creates a lock and normalizes its start time", async () => {
    const response = await POST(
      request({
        companyId,
        serviceIds: [serviceId],
        start: "2030-01-15T10:00:00+01:00",
        vehicleMake: "Honda",
        vehicleModel: "Civic",
        vehicleRegistration: "ABC123",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bookingId: "booking-1",
      lockToken: "lock-1",
      lockedUntil: "2030-01-15T10:00:00.000Z",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("create_booking_lock", {
      p_company_id: companyId,
      p_service_ids: [serviceId],
      p_start: "2030-01-15T09:00:00.000Z",
      p_vehicle_make: "Honda",
      p_vehicle_model: "Civic",
      p_vehicle_registration: "ABC123",
    });
  });

  it("reports unavailable times as a conflict", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "slot is no longer available" },
    });

    const response = await POST(
      request({
        companyId,
        serviceIds: [serviceId],
        start: "2030-01-15T09:00:00Z",
        vehicleMake: "Honda",
        vehicleModel: "Civic",
        vehicleRegistration: "ABC123",
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Ezt az időpontot időközben lefoglalták. Válassz másikat.",
    });
  });
});
