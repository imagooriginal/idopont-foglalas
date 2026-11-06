import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookingWidget from "../components/BookingWidget";
import LoginForm from "../app/dashboard/login/LoginForm";
import { resetLocaleForTests } from "../lib/i18n";
import { createReminderEmailHtml } from "../lib/calendar";
import { verifyCronAuthorization, withTimeout } from "../lib/booking-emails";

const resendSendMock = vi.hoisted(() => vi.fn());

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: resendSendMock,
    };
  },
}));

const adminMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  auth: {
    admin: {
      getUserById: vi.fn(),
    },
  },
}));

const serverSupabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: {
    getUser: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("../lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => adminMock,
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: async () => serverSupabaseMock,
}));

vi.mock("../app/dashboard/actions", () => ({
  signInAction: vi.fn(),
}));

import { GET as hourlyCronGet } from "../app/api/cron/hourly/route";
import { GET as dailyCleanupGet } from "../app/api/cron/daily-cleanup/route";
import { POST as confirmPost } from "../app/api/bookings/confirm/route";

const validCronSecret = "super_secret_cron_token_1234567890";

describe("Cron Jobs (24h Reminders, Outbox Retry, GC & GDPR Retention) and One-Click Language Switcher", () => {
  beforeEach(() => {
    resetLocaleForTests();
    resendSendMock.mockReset();
    adminMock.from.mockReset();
    adminMock.rpc.mockReset();
    adminMock.auth.admin.getUserById.mockReset();
    serverSupabaseMock.rpc.mockReset();
    serverSupabaseMock.auth.getUser.mockReset();
    serverSupabaseMock.auth.signOut.mockReset();
    vi.stubEnv("CRON_SECRET", validCronSecret);
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@example.com");
  });

  afterEach(() => {
    resetLocaleForTests();
    vi.unstubAllEnvs();
  });

  describe("1. Cron Authorization & 24-Hour Reminder + Outbox Retry (/api/cron/hourly)", () => {
    it("rejects unauthorized cron requests without a matching Bearer CRON_SECRET", async () => {
      const unauthReq = new Request("http://localhost/api/cron/hourly", {
        headers: { authorization: "Bearer wrong_token_value_12345" },
      });
      expect(verifyCronAuthorization(unauthReq, validCronSecret)).toBe(false);

      const response = await hourlyCronGet(unauthReq);
      expect(response.status).toBe(401);
    });

    it("processes unsent confirmation emails (Outbox) and 24-hour reminders and flips confirmation_email_sent / reminder_sent flags", async () => {
      const updatedFlags: Array<{ id: string; values: Record<string, unknown> }> = [];
      let bookingsSelectCall = 0;

      resendSendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
      adminMock.auth.admin.getUserById.mockResolvedValue({
        data: { user: { email: "owner@example.com" } },
        error: null,
      });

      adminMock.from.mockImplementation((table: string) => {
        if (table === "bookings") {
          return {
            select: (columns: string) => {
              if (columns === "id") {
                bookingsSelectCall += 1;
                const callNum = bookingsSelectCall;
                const chain = {
                  eq: () => chain,
                  gte: () => chain,
                  gt: () => chain,
                  lte: () => chain,
                  order: () => ({
                    limit: async () => ({
                      data:
                        callNum === 1
                          ? [{ id: "booking-outbox-1" }]
                          : [{ id: "booking-reminder-1" }],
                      error: null,
                    }),
                  }),
                };
                return chain;
              }
              return {
                eq: (_col: string, id: string) => ({
                  eq: () => ({
                    single: async () => ({
                      data: {
                        id,
                        cég_id: "company-1",
                        service_id: "service-1",
                        ugyfel_nev: "Gonda Zoltán",
                        ugyfel_email: "ugyfel@example.com",
                        kezdes_ideje: "2030-01-15T10:00:00.000Z",
                        vege_ideje: "2030-01-15T11:00:00.000Z",
                        custom_fields: { rendszam: "ABC-123" },
                      },
                      error: null,
                    }),
                  }),
                }),
              };
            },
            update: (values: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => {
                updatedFlags.push({ id, values });
                return { error: null };
              },
            }),
          };
        }
        if (table === "companies") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "company-1",
                    nev: "Boti-motorszervize",
                    owner_id: "owner-1",
                    plan: "pro",
                    time_zone: "Europe/Budapest",
                    custom_booking_fields: [
                      { key: "rendszam", label: "Rendszám", type: "text", required: true },
                    ],
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
                  data: [{ service_id: "service-1", service_order: 1 }],
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
                  data: [{ id: "service-1", nev: "Olajcsere" }],
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      const response = await hourlyCronGet(
        new Request("http://localhost/api/cron/hourly", {
          headers: { authorization: `Bearer ${validCronSecret}` },
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        outboxProcessed: 1,
        outboxSent: 1,
        remindersProcessed: 1,
        remindersSent: 1,
      });

      expect(updatedFlags).toEqual([
        expect.objectContaining({
          id: "booking-outbox-1",
          values: expect.objectContaining({ confirmation_email_sent: true }),
        }),
        expect.objectContaining({
          id: "booking-reminder-1",
          values: expect.objectContaining({ reminder_sent: true }),
        }),
      ]);
    });

    it("queues confirmation email for Outbox retry if Resend times out or fails during booking confirmation", async () => {
      await expect(
        withTimeout(
          new Promise((resolvePromise) => setTimeout(resolvePromise, 200)),
          20,
          "Timed out",
        ),
      ).rejects.toThrow("Timed out");

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
        data: "booking-timeout-1",
        error: null,
      });
      adminMock.from.mockImplementation(() => {
        throw new Error("Simulated Resend / network timeout");
      });

      const response = await confirmPost(
        new Request("http://localhost/api/bookings/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lockToken: "550e8400-e29b-41d4-a716-446655440000",
            name: "Teszt Elek",
            email: "teszt@example.com",
            privacyAccepted: true,
          }),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        bookingId: "booking-timeout-1",
        emailStatus: "queued_for_retry",
      });
    });

    it("renders sanitized 24-hour reminder email HTML", () => {
      const html = createReminderEmailHtml({
        greeting: "Kedves Teszt Elek!",
        companyName: "Boti-motorszervize",
        serviceName: "Olajcsere",
        customerName: "Teszt Elek",
        start: "2030. január 15. 10:00",
        end: "2030. 01. 15. 11:00",
        googleCalendarUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE",
      });

      expect(html).toContain("Emlékeztetünk, hogy 24 órán belül esedékes");
      expect(html).toContain("Boti-motorszervize");
    });
  });

  describe("2. Daily Database Garbage Collection & Hungarian GDPR Data Retention (/api/cron/daily-cleanup)", () => {
    it("invokes run_daily_database_maintenance with Hungarian GDPR retention period (default 365 days)", async () => {
      adminMock.rpc.mockResolvedValue({
        data: {
          deleted_abandoned_locks: 4,
          deleted_orphan_users: 3,
          deleted_rate_limits: 12,
          deleted_expired_bookings: 7,
          retention_days: 365,
        },
        error: null,
      });

      const response = await dailyCleanupGet(
        new Request("http://localhost/api/cron/daily-cleanup", {
          headers: { authorization: `Bearer ${validCronSecret}` },
        }),
      );

      expect(response.status).toBe(200);
      expect(adminMock.rpc).toHaveBeenCalledWith(
        "run_daily_database_maintenance",
        { p_retention_days: 365 },
      );
      await expect(response.json()).resolves.toEqual({
        ok: true,
        maintenance: {
          deleted_abandoned_locks: 4,
          deleted_orphan_users: 3,
          deleted_rate_limits: 12,
          deleted_expired_bookings: 7,
          retention_days: 365,
        },
      });
    });

    it("defines pg_cron, garbage collection, and GDPR retention RPCs in the migration file", () => {
      const sql = readFileSync(
        resolve(
          process.cwd(),
          "supabase/migrations/20261106150000_cron_outbox_reminders_and_cleanup.sql",
        ),
        "utf8",
      );

      expect(sql).toContain("confirmation_email_sent boolean not null default false");
      expect(sql).toContain("reminder_sent boolean not null default false");
      expect(sql).toContain("create or replace function public.cleanup_abandoned_locks_and_guests()");
      expect(sql).toContain("create or replace function public.cleanup_expired_bookings_retention(");
      expect(sql).toContain("create or replace function public.run_daily_database_maintenance(");
      expect(sql).toContain("cron.schedule");
    });
  });

  describe("3. One-Click Language Switcher (HU <-> EN)", () => {
    it("switches LoginForm and BookingWidget between Hungarian and English with a single click", async () => {
      const user = userEvent.setup();
      render(
        <div>
          <LoginForm />
          <BookingWidget
            companyId="company-1"
            companyName="Minta Szerviz"
            companySlug="minta-szerviz"
            customBookingFields={[]}
            initialDay="2030-01-15"
            primaryColor="#1d4ed8"
            services={[]}
            slotIntervalMinutes={15}
            timeZone="Europe/Budapest"
          />
        </div>,
      );

      expect(screen.getByText("Online időpontfoglalás")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Bejelentkezés" })).toBeInTheDocument();

      // One click switches to English
      await user.click(screen.getByTestId("language-switcher"));

      expect(screen.getByText("Online Appointment Booking")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Continue to Time Slots" })).toBeInTheDocument();

      // Another click switches back to Hungarian
      await user.click(screen.getByTestId("language-switcher"));

      expect(screen.getByText("Online időpontfoglalás")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Bejelentkezés" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tovább az időpontokhoz" })).toBeInTheDocument();
    });
  });
});
