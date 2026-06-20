// Per-user token quota math (token metering) — pure unit tests.

import { describe, expect, it } from 'bun:test';
import { effectiveLimit, quotaView } from '../src/chat/quota.ts';

describe('effectiveLimit', () => {
  it('prefers the per-user override (including an explicit 0 = unlimited)', () => {
    expect(effectiveLimit(500, 100)).toBe(500);
    expect(effectiveLimit(0, 100)).toBe(0); // per-user unlimited overrides a default
  });
  it('falls back to the platform default, else unlimited (0)', () => {
    expect(effectiveLimit(null, 100)).toBe(100);
    expect(effectiveLimit(null, undefined)).toBe(0);
  });
  it('clamps negatives to 0', () => {
    expect(effectiveLimit(-5, undefined)).toBe(0);
    expect(effectiveLimit(null, -5)).toBe(0);
  });
});

describe('quotaView', () => {
  it('reports remaining + not-exceeded under a limit', () => {
    expect(quotaView(30, 100)).toEqual({ used: 30, limit: 100, remaining: 70, exceeded: false });
  });
  it('marks exceeded at or above the limit', () => {
    expect(quotaView(100, 100).exceeded).toBe(true);
    expect(quotaView(150, 100)).toEqual({ used: 150, limit: 100, remaining: 0, exceeded: true });
  });
  it('treats a 0/negative limit as unlimited (remaining null, never exceeded)', () => {
    expect(quotaView(9999, 0)).toEqual({ used: 9999, limit: 0, remaining: null, exceeded: false });
  });
});
