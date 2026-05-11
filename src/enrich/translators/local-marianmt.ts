import type { TranslationResult, Translator } from '../translator.ts';

export interface LocalMarianMtOptions {
  modelVersion?: string;
  /**
   * Override translate function. The default is a deterministic placeholder
   * that returns the original Bulgarian; the translator id records the
   * provenance and the confidence is set to 0.0 so callers know the EN field
   * should not be substituted (FR-019c).
   */
  translateFn?: (text: string) => Promise<{ text: string; confidence: number }>;
}

/**
 * Local MarianMT translator stub. The full ONNX model load is intentionally
 * deferred — the v1 build does not bundle the binary. Operators wanting real
 * BG→EN translation either (a) wire `translateFn` to a custom local runtime
 * or (b) use the `hosted-api` translator. The stub's confidence is 0.0 so the
 * pipeline records translator provenance without claiming linguistic accuracy.
 */
export class LocalMarianMtTranslator implements Translator {
  readonly id: string;
  constructor(private readonly opts: LocalMarianMtOptions = {}) {
    this.id = `local-marianmt:${opts.modelVersion ?? 'stub-0.0'}`;
  }
  async translate(text: string, _src: 'bg', _tgt: 'en'): Promise<TranslationResult> {
    if (this.opts.translateFn) {
      return this.opts.translateFn(text);
    }
    return { text: '', confidence: 0.0 };
  }
}
