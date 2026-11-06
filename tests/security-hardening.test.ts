import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig, { securityHeaders } from "../next.config";
import {
  createBookingEmailHtml,
  createIcsCalendarFile,
} from "../lib/calendar";
import {
  buildCustomBookingFieldsSchema,
  resetSecurityStateForTests,
} from "../lib/security";

const publicSupabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

const serverSupabaseMock = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    signInWithOtp: vi.fn(),
  },
  rpc: vi.fn(),
  from: vi.fn(),
}));

const adminClientFactoryMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase/public", () => ({
  createSupabasePublicClient: () => publicSupabaseMock,
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: async () => serverSupabaseMock,
}));

vi.mock("../lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => adminClientFactoryMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { POST as lockPost } from "../app/api/bookings/lock/route";
import { POST as sendOtpPost } from "../app/api/bookings/send-otp/route";
import { POST as confirmPost } from "../app/api/bookings/confirm/route";
import {
  createBlockoutAction,
  createTenantServiceAction,
  deleteTenantServiceAction,
  saveBusinessHoursAction,
  updateTenantPlanAction,
  updateTenantServiceAction,
} from "../app/dashboard/actions";

const companyA = "550e8400-e29b-41d4-a716-446655440000";
const companyB = "550e8400-e29b-41d4-a716-446655440099";
const serviceA = "550e8400-e29b-41d4-a716-446655440001";
const lockToken1 = "550e8400-e29b-41d4-a716-446655440011";
const lockToken2 = "550e8400-e29b-41d4-a716-446655440012";
const lockToken3 = "550e8400-e29b-41d4-a716-446655440013";
const lockToken4 = "550e8400-e29b-41d4-a716-446655440014";

describe("comprehensive security hardening", () => {
  beforeEach(() => {
    resetSecurityStateForTests();
    publicSupabaseMock.rpc.mockReset();
    publicSupabaseMock.from.mockReset();
    serverSupabaseMock.auth.getUser.mockReset();
    serverSupabaseMock.auth.signInWithOtp.mockReset();
    serverSupabaseMock.rpc.mockReset();
    serverSupabaseMock.from.mockReset();
    adminClientFactoryMock.mockReset();
  });

  describe("1. Slot-Lock Exhaustion & Rate Limiting", () => {
    it("limits a single client IP/session to at most 3 concurrent active booking locks", async () => {
      const tokens = [lockToken1, lockToken2, lockToken3, lockToken4];
      let callIndex = 0;
      publicSupabaseMock.rpc.mockImplementation(async () => ({
        data: [
          {
            booking_id: `booking-${callIndex + 1}`,
            lock_token: tokens[callIndex++],
            locked_until: new Date(Date.now() + 300_000).toISOString(),
          },
        ],
        error: null,
      }));
      publicSupabaseMock.from.mockReturnValue({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { custom_booking_fields: [] },
              error: null,
            }),
          }),
        }),
      });

      const makeLockRequest = () =>
        lockPost(
          new Request("http://localhost/api/bookings/lock", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-forwarded-for": "203.0.113.10",
            },
            body: JSON.stringify({
              companyId: companyA,
              serviceIds: [serviceA],
              start: "2030-01-15T09:00:00Z",
            }),
          }),
        );

      expect((await makeLockRequest()).status).toBe(200);
      expect((await makeLockRequest()).status).toBe(200);
      expect((await makeLockRequest()).status).toBe(200);

      const fourthAttempt = await makeLockRequest();
      expect(fourthAttempt.status).toBe(429);
      expect(await fourthAttempt.json()).toMatchObject({
        error: expect.stringContaining("legfeljebb 3 aktív"),
      });
    });

    it("rate-limits OTP requests per IP and per email and requires an active lock", async () => {
      serverSupabaseMock.rpc.mockResolvedValue({ data: true, error: null });
      serverSupabaseMock.auth.signInWithOtp.mockResolvedValue({ error: null });

      const sendOtp = (email: string, ip = "198.51.100.25") =>
        sendOtpPost(
          new Request("http://localhost/api/bookings/send-otp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-forwarded-for": ip,
            },
            body: JSON.stringify({ lockToken: lockToken1, email }),
          }),
        );

      expect((await sendOtp("ugyfel@example.com", "198.51.100.1")).status).toBe(200);
      expect((await sendOtp("ugyfel@example.com", "198.51.100.2")).status).toBe(200);
      expect((await sendOtp("ugyfel@example.com", "198.51.100.3")).status).toBe(200);

      const fourthForSameEmail = await sendOtp(
        "ugyfel@example.com",
        "198.51.100.4",
      );
      expect(fourthForSameEmail.status).toBe(429);
      expect(serverSupabaseMock.auth.signInWithOtp).toHaveBeenCalledTimes(3);
    });
  });

  describe("2. Dynamic custom_booking_fields server-side Zod validation", () => {
    const definitions = [
      { key: "rendszam", label: "Rendszám", type: "text" as const, required: true },
      { key: "megjegyzes", label: "Megjegyzés", type: "text" as const, required: false },
    ];

    it("accepts valid fields, trims values, and strips control characters", () => {
      const schema = buildCustomBookingFieldsSchema(definitions);
      const result = schema.parse({
        rendszam: "  ABC-123\u0000  ",
        megjegyzes: "  Sürgős  ",
      });

      expect(result).toEqual({
        rendszam: "ABC-123",
        megjegyzes: "Sürgős",
      });
    });

    it("rejects unknown field keys, missing required fields, and values over 200 chars", () => {
      const schema = buildCustomBookingFieldsSchema(definitions);

      expect(
        schema.safeParse({
          rendszam: "ABC-123",
          hacked_key: "payload",
        }).success,
      ).toBe(false);

      expect(
        schema.safeParse({
          rendszam: "   ",
        }).success,
      ).toBe(false);

      expect(
        schema.safeParse({
          rendszam: "A".repeat(201),
        }).success,
      ).toBe(false);
    });
  });

  describe("4. Multi-Tenant Isolation (IDOR) & Permission Flags in Server Actions", () => {
    it("blocks Tenant A from modifying Tenant B's services, hours, or blockouts (IDOR)", async () => {
      serverSupabaseMock.auth.getUser.mockResolvedValue({
        data: { user: { id: "user-tenant-a" } },
        error: null,
      });
      serverSupabaseMock.rpc.mockResolvedValue({ data: false, error: null });
      serverSupabaseMock.from.mockImplementation((table: string) => {
        if (table === "companies") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: companyB,
                    owner_id: "user-tenant-b",
                    can_edit_prices: true,
                    can_manage_services_advanced: true,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected query to table ${table} during IDOR attempt`);
      });

      const serviceForm = new FormData();
      serviceForm.set("companyId", companyB);
      serviceForm.set("name", "Illegális szolgáltatás");
      serviceForm.set("duration", "60");
      serviceForm.set("price", "10000");

      const createResult = await createTenantServiceAction({}, serviceForm);
      expect(createResult.error).toContain("Nincs jogosultságod");

      const blockoutForm = new FormData();
      blockoutForm.set("companyId", companyB);
      blockoutForm.set("startsAt", "2030-01-15T09:00:00.000Z");
      blockoutForm.set("endsAt", "2030-01-15T10:00:00.000Z");
      blockoutForm.set("note", "IDOR teszt");

      const blockoutResult = await createBlockoutAction({}, blockoutForm);
      expect(blockoutResult.error).toContain("Nincs jogosultságod");
    });

    it("enforces can_edit_prices and can_manage_services_advanced flags on the server", async () => {
      serverSupabaseMock.auth.getUser.mockResolvedValue({
        data: { user: { id: "owner-1" } },
        error: null,
      });
      serverSupabaseMock.from.mockImplementation((table: string) => {
        if (table === "companies") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: companyA,
                    owner_id: "owner-1",
                    can_edit_prices: false,
                    can_manage_services_advanced: false,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Table ${table} should not be updated without permission`);
      });

      const priceForm = new FormData();
      priceForm.set("companyId", companyA);
      priceForm.set("serviceId", serviceA);
      priceForm.set("price", "25000");

      const priceResult = await updateTenantServiceAction({}, priceForm);
      expect(priceResult.error).toContain(
        "Nincs jogosultságod az árak és leírások módosításához.",
      );

      const deleteForm = new FormData();
      deleteForm.set("companyId", companyA);
      deleteForm.set("serviceId", serviceA);

      const deleteResult = await deleteTenantServiceAction({}, deleteForm);
      expect(deleteResult.error).toContain(
        "Nincs jogosultságod a szolgáltatások bővített kezeléséhez.",
      );
    });

    it("never instantiates service_role admin client when non-admin calls superadmin actions", async () => {
      serverSupabaseMock.auth.getUser.mockResolvedValue({
        data: { user: { id: "regular-owner" } },
        error: null,
      });
      serverSupabaseMock.rpc.mockResolvedValue({ data: false, error: null });

      const form = new FormData();
      form.set("companyId", companyA);
      form.set("plan", "pro");

      const result = await updateTenantPlanAction({}, form);
      expect(result.error).toBe(
        "A művelethez platform-admin jogosultság szükséges.",
      );
      expect(adminClientFactoryMock).not.toHaveBeenCalled();
    });
  });

  describe("6. Email HTML & ICS Calendar Injection Protection", () => {
    it("sanitizes CRLF, control characters, semicolons, and XSS payloads in ICS and HTML", () => {
      const ics = createIcsCalendarFile({
        title: "Olajcsere\r\nATTENDEE:mailto:attacker@evil.com",
        description: "Név: <script>alert(1)</script>\r\nORGANIZER:evil;drop",
        location: "Budapest\r\nX-INJECT:true",
        start: new Date("2030-01-15T09:00:00.000Z"),
        end: new Date("2030-01-15T10:00:00.000Z"),
      });

      expect(ics).not.toContain("\r\nATTENDEE:");
      expect(ics).not.toContain("\r\nORGANIZER:");
      expect(ics).not.toContain("\r\nX-INJECT:");

      const html = createBookingEmailHtml({
        greeting: "Kedves <img src=x onerror=alert(1)>!",
        companyName: "Műhely",
        serviceName: "Szerviz",
        customerName: "<script>alert('xss')</script>",
        start: "2030. 01. 15. 10:00",
        end: "2030. 01. 15. 11:00",
        googleCalendarUrl: "javascript:alert(1)",
        extraFields: [["Rendszám", '"><svg onload=alert(1)>']],
      });

      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<svg");
      expect(html).not.toContain("javascript:alert(1)");
      expect(html).toContain("https://calendar.google.com/calendar/render");
    });
  });

  describe("7. Race Condition & Idempotency on Confirmation", () => {
    it("does not invoke admin client or send duplicate emails if atomic confirmation RPC fails", async () => {
      vi.stubEnv("RESEND_API_KEY", "re_test_key");
      vi.stubEnv("RESEND_FROM_EMAIL", "onboarding@resend.dev");

      serverSupabaseMock.auth.getUser.mockResolvedValue({
        data: {
          user: {
            email: "teszt@example.com",
            email_confirmed_at: "2030-01-15T08:00:00.000Z",
          },
        },
        error: null,
      });
      serverSupabaseMock.rpc.mockResolvedValue({
        data: null,
        error: { message: "The booking lock is invalid or has expired." },
      });

      const response = await confirmPost(
        new Request("http://localhost/api/bookings/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lockToken: lockToken1,
            name: "Teszt Elek",
            email: "teszt@example.com",
            privacyAccepted: true,
          }),
        }),
      );

      expect(response.status).toBe(409);
      expect(adminClientFactoryMock).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });
  });

  describe("8. Security HTTP Headers & Consolidated SQL Migration", () => {
    it("configures all 5 required security HTTP headers on /(.*)", async () => {
      const headersConfig = await nextConfig.headers?.();
      expect(headersConfig).toEqual([
        {
          source: "/(.*)",
          headers: securityHeaders,
        },
      ]);

      const headerMap = Object.fromEntries(
        securityHeaders.map((h) => [h.key, h.value]),
      );
      expect(headerMap["X-Frame-Options"]).toBe("DENY");
      expect(headerMap["X-Content-Type-Options"]).toBe("nosniff");
      expect(headerMap["Referrer-Policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(headerMap["Strict-Transport-Security"]).toBe(
        "max-age=31536000; includeSubDomains; preload",
      );
      expect(headerMap["Permissions-Policy"]).toBe(
        "camera=(), microphone=(), geolocation=()",
      );
    });

    it("enforces SET search_path = public, pg_temp and revokes anon access to bookings in the consolidated SQL migration", () => {
      const sql = readFileSync(
        resolve(
          process.cwd(),
          "supabase/migrations/20261106130000_comprehensive_security_hardening.sql",
        ),
        "utf8",
      );

      const securityDefinerBlocks =
        sql.match(/security definer\s+set search_path = public, pg_temp/gi) ?? [];

      expect(securityDefinerBlocks.length).toBe(23);
      expect(sql).not.toMatch(/set search_path = ''/i);
      expect(sql).toContain(
        "revoke all on public.bookings, public.booking_services, public.manual_blockouts",
      );
      expect(sql).toContain("get diagnostics v_row_count = row_count;");
    });
  });
});
