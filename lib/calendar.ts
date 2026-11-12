export interface CalendarEvent {
  title: string;
  description: string;
  location?: string;
  start: Date;
  end: Date;
}

function googleDate(date: Date) {
  return date.toISOString().replace(/[-:]|\.\d{3}/g, "");
}

export function sanitizeSingleLineText(value: string) {
  return value.replace(/[\r\n\x00-\x1f\x7f]+/g, " ").trim();
}

export function escapeIcsText(value: string) {
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line: string) {
  const folded: string[] = [];
  let current = "";
  let byteLength = 0;

  for (const character of line) {
    const characterLength = new TextEncoder().encode(character).length;
    if (byteLength + characterLength > 75) {
      folded.push(current);
      current = ` ${character}`;
      byteLength = characterLength + 1;
    } else {
      current += character;
      byteLength += characterLength;
    }
  }

  folded.push(current);
  return folded.join("\r\n");
}

export function escapeHtml(value: string) {
  return value
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character];
    });
}

function sanitizeSafeHttpsUrl(url: string) {
  const cleaned = url.replace(/[\r\n\x00-\x1f\x7f]/g, "").trim();
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol === "https:") {
      return cleaned;
    }
  } catch {
    // Fall through to safe default
  }
  return "https://calendar.google.com/calendar/render";
}

function sanitizeSafeActionUrl(url: string): string | null {
  const cleaned = url.replace(/[\r\n\x00-\x1f\x7f]/g, "").trim();
  try {
    const parsed = new URL(cleaned);
    if (
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && parsed.hostname === "localhost")
    ) {
      return cleaned;
    }
  } catch {
    // Reject unsafe URL
  }
  return null;
}

export function createGoogleCalendarUrl(event: CalendarEvent) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: sanitizeSingleLineText(event.title),
    details: event.description.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""),
    dates: `${googleDate(event.start)}/${googleDate(event.end)}`,
  });

  if (event.location) {
    params.set("location", sanitizeSingleLineText(event.location));
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function createIcsCalendarFile(event: CalendarEvent) {
  const uid = `${crypto.randomUUID()}@idopont-foglalo`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Idopontfoglalo//Booking//HU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${googleDate(new Date())}`,
    `DTSTART:${googleDate(event.start)}`,
    `DTEND:${googleDate(event.end)}`,
    `SUMMARY:${escapeIcsText(sanitizeSingleLineText(event.title))}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(sanitizeSingleLineText(event.location))}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function createBookingEmailHtml({
  greeting,
  companyName,
  serviceName,
  customerName,
  start,
  end,
  googleCalendarUrl,
  extraFields = [],
  introText = "A foglalás részletei:",
  cancellationUrl,
}: {
  greeting: string;
  companyName: string;
  serviceName: string;
  customerName: string;
  start: string;
  end: string;
  googleCalendarUrl: string;
  extraFields?: Array<[string, string]>;
  introText?: string;
  cancellationUrl?: string;
}) {
  const rows: Array<[string, string]> = [
    ["Szolgáltató", sanitizeSingleLineText(companyName)],
    ["Szolgáltatás", sanitizeSingleLineText(serviceName)],
    ["Ügyfél", sanitizeSingleLineText(customerName)],
    ["Kezdés", sanitizeSingleLineText(start)],
    ["Befejezés", sanitizeSingleLineText(end)],
    ...extraFields.map(([label, value]): [string, string] => [
      sanitizeSingleLineText(label),
      sanitizeSingleLineText(value),
    ]),
  ];
  const details = rows
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:8px 12px">${escapeHtml(label)}</th><td style="padding:8px 12px">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const safeUrl = sanitizeSafeHttpsUrl(googleCalendarUrl);
  const safeIntro = escapeHtml(sanitizeSingleLineText(introText));
  const safeCancelUrl = cancellationUrl
    ? sanitizeSafeActionUrl(cancellationUrl)
    : null;
  const cancelBlock = safeCancelUrl
    ? `<p style="margin-top:16px"><a href="${escapeHtml(safeCancelUrl)}" style="display:inline-block;padding:10px 16px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-size:14px">Időpont átütemezése / Időpont lemondása</a></p><p style="font-size:12px;color:#64748b">Online átütemezés vagy lemondás a kezdés előtt legkésőbb 24 órával lehetséges.</p>`
    : "";

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h1 style="font-size:22px">${escapeHtml(sanitizeSingleLineText(greeting))}</h1><p>${safeIntro}</p><table style="border-collapse:collapse;width:100%">${details}</table><p style="margin-top:24px"><a href="${escapeHtml(safeUrl)}" style="display:inline-block;padding:12px 18px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px">Hozzáadás a Google Naptárhoz</a></p>${cancelBlock}<p style="font-size:13px;color:#526078">A naptármeghívó ICS-fájlként is csatolva van ehhez az e-mailhez.</p></div>`;
}

export function createReminderEmailHtml(params: {
  greeting: string;
  companyName: string;
  serviceName: string;
  customerName: string;
  start: string;
  end: string;
  googleCalendarUrl: string;
  extraFields?: Array<[string, string]>;
  cancellationUrl?: string;
}) {
  return createBookingEmailHtml({
    ...params,
    introText:
      "Emlékeztetünk, hogy 24 órán belül esedékes a lefoglalt időpontod. A foglalás részletei:",
  });
}

export function createGoogleReviewEmailHtml({
  customerName,
  companyName,
  serviceName,
  reviewUrl,
}: {
  customerName: string;
  companyName: string;
  serviceName: string;
  reviewUrl: string;
}) {
  const safeCustomer = escapeHtml(sanitizeSingleLineText(customerName || "Ügyfelünk"));
  const safeCompany = escapeHtml(sanitizeSingleLineText(companyName));
  const safeService = escapeHtml(sanitizeSingleLineText(serviceName));
  const safeUrl = sanitizeSafeActionUrl(reviewUrl) ?? "https://www.google.com/maps";

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h1 style="font-size:22px">Köszönjük a látogatást, ${safeCustomer}!</h1><p>Reméljük, elégedett voltál a(z) <strong>${safeCompany}</strong> által nyújtott szolgáltatással (<em>${safeService}</em>).</p><p>Véleményed sokat segít nekünk és a jövőbeli ügyfeleinknek. Kérjük, értékeld látogatásodat 1 kattintással:</p><p style="margin-top:20px"><a href="${escapeHtml(safeUrl)}" style="display:inline-block;padding:12px 20px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Értékelés írása a Google-ön ★</a></p></div>`;
}

export function createIcsCalendarFeed(
  calendarName: string,
  events: Array<CalendarEvent & { uid?: string }>,
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Idopontfoglalo//LiveCalendarFeed//HU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(sanitizeSingleLineText(calendarName))}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];

  const stamp = googleDate(new Date());
  for (const event of events) {
    const uid = event.uid ?? `${crypto.randomUUID()}@idopont-foglalo`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${googleDate(event.start)}`,
      `DTEND:${googleDate(event.end)}`,
      `SUMMARY:${escapeIcsText(sanitizeSingleLineText(event.title))}`,
      `DESCRIPTION:${escapeIcsText(event.description)}`,
    );
    if (event.location) {
      lines.push(`LOCATION:${escapeIcsText(sanitizeSingleLineText(event.location))}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export interface ParsedIcsEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
}

function parseIcsDateTime(raw: string): Date | null {
  const cleaned = raw.trim();
  const utcMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(cleaned);
  if (utcMatch) {
    const [, y, m, d, hh, mm, ss] = utcMatch;
    const isUtc = cleaned.endsWith("Z");
    const date = isUtc
      ? new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)))
      : new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const dateOnlyMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(cleaned);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

export function parseIcsEvents(icsText: string): ParsedIcsEvent[] {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events: ParsedIcsEvent[] = [];

  let inEvent = false;
  let uid = "";
  let summary = "Google Naptár elfoglaltság";
  let start: Date | null = null;
  let end: Date | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true;
      uid = "";
      summary = "Google Naptár elfoglaltság";
      start = null;
      end = null;
      continue;
    }
    if (trimmed === "END:VEVENT") {
      if (inEvent && start && end && end.getTime() > start.getTime()) {
        events.push({
          uid: uid || `${start.toISOString()}-${end.toISOString()}`,
          summary,
          start,
          end,
        });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const rawKey = trimmed.slice(0, colonIdx).toUpperCase();
    const key = rawKey.split(";")[0];
    const value = trimmed.slice(colonIdx + 1);

    if (key === "UID") {
      uid = value.trim();
    } else if (key === "SUMMARY") {
      summary = value
        .replace(/\\n/g, " ")
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\\\/g, "\\")
        .trim() || "Google Naptár elfoglaltság";
    } else if (key === "DTSTART") {
      start = parseIcsDateTime(value);
    } else if (key === "DTEND") {
      end = parseIcsDateTime(value);
    }
  }

  return events;
}
