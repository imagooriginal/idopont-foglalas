import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBookingEmailHtml,
  createGoogleCalendarUrl,
  createIcsCalendarFile,
  type CalendarEvent,
} from "../lib/calendar";

const event: CalendarEvent = {
  title: "Olajcsere, teljes",
  description: "Első sor\nMásodik; sor",
  location: "Budapest, Műhely",
  start: new Date("2030-01-15T09:00:00.000Z"),
  end: new Date("2030-01-15T10:00:00.000Z"),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calendar helpers", () => {
  it("creates a Google Calendar URL with encoded dates and optional location", () => {
    const url = new URL(createGoogleCalendarUrl(event));

    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("details")).toBe(event.description);
    expect(url.searchParams.get("dates")).toBe(
      "20300115T090000Z/20300115T100000Z",
    );
    expect(url.searchParams.get("location")).toBe(event.location);
  });

  it("omits an empty location from Google Calendar URLs", () => {
    const url = new URL(
      createGoogleCalendarUrl({ ...event, location: undefined }),
    );

    expect(url.searchParams.has("location")).toBe(false);
  });

  it("creates an escaped ICS event with a unique id and optional location", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "test-id" });

    const content = createIcsCalendarFile(event);

    expect(content).toContain("BEGIN:VCALENDAR\r\n");
    expect(content).toContain("UID:test-id@idopont-foglalo\r\n");
    expect(content).toContain("DTSTART:20300115T090000Z\r\n");
    expect(content).toContain("SUMMARY:Olajcsere\\, teljes\r\n");
    expect(content).toContain("DESCRIPTION:Első sor\\nMásodik\\; sor\r\n");
    expect(content).toContain("LOCATION:Budapest\\, Műhely\r\n");
    expect(content).toMatch(/END:VCALENDAR\r\n$/);
  });

  it("folds long ICS lines without exceeding the 75-byte limit", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "test-id" });

    const content = createIcsCalendarFile({
      ...event,
      title: "Á".repeat(80),
      location: undefined,
    });
    const summaryLines = content
      .split("\r\n")
      .filter((line) => line.startsWith("SUMMARY:") || line.startsWith(" "));

    expect(summaryLines.length).toBeGreaterThan(1);
    expect(
      summaryLines.every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
  });

  it("escapes all dynamic email content", () => {
    const html = createBookingEmailHtml({
      greeting: "<hello>",
      companyName: "A&B",
      serviceName: '"service"',
      customerName: "O'Connor",
      start: "start",
      end: "end",
      googleCalendarUrl: "https://example.test/?a=1&b=2",
    });

    expect(html).toContain("&lt;hello&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).toContain("&quot;service&quot;");
    expect(html).toContain("O&#39;Connor");
    expect(html).toContain("a=1&amp;b=2");
  });
});
