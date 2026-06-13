// Pure sequential colour scale for the choropleth. Dataset counts are heavily skewed (a few oblasts
// hold hundreds, most a handful), so a linear ramp washes everything into one shade. We bucket by
// fractions of the max, emphasising the low end, and bucket 0 is reserved for "no data".

const RAMP_LIGHT = ['#eef2f7', '#cfe2f3', '#9ecae1', '#6baed6', '#3182bd', '#08519c'];
const RAMP_DARK = ['#101a2e', '#16315c', '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd'];

export function colorRamp(isDark: boolean): string[] {
  return isDark ? RAMP_DARK : RAMP_LIGHT;
}

/**
 * Lower bounds for the five non-empty buckets (ascending, starting at 1). Monotonic + deduped so a
 * small max still yields a valid, non-degenerate scale.
 */
export function rampBreakpoints(max: number): number[] {
  if (max <= 1) return [1, 1, 1, 1, 1];
  const raw = [1, max * 0.1, max * 0.25, max * 0.5, max * 0.75].map((n) =>
    Math.max(1, Math.ceil(n)),
  );
  // Enforce strictly sensible monotonicity (each ≥ previous).
  for (let i = 1; i < raw.length; i++) raw[i] = Math.max(raw[i] as number, raw[i - 1] as number);
  return raw;
}

/** Bucket index 0–5 for a count given the breakpoints (0 → empty bucket). */
export function bucketForCount(count: number, breakpoints: number[]): number {
  if (count <= 0) return 0;
  let bucket = 1;
  for (let i = 1; i < breakpoints.length; i++) {
    if (count >= (breakpoints[i] as number)) bucket = i + 1;
  }
  return bucket;
}

export function colorForCount(count: number, max: number, isDark: boolean): string {
  const ramp = colorRamp(isDark);
  return ramp[bucketForCount(count, rampBreakpoints(max))] as string;
}

/** Legend swatches (lightest → darkest) with the count each bucket starts at. */
export function legendStops(max: number, isDark: boolean): { color: string; from: number }[] {
  const ramp = colorRamp(isDark);
  const bp = rampBreakpoints(max);
  return ramp.map((color, i) => ({ color, from: i === 0 ? 0 : (bp[i - 1] as number) }));
}
