// iCalendar (RFC 5545) yazımı: abone takvimler için yalnızca gereken kadarı.
// Satırlar CRLF ile biter ve 75 baytı geçince bölünür; metin değerlerinde
// ters bölü, virgül, noktalı virgül ve satır sonu kaçırılır.

export type CalendarEvent = {
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  location: string;
  description: string;
  url: string;
};

export function escapeText(value: string) {
  return (
    value
      .replaceAll("\\", String.raw`\\`)
      .replaceAll(";", String.raw`\;`)
      .replaceAll(",", String.raw`\,`)
      .replaceAll(/\r\n|\r|\n/g, String.raw`\n`)
      // Diğer denetim karakterlerine iCalendar metninde yer yok.
      .replaceAll(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
  );
}

/** 20260930T110000Z */
export function utc(date: Date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** 75 bayttan uzun satırı böler; çok baytlı bir karakter ikiye ayrılmaz. */
export function fold(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "",
    size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // Devam satırı bir boşlukla başlar; o boşluk da 75 bayta dahildir.
    const limit = parts.length ? 74 : 75;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function calendar(input: {
  name: string;
  events: CalendarEvent[];
  now?: Date;
}) {
  const stamp = utc(input.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Derslik//Derslik//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.name)}`,
    "X-WR-TIMEZONE:Europe/Istanbul",
    // Apple ve Outlook bu aralığı dikkate alır; Google kendi aralığıyla okur.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    // RFC 5545 takvimde en az bir bileşen ister; ders yokken de akış geçerli
    // kalsın. Saatler UTC yazılır, bu tanım yalnızca takvimin saat dilimidir
    // (Türkiye 2016'dan beri yaz saati uygulamadan UTC+3).
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Istanbul",
    "BEGIN:STANDARD",
    "DTSTART:20160907T000000",
    "TZOFFSETFROM:+0300",
    "TZOFFSETTO:+0300",
    "TZNAME:+03",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  for (const e of input.events)
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${e.sequence}`,
      `DTSTART:${utc(e.start)}`,
      `DTEND:${utc(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      `DESCRIPTION:${escapeText(e.description)}`,
      `URL:${e.url}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
