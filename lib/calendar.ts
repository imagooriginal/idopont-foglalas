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

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
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

export function createGoogleCalendarUrl(event: CalendarEvent) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    details: event.description,
    dates: `${googleDate(event.start)}/${googleDate(event.end)}`,
  });

  if (event.location) params.set("location", event.location);

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
    `UID:${uid}`,
    `DTSTAMP:${googleDate(new Date())}`,
    `DTSTART:${googleDate(event.start)}`,
    `DTEND:${googleDate(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
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
}: {
  greeting: string;
  companyName: string;
  serviceName: string;
  customerName: string;
  start: string;
  end: string;
  googleCalendarUrl: string;
}) {
  const rows = [
    ["Szolgáltató", companyName],
    ["Szolgáltatás", serviceName],
    ["Ügyfél", customerName],
    ["Kezdés", start],
    ["Befejezés", end],
  ];
  const details = rows
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:8px 12px">${escapeHtml(label)}</th><td style="padding:8px 12px">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h1 style="font-size:22px">${escapeHtml(greeting)}</h1><p>A foglalás részletei:</p><table style="border-collapse:collapse;width:100%">${details}</table><p style="margin-top:24px"><a href="${escapeHtml(googleCalendarUrl)}" style="display:inline-block;padding:12px 18px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px">Hozzáadás a Google Naptárhoz</a></p><p style="font-size:13px;color:#526078">A naptármeghívó ICS-fájlként is csatolva van ehhez az e-mailhez.</p></div>`;
}
