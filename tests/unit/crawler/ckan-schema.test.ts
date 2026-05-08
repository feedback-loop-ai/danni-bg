import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CkanErrorEnvelopeSchema,
  GroupShowResponseSchema,
  OrganizationShowResponseSchema,
  PackageListResponseSchema,
  PackageSearchResponseSchema,
  PackageShowResponseSchema,
  TagListResponseSchema,
} from '../../../src/crawler/ckan-schema.ts';

const FIX = fileURLToPath(new URL('../../fixtures/portal/', import.meta.url));

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(join(FIX, path), 'utf-8'));
}

describe('crawler.ckan-schema', () => {
  it('parses package_list/standard.json', () => {
    const out = PackageListResponseSchema.parse(loadJson('package_list/standard.json'));
    expect(out.success).toBe(true);
    expect(out.result.length).toBe(3);
  });

  it('parses package_show/standard.json including Cyrillic title', () => {
    const out = PackageShowResponseSchema.parse(loadJson('package_show/standard.json'));
    expect(out.result.title).toBe('Първи набор от данни');
  });

  it('parses package_show/cyrillic.json byte-exactly', () => {
    const raw = readFileSync(join(FIX, 'package_show/cyrillic.json'), 'utf-8');
    const out = PackageShowResponseSchema.parse(JSON.parse(raw));
    expect(out.result.title.includes('Бюджет')).toBe(true);
    expect(out.result.notes?.includes('кирилица')).toBe(true);
  });

  it('parses package_search/page-1.json with two packages', () => {
    const out = PackageSearchResponseSchema.parse(loadJson('package_search/page-1.json'));
    expect(out.result.count).toBe(2);
    expect(out.result.results.length).toBe(2);
  });

  it('parses organization_show/standard.json', () => {
    const out = OrganizationShowResponseSchema.parse(loadJson('organization_show/standard.json'));
    expect(out.result.title).toBe('Столична община');
  });

  it('parses group_show/standard.json', () => {
    const out = GroupShowResponseSchema.parse(loadJson('group_show/standard.json'));
    expect(out.result.name).toBe('finansi');
  });

  it('parses tag_list/standard.json', () => {
    const out = TagListResponseSchema.parse(loadJson('tag_list/standard.json'));
    expect(out.result.length).toBe(2);
  });

  it('parses an error envelope', () => {
    const out = CkanErrorEnvelopeSchema.parse(loadJson('package_show/not-found.json'));
    expect(out.success).toBe(false);
    expect(out.error.__type).toBe('Not Found Error');
  });
});
