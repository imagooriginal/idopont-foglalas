import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookingWidget from "../components/BookingWidget";
import LanguageSwitcher from "../components/LanguageSwitcher";
import PremiumFeaturesSection from "../app/dashboard/PremiumFeaturesSection";
import { resetLocaleForTests } from "../lib/i18n";
import { deliverBookingReminderEmail } from "../lib/booking-emails";

const resendSendMock = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: resendSendMock,
    };
  },
}));

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const adminMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  auth: {
    admin: {
      getUserById: vi.fn(),
      listUsers: vi.fn(),
      inviteUserByEmail: vi.fn(),
    },
  },
}));

const publicSupabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

const serverSupabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  auth: {
    getUser: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("../lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => adminMock,
}));

vi.mock("../lib/supabase/public", () => ({
  createSupabasePublicClient: () => publicSupabaseMock,
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: async () => serverSupabaseMock,
}));

import {
  addBlacklistEntryAction,
  createManualBookingAction,
  createTenantServiceAction,
  markBookingNoShowAction,
  saveCustomerNoteAction,
  updateTenantPlanAction,
  updateTenantServiceAction,
} from "../app/dashboard/actions";
import { POST as cancelPost } from "../app/api/bookings/cancel/route";
import { POST as confirmPost } from "../app/api/bookings/confirm/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const BOOKING_ID = "33333333-3333-4333-8333-333333333333";
const CANCEL_TOKEN = "44444444-4444-4444-8444-444444444444";
const LOCK_TOKEN = "55555555-5555-4555-8555-555555555555";

describe("Starter vs. Pro (Prémium) Tier Separation, Security & Business Features", () => {
  beforeEach(() => {
    resetLocaleForTests();
    resendSendMock.mockReset();
    revalidatePathMock.mockReset();
    adminMock.from.mockReset();
    adminMock.rpc.mockReset();
    publicSupabaseMock.rpc.mockReset();
    serverSupabaseMock.from.mockReset();
    serverSupabaseMock.rpc.mockReset();
    serverSupabaseMock.auth.getUser.mockReset();
    serverSupabaseMock.auth.signOut.mockReset();
    window.sessionStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@example.com");
  });

  afterEach(() => {
    resetLocaleForTests();
    window.sessionStorage.clear();
    vi.unstubAllEnvs();
  });

  describe("1. Superadmin Tier Switching (starter <-> pro) & Migration Structure", () => {
    it("allows Superadmin to switch a company plan between starter and pro and rejects invalid plans", async () => {
      const updatedPlans: string[] = [];
      serverSupabaseMock.auth.getUser.mockResolvedValue({
        data: { user: { id: "superadmin-1", email: "admin@platform.hu" } },
        error: null,
      });
      serverSupabaseMock.rpc.mockImplementation(async (fn: string) => {
        if (fn === "is_platform_admin") {
          return { data: true, error: null };
        }
        throw new Error(`Unexpected RPC: ${fn}`);
      });
      adminMock.from.mockImplementation((table: string) => {
        if (table === "companies") {
          return {
            update: (values: { plan: string }) => ({
              eq: async () => {
                updatedPlans.push(values.plan);
                return { error: null };
              },
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });

      // Switch to pro
      const proForm = new FormData();
      proForm.set("companyId", COMPANY_ID);
      proForm.set("plan", "pro");
      const proResult = await updateTenantPlanAction({}, proForm);
      expect(proResult.success).toBe("A csomag frissült.");
      expect(updatedPlans).toContain("pro");

      // Switch to starter
      const starterForm = new FormData();
      starterForm.set("companyId", COMPANY_ID);
      starterForm.set("plan", "starter");
      const starterResult = await updateTenantPlanAction({}, starterForm);
      expect(starterResult.success).toBe("A csomag frissült.");
      expect(updatedPlans).toContain("starter");

      // Reject invalid tier (including legacy 'free' or unknown tiers)
      const invalidForm = new FormData();
      invalidForm.set("companyId", COMPANY_ID);
      invalidForm.set("plan", "enterprise");
      const invalidResult = await updateTenantPlanAction({}, invalidForm);
      expect(invalidResult.error).toBeDefined();
    });

    it("contains idempotent SQL migration for starter/pro plans, customer_notes, company_blacklist, create_manual_booking, and cancel_booking_by_token", () => {
      const sql = readFileSync(
        resolve(
          process.cwd(),
          "supabase/migrations/20261107000000_implement_starter_pro_premium_features.sql",
        ),
        "utf8",
      );
      expect(sql).toContain("plan in ('starter', 'pro')");
      expect(sql).toContain("can_edit_prices = true");
      expect(sql).toContain("can_manage_services_advanced = true");
      expect(sql).toContain("create table if not exists public.customer_notes");
      expect(sql).toContain("create table if not exists public.company_blacklist");
      expect(sql).toContain("create or replace function public.create_manual_booking");
      expect(sql).toContain("create or replace function public.cancel_booking_by_token");
    });
  });

  describe("2. Starter vs. Pro Authorization Gating on Server Actions & Cron", () => {
    function mockTenantCompany(plan: "starter" | "pro") {
      serverSupabaseMock.auth.getUser.mockResolvedValue({
        data: { user: { id: "owner-1", email: "owner@example.com" } },
        error: null,
      });

      const companyRow = {
        id: COMPANY_ID,
        owner_id: "owner-1",
        status: "active",
        plan,
        can_edit_prices: true,
        can_manage_services_advanced: true,
      };

      serverSupabaseMock.from.mockImplementation((table: string) => {
        if (table === "companies") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: companyRow,
                  error: null,
                }),
                eq: () => ({
                  single: async () => ({
                    data: companyRow,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "services") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { display_order: 1 },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            insert: async () => ({ error: null }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: { id: SERVICE_ID },
                      error: null,
                    }),
                    maybeSingle: async () => ({
                      data: { id: SERVICE_ID },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "customer_notes") {
          return {
            upsert: async () => ({ error: null }),
          };
        }
        if (table === "company_blacklist") {
          return {
            insert: async () => ({ error: null }),
          };
        }
        if (table === "bookings") {
          return {
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: BOOKING_ID,
                        ugyfel_email: "noshow@example.com",
                        ugyfel_telefon: "+36301112222",
                      },
                      error: null,
                    }),
                    maybeSingle: async () => ({
                      data: {
                        id: BOOKING_ID,
                        ugyfel_email: "noshow@example.com",
                        ugyfel_telefon: "+36301112222",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      });
    }

    it("allows Starter (Alap) providers to manage services/prices and record manual bookings without OTP", async () => {
      mockTenantCompany("starter");
      serverSupabaseMock.rpc.mockResolvedValue({
        data: BOOKING_ID,
        error: null,
      });

      // 1. Starter provider can create a new service
      const createServiceForm = new FormData();
      createServiceForm.set("companyId", COMPANY_ID);
      createServiceForm.set("name", "Futómű állítás");
      createServiceForm.set("duration", "45");
      createServiceForm.set("price", "18000");
      createServiceForm.set("description", "Lézeres beállítás");
      const createRes = await createTenantServiceAction({}, createServiceForm);
      expect(createRes.error).toBeUndefined();
      expect(createRes.success).toBeDefined();

      // 2. Starter provider can update service price & duration
      const updateServiceForm = new FormData();
      updateServiceForm.set("companyId", COMPANY_ID);
      updateServiceForm.set("serviceId", SERVICE_ID);
      updateServiceForm.set("name", "Futómű állítás Pro");
      updateServiceForm.set("duration", "60");
      updateServiceForm.set("price", "22000");
      updateServiceForm.set("description", "Frissített ár");
      const updateRes = await updateTenantServiceAction({}, updateServiceForm);
      expect(updateRes.error).toBeUndefined();
      expect(updateRes.success).toBeDefined();

      // 3. Starter provider can record a manual phone/walk-in booking without OTP
      const manualForm = new FormData();
      manualForm.set("companyId", COMPANY_ID);
      manualForm.set("serviceId", SERVICE_ID);
      manualForm.set("customerName", "Telefonos Ügyfél");
      manualForm.set("customerPhone", "+36 30 555 6677");
      manualForm.set("customerEmail", "");
      manualForm.set("startTime", "2030-06-10T09:00:00.000Z");
      const manualRes = await createManualBookingAction({}, manualForm);
      expect(manualRes.error).toBeUndefined();
      expect(manualRes.success).toContain("kézi foglalást");
    });

    it("blocks Starter (Alap) providers from Pro-only Server Actions (Mini-CRM notes, Blacklist, No-Show) and allows Pro providers", async () => {
      // Test as Starter -> should be blocked
      mockTenantCompany("starter");

      const noteForm = new FormData();
      noteForm.set("companyId", COMPANY_ID);
      noteForm.set("customerName", "Teszt Elek");
      noteForm.set("customerEmail", "elek@example.com");
      noteForm.set("privateNote", "Belső privát megjegyzés");
      const starterNoteRes = await saveCustomerNoteAction({}, noteForm);
      expect(starterNoteRes.error).toContain("Prémium (Pro)");

      const blacklistForm = new FormData();
      blacklistForm.set("companyId", COMPANY_ID);
      blacklistForm.set("email", "bad@example.com");
      blacklistForm.set("reason", "Nem jelent meg");
      const starterBlacklistRes = await addBlacklistEntryAction({}, blacklistForm);
      expect(starterBlacklistRes.error).toContain("Prémium (Pro)");

      const noShowForm = new FormData();
      noShowForm.set("companyId", COMPANY_ID);
      noShowForm.set("bookingId", BOOKING_ID);
      const starterNoShowRes = await markBookingNoShowAction({}, noShowForm);
      expect(starterNoShowRes.error).toContain("Prémium (Pro)");

      // Test as Pro -> should succeed
      mockTenantCompany("pro");

      const proNoteRes = await saveCustomerNoteAction({}, noteForm);
      expect(proNoteRes.error).toBeUndefined();
      expect(proNoteRes.success).toContain("ügyféljegyzet");

      const proBlacklistRes = await addBlacklistEntryAction({}, blacklistForm);
      expect(proBlacklistRes.error).toBeUndefined();
      expect(proBlacklistRes.success).toContain("feketelistára");

      const proNoShowRes = await markBookingNoShowAction({}, noShowForm);
      expect(proNoShowRes.error).toBeUndefined();
      expect(proNoShowRes.success).toContain("No-Show");
    });

    it("skips 24-hour reminder email for Starter companies and sends it (with cancellation link) for Pro companies", async () => {
      let currentCompanyPlan: "starter" | "pro" = "starter";
      resendSendMock.mockResolvedValue({ data: { id: "rem-1" }, error: null });

      adminMock.from.mockImplementation((table: string) => {
        if (table === "bookings") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: BOOKING_ID,
                      cég_id: COMPANY_ID,
                      service_id: SERVICE_ID,
                      ugyfel_nev: "Kiss Péter",
                      ugyfel_email: "peter@example.com",
                      kezdes_ideje: "2030-05-20T10:00:00.000Z",
                      vege_ideje: "2030-05-20T11:00:00.000Z",
                      custom_fields: {},
                      cancellation_token: CANCEL_TOKEN,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        }
        if (table === "companies") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: COMPANY_ID,
                    nev: "Pro Szerviz",
                    owner_id: "owner-1",
                    plan: currentCompanyPlan,
                    time_zone: "Europe/Budapest",
                    custom_booking_fields: [],
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "booking_services") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [{ service_id: SERVICE_ID, service_order: 1 }],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "services") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [{ id: SERVICE_ID, nev: "Diagnosztika" }],
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      // Starter company -> skipped, no email sent via Resend
      const starterRes = await deliverBookingReminderEmail(
        adminMock as never,
        BOOKING_ID,
        {
          apiKey: "re_test_123",
          from: "noreply@example.com",
        },
      );
      expect(starterRes.sent).toBe(false);
      expect(resendSendMock).not.toHaveBeenCalled();

      // Pro company -> sent with cancellation URL
      currentCompanyPlan = "pro";
      const proRes = await deliverBookingReminderEmail(
        adminMock as never,
        BOOKING_ID,
        {
          apiKey: "re_test_123",
          from: "noreply@example.com",
        },
      );
      expect(proRes.sent).toBe(true);
      expect(resendSendMock).toHaveBeenCalledTimes(1);
      const sentPayload = resendSendMock.mock.calls[0]?.[0];
      expect(sentPayload.html).toContain(`/cancel/${CANCEL_TOKEN}`);
    });
  });

  describe("3. Customer Online Cancellation with 24-Hour Cutoff (POST /api/bookings/cancel)", () => {
    it("rejects cancellation within 24 hours of appointment start with HTTP 400 and phone contact message", async () => {
      publicSupabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message:
            "Cancellation is only allowed more than 24 hours before the appointment.",
        },
      });

      const response = await cancelPost(
        new Request("http://localhost/api/bookings/cancel", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.55",
          },
          body: JSON.stringify({ token: CANCEL_TOKEN }),
        }),
      );

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.code).toBe("WITHIN_24_HOURS");
      expect(payload.error).toContain("24 órán belüli");
    });

    it("rejects cancellation for non-Pro companies with HTTP 403", async () => {
      publicSupabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message:
            "Online cancellation is only available for Pro tier providers.",
        },
      });

      const response = await cancelPost(
        new Request("http://localhost/api/bookings/cancel", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.56",
          },
          body: JSON.stringify({ token: CANCEL_TOKEN }),
        }),
      );

      expect(response.status).toBe(403);
      const payload = await response.json();
      expect(payload.code).toBe("PRO_REQUIRED");
    });

    it("cancels booking when more than 24 hours remain and notifies the provider", async () => {
      publicSupabaseMock.rpc.mockResolvedValue({
        data: [
          {
            booking_id: BOOKING_ID,
            company_id: COMPANY_ID,
            company_name: "Pro Műhely",
            customer_name: "Lemondó Ügyfél",
            customer_email: "lemondo@example.com",
            starts_at: "2030-07-10T10:00:00.000Z",
            ends_at: "2030-07-10T11:00:00.000Z",
          },
        ],
        error: null,
      });
      resendSendMock.mockResolvedValue({ data: { id: "cancel-mail-1" }, error: null });
      adminMock.auth.admin.getUserById.mockResolvedValue({
        data: { user: { email: "owner@example.com" } },
        error: null,
      });
      adminMock.from.mockImplementation((table: string) => {
        if (table === "companies") {
          const companyData = {
            id: COMPANY_ID,
            nev: "Pro Műhely",
            owner_id: "owner-1",
            plan: "pro",
            time_zone: "Europe/Budapest",
          };
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: companyData,
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: companyData,
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      const response = await cancelPost(
        new Request("http://localhost/api/bookings/cancel", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.57",
          },
          body: JSON.stringify({ token: CANCEL_TOKEN }),
        }),
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.bookingId).toBe(BOOKING_ID);
      expect(resendSendMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("4. Blacklisted Customer Booking Rejection (POST /api/bookings/confirm)", () => {
    it("rejects blacklisted customer at booking confirmation with HTTP 403 and polite contact message", async () => {
      serverSupabaseMock.auth.getUser.mockResolvedValue({
        data: {
          user: {
            id: "user-blacklisted",
            email: "blocked@example.com",
            email_confirmed_at: "2030-01-01T00:00:00.000Z",
          },
        },
        error: null,
      });
      serverSupabaseMock.rpc.mockResolvedValue({
        data: null,
        error: { message: "Online booking is restricted for this contact." },
      });

      const response = await confirmPost(
        new Request("http://localhost/api/bookings/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lockToken: LOCK_TOKEN,
            name: "Tiltott Ügyfél",
            email: "blocked@example.com",
            phone: "+36309998877",
            privacyAccepted: true,
          }),
        }),
      );

      expect(response.status).toBe(403);
      const payload = await response.json();
      expect(payload.error).toBe(
        "Online foglalás nem elérhető, kérjük, vegye fel a kapcsolatot telefonon a szolgáltatóval.",
      );
    });
  });

  describe("5. In-App Browser (sessionStorage) State Recovery & Upsell / Bilingual UI", () => {
    it("restores active booking lock and Step 3 OTP form from sessionStorage when mobile WebView reloads", () => {
      const futureExpiry = new Date(Date.now() + 4 * 60_000).toISOString();
      window.sessionStorage.setItem(
        "booking_lock_state_boti-szerviz",
        JSON.stringify({
          lock: {
            bookingId: BOOKING_ID,
            lockToken: LOCK_TOKEN,
            lockedUntil: futureExpiry,
          },
          selectedServiceIds: [SERVICE_ID],
          bookingFields: {},
          customer: {
            name: "WebView Vendég",
            email: "webview@example.com",
            phone: "+36301234567",
          },
          privacyAccepted: true,
          emailCodeSent: true,
          emailVerified: false,
        }),
      );

      render(
        <BookingWidget
          companyId={COMPANY_ID}
          companyName="Boti Szerviz"
          companySlug="boti-szerviz"
          customBookingFields={[]}
          initialDay="2030-05-15"
          primaryColor="#2563eb"
          services={[
            {
              id: SERVICE_ID,
              nev: "Olajcsere",
              idotartam_percben: 60,
              ar: "15000",
            },
          ]}
          slotIntervalMinutes={30}
          timeZone="Europe/Budapest"
        />,
      );

      expect(
        screen.getByRole("heading", { name: "3. Személyes adatok" }),
      ).toBeInTheDocument();
      expect(screen.getByDisplayValue("webview@example.com")).toBeInTheDocument();
      expect(screen.getByLabelText("E-mail-megerősítő kód")).toBeInTheDocument();
    });

    it("renders the Starter plan visual lock Upsell badge and switches between HU and EN", async () => {
      const user = userEvent.setup();

      render(
        <div>
          <LanguageSwitcher />
          <PremiumFeaturesSection
            blacklist={[]}
            companyId={COMPANY_ID}
            customFieldsCount={0}
            customerHistory={[]}
            notes={[]}
            plan="starter"
            recentBookings={[]}
            stats={{
              confirmedCount: 12,
              expectedRevenueFt: 180000,
              cancelledOrNoShowCount: 1,
              topServiceName: "Olajcsere",
            }}
          />
        </div>,
      );

      expect(
        screen.getByText(
          "Prémium (Pro) funkció – Kérd az adminisztrátortól a csomagváltást",
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByTestId("language-switcher"));

      expect(
        screen.getByText(
          "Premium (Pro) feature – Ask the administrator to upgrade your plan",
        ),
      ).toBeInTheDocument();
    });
  });
});
