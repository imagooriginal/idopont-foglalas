import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../lib/supabase/public", () => ({
  createSupabasePublicClient: () => supabase,
}));

import { GET } from "../app/api/companies/[companySlug]/slots/route";

const serviceId = "550e8400-e29b-41d4-a716-446655440000";

function request(query: string) {
  return new Request(`http://localhost/api/companies/workshop/slots?${query}`);
}

describe("available slots route", () => {
  beforeEach(() => {
    supabase.from.mockReturnValue(supabase);
    supabase.select.mockReturnValue(supabase);
    supabase.eq.mockReturnValue(supabase);
    supabase.maybeSingle.mockResolvedValue({
      data: { id: "company-1" },
      error: null,
    });
    supabase.rpc.mockResolvedValue({
      data: [{ slot_start: "2030-01-15T09:00:00+01:00" }],
      error: null,
    });
  });

  it("rejects malformed, duplicate, or impossible date parameters", async () => {
    const invalidService = await GET(
      request("serviceIds=invalid&day=2030-01-15"),
      { params: Promise.resolve({ companySlug: "workshop" }) },
    );
    const duplicateServices = await GET(
      request(`serviceIds=${serviceId},${serviceId}&day=2030-01-15`),
      { params: Promise.resolve({ companySlug: "workshop" }) },
    );
    const impossibleDate = await GET(
      request(`serviceIds=${serviceId}&day=2030-02-30`),
      { params: Promise.resolve({ companySlug: "workshop" }) },
    );

    expect(invalidService.status).toBe(400);
    expect(duplicateServices.status).toBe(400);
    expect(impossibleDate.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns available slots for a known company", async () => {
    const response = await GET(
      request(`serviceIds=${serviceId}&day=2030-01-15`),
      { params: Promise.resolve({ companySlug: "workshop" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      slots: ["2030-01-15T09:00:00+01:00"],
    });
    expect(supabase.eq).toHaveBeenCalledWith("slug", "workshop");
    expect(supabase.rpc).toHaveBeenCalledWith("list_available_slots", {
      p_company_id: "company-1",
      p_service_ids: [serviceId],
      p_day: "2030-01-15",
    });
  });

  it("returns not found when the company slug does not exist", async () => {
    supabase.maybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await GET(
      request(`serviceIds=${serviceId}&day=2030-01-15`),
      { params: Promise.resolve({ companySlug: "missing" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "A szolgáltató nem található.",
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
