import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../lib/supabase/public", () => ({
  createSupabasePublicClient: () => supabase,
}));

vi.mock("../lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { POST } from "../app/api/bookings/confirm/route";

const lockToken = "550e8400-e29b-41d4-a716-446655440000";

function request(body: unknown) {
  return new Request("http://localhost/api/bookings/confirm", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("booking confirmation route", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    supabase.rpc.mockResolvedValue({ data: "booking-1", error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects invalid customer data without confirming the booking", async () => {
    const response = await POST(
      request({ lockToken, name: " ", email: "not-an-email" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Adj meg érvényes nevet és e-mail-címet.",
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("confirms valid customer data and reports when email is not configured", async () => {
    const response = await POST(
      request({
        lockToken,
        name: "  Teszt Elek  ",
        email: "  teszt@example.com ",
        phone: "  +3612345678  ",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bookingId: "booking-1",
      emailStatus: "not_configured",
      warning: "A foglalás sikeres, de az e-mail-küldés nincs beállítva.",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("confirm_booking", {
      p_lock_token: lockToken,
      p_customer_name: "Teszt Elek",
      p_customer_email: "teszt@example.com",
      p_customer_phone: "+3612345678",
    });
  });

  it("reports an expired or invalid lock token as a conflict", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "lock expired" },
    });

    const response = await POST(
      request({
        lockToken,
        name: "Teszt Elek",
        email: "teszt@example.com",
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "A foglalás nem véglegesíthető. Lehet, hogy lejárt az időzárolás.",
    });
  });
});
