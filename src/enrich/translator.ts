export interface TranslationResult {
  text: string;
  confidence: number;
}

export interface Translator {
  readonly id: string;
  translate(text: string, source: 'bg', target: 'en'): Promise<TranslationResult>;
}
