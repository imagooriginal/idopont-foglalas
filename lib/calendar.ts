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

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h1 style="font-size:22px">${escapeHtml(sanitizeSingleLineText(greeting))}</h1><p>${safeIntro}</p><table style="border-collapse:collapse;width:100%">${details}</table><p style="margin-top:24px"><a href="${escapeHtml(safeUrl)}" style="display:inline-block;padding:12px 18px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px">Hozzáadás a Google Naptárhoz</a></p><p style="font-size:13px;color:#526078">A naptármeghívó ICS-fájlként is csatolva van ehhez az e-mailhez.</p></div>`;
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
}) {
  return createBookingEmailHtml({
    ...params,
    introText:
      "Emlékeztetünk, hogy 24 órán belül esedékes a lefoglalt időpontod. A foglalás részletei:",
  });
}
