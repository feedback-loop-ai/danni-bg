import type { TranslationResult, Translator } from '../translator.ts';

export interface HostedApiTranslatorOptions {
  endpointUrl: string;
  bearer?: string;
  fetcher?: typeof fetch;
  /** Returned model identifier; embedded into the translator id. */
  model?: string;
}

interface HostedResponse {
  text?: string;
  confidence?: number;
}

export class HostedApiTranslator implements Translator {
  readonly id: string;
  private readonly endpoint: string;
  private readonly bearer?: string;
  private readonly fetcher: typeof fetch;
  constructor(opts: HostedApiTranslatorOptions) {
    this.endpoint = opts.endpointUrl;
    if (opts.bearer !== undefined) this.bearer = opts.bearer;
    this.fetcher = opts.fetcher ?? fetch;
    this.id = `hosted-api:${opts.model ?? this.endpoint}`;
  }
  async translate(text: string, source: 'bg', target: 'en'): Promise<TranslationResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const res = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, source, target }),
    });
    if (!res.ok) {
      throw new Error(`Translator ${this.endpoint} returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as HostedResponse;
    return { text: body.text ?? '', confidence: body.confidence ?? 0.5 };
  }
}
