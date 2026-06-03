// Minimal 5-field cron parser. Supports star, "step" (e.g. "0/5"), "a-b" range,
// "a,b,c" list, and exact integers. Fields are: minute, hour, day-of-month,
// month, day-of-week (0 = Sunday).
export interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

interface FieldRange {
  min: number;
  max: number;
}

const RANGES: FieldRange[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week (0 = Sunday)
];

function parseField(field: string, range: FieldRange): number[] {
  const values = new Set<number>();
  for (const piece of field.split(',')) {
    const stepMatch = /^(.*)\/(\d+)$/.exec(piece);
    let base = piece;
    let step = 1;
    if (stepMatch?.[1] && stepMatch[2]) {
      base = stepMatch[1];
      step = Number.parseInt(stepMatch[2], 10);
      if (!Number.isFinite(step) || step <= 0) {
        throw new Error(`cron: invalid step in '${piece}'`);
      }
    }
    let from = range.min;
    let to = range.max;
    if (base !== '*' && base !== '') {
      const rangeMatch = /^(\d+)-(\d+)$/.exec(base);
      if (rangeMatch?.[1] && rangeMatch[2]) {
        from = Number.parseInt(rangeMatch[1], 10);
        to = Number.parseInt(rangeMatch[2], 10);
      } else {
        const num = Number.parseInt(base, 10);
        if (!Number.isFinite(num)) throw new Error(`cron: invalid value '${base}'`);
        from = num;
        to = num;
      }
    }
    if (from < range.min || to > range.max || from > to) {
      throw new Error(`cron: '${piece}' out of range [${range.min},${range.max}]`);
    }
    for (let n = from; n <= to; n += step) values.add(n);
  }
  return Array.from(values).sort((a, b) => a - b);
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron: expected 5 fields, got ${parts.length}`);
  }
  const minutes = parseField(parts[0] ?? '*', RANGES[0] as FieldRange);
  const hours = parseField(parts[1] ?? '*', RANGES[1] as FieldRange);
  const daysOfMonth = parseField(parts[2] ?? '*', RANGES[2] as FieldRange);
  const months = parseField(parts[3] ?? '*', RANGES[3] as FieldRange);
  const daysOfWeek = parseField(parts[4] ?? '*', RANGES[4] as FieldRange);
  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

export function nextFire(parsed: ParsedCron, after: Date): Date {
  const candidate = new Date(after.getTime() + 60_000 - (after.getTime() % 60_000));
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const c = new Date(candidate.getTime() + i * 60_000);
    if (
      parsed.minutes.includes(c.getMinutes()) &&
      parsed.hours.includes(c.getHours()) &&
      parsed.daysOfMonth.includes(c.getDate()) &&
      parsed.months.includes(c.getMonth() + 1) &&
      parsed.daysOfWeek.includes(c.getDay())
    ) {
      return c;
    }
  }
  throw new Error('cron: no next-fire within one year');
}
