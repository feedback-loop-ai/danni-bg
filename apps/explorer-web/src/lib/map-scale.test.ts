import { describe, expect, it } from 'bun:test';
import {
  bucketForCount,
  colorForCount,
  colorRamp,
  legendStops,
  rampBreakpoints,
} from './map-scale.ts';

describe('rampBreakpoints', () => {
  it('is ascending and starts at 1', () => {
    const bp = rampBreakpoints(262);
    expect(bp).toHaveLength(5);
    expect(bp[0]).toBe(1);
    for (let i = 1; i < bp.length; i++) expect(bp[i]).toBeGreaterThanOrEqual(bp[i - 1] as number);
  });
  it('degenerates safely for tiny maxes', () => {
    expect(rampBreakpoints(0)).toEqual([1, 1, 1, 1, 1]);
    expect(rampBreakpoints(1)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('bucketForCount', () => {
  const bp = rampBreakpoints(100); // [1, 10, 25, 50, 75]
  it('reserves bucket 0 for empty', () => {
    expect(bucketForCount(0, bp)).toBe(0);
  });
  it('climbs buckets with the count', () => {
    expect(bucketForCount(1, bp)).toBe(1);
    expect(bucketForCount(10, bp)).toBe(2);
    expect(bucketForCount(40, bp)).toBe(3);
    expect(bucketForCount(60, bp)).toBe(4);
    expect(bucketForCount(99, bp)).toBe(5);
  });
});

describe('colorForCount', () => {
  it('maps 0 to the lightest and the max to the darkest of the ramp', () => {
    const ramp = colorRamp(false);
    expect(colorForCount(0, 100, false)).toBe(ramp[0] as string);
    expect(colorForCount(100, 100, false)).toBe(ramp[5] as string);
  });
});

describe('legendStops', () => {
  it('emits one swatch per ramp colour, starting at 0', () => {
    const stops = legendStops(100, false);
    expect(stops).toHaveLength(6);
    expect(stops[0]?.from).toBe(0);
    expect(stops[1]?.from).toBe(1);
  });
});
