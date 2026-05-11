import { describe, expect, it } from 'bun:test';
import { sniff } from '../../../src/curate/sniff.ts';

describe('curate.sniff', () => {
  it('detects xml from a leading <', () => {
    expect(sniff({ head: Buffer.from('<?xml version="1.0"?><root/>') }).kind).toBe('xml');
  });

  it('detects geojson from JSON content with FeatureCollection', () => {
    const r = sniff({ head: Buffer.from('{"type":"FeatureCollection","features":[]}') });
    expect(r.kind).toBe('geojson');
    expect(r.reason).toBe('magic');
  });

  it('detects json arrays', () => {
    expect(sniff({ head: Buffer.from('[1,2,3]') }).kind).toBe('json');
  });

  it('detects json objects', () => {
    expect(sniff({ head: Buffer.from('{"a":1}') }).kind).toBe('json');
  });

  it('treats a PK header as tabular (xlsx zip)', () => {
    expect(sniff({ head: Buffer.from([0x50, 0x4b, 3, 4]) }).kind).toBe('tabular');
  });

  it('falls back to declaredFormat when head is missing', () => {
    expect(sniff({ declaredFormat: 'csv' }).kind).toBe('tabular');
    expect(sniff({ declaredFormat: 'GeoJSON' }).kind).toBe('geojson');
    expect(sniff({ declaredFormat: 'XML' }).kind).toBe('xml');
    expect(sniff({ declaredFormat: 'TXT' }).kind).toBe('text');
  });

  it('falls back to extension when no other signal', () => {
    expect(sniff({ fileName: 'file.csv' }).kind).toBe('tabular');
    expect(sniff({ fileName: 'data.geojson' }).kind).toBe('geojson');
  });

  it('falls back to content-type', () => {
    expect(sniff({ declaredContentType: 'application/json' }).kind).toBe('json');
    expect(sniff({ declaredContentType: 'application/geo+json' }).kind).toBe('geojson');
    expect(sniff({ declaredContentType: 'text/csv' }).kind).toBe('tabular');
    expect(sniff({ declaredContentType: 'application/xml' }).kind).toBe('xml');
    expect(sniff({ declaredContentType: 'text/plain' }).kind).toBe('text');
  });

  it('returns text fallback on no signal', () => {
    expect(sniff({}).kind).toBe('text');
  });

  it('strips BOM before sniffing', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')]);
    expect(sniff({ head: buf }).kind).toBe('json');
  });

  it('returns null from magic on whitespace-only head', () => {
    expect(sniff({ head: Buffer.from('   \n\r\t') }).kind).toBe('text');
  });

  it('returns null from magic on empty head', () => {
    expect(sniff({ head: Buffer.alloc(0), declaredFormat: 'json' }).kind).toBe('json');
  });

  it('handles weird non-token leading byte', () => {
    expect(sniff({ head: Buffer.from('hello,world\n1,2') }).kind).toBe('text');
  });
});
