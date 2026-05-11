import { describe, expect, it } from 'bun:test';
import { LocalMarianMtTranslator } from '../../../../src/enrich/translators/local-marianmt.ts';

describe('enrich.translators.local-marianmt', () => {
  it('returns empty translation with confidence 0.0 by default', async () => {
    const t = new LocalMarianMtTranslator();
    const r = await t.translate('Здравей', 'bg', 'en');
    expect(r.text).toBe('');
    expect(r.confidence).toBe(0.0);
    expect(t.id.startsWith('local-marianmt:')).toBe(true);
  });

  it('honors override translateFn', async () => {
    const t = new LocalMarianMtTranslator({
      translateFn: async (text) => ({ text: `EN(${text})`, confidence: 0.8 }),
    });
    const r = await t.translate('Здравей', 'bg', 'en');
    expect(r.text).toBe('EN(Здравей)');
    expect(r.confidence).toBe(0.8);
  });

  it('embeds modelVersion in id', () => {
    const t = new LocalMarianMtTranslator({ modelVersion: 'v2' });
    expect(t.id).toBe('local-marianmt:v2');
  });
});
