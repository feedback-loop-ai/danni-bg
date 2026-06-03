export function nowIso(now: () => Date = () => new Date()): string {
  return now().toISOString();
}

export function toIso(d: Date | number): string {
  const date = typeof d === 'number' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`toIso: invalid date ${String(d)}`);
  }
  return date.toISOString();
}

export function parseIso(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`parseIso: invalid ISO-8601 string ${s}`);
  }
  return d;
}

export function diffSeconds(a: string, b: string): number {
  return (parseIso(a).getTime() - parseIso(b).getTime()) / 1000;
}

const SOFIA_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sofia',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatSofia(d: Date | string | number): string {
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatSofia: invalid date ${String(d)}`);
  }
  return SOFIA_FORMATTER.format(date);
}
