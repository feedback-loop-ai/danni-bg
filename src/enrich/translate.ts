import type { TranslationSubjectKind, TranslationsRepo } from '../store/repos/translations.ts';
import type { Translator } from './translator.ts';

export interface TranslateSubjectInput {
  subjectKind: TranslationSubjectKind;
  subjectId: string;
  textBg: string;
}

export interface TranslateRunOptions {
  translator: Translator;
  repo: TranslationsRepo;
  /**
   * If `force` is false (default), an existing non-empty `text_en` is preserved
   * even when the translator returns empty output (FR-019c, Principle X).
   */
  force?: boolean;
}

export interface TranslateRunResult {
  count: number;
  empty: number;
}

export async function translateSubjects(
  opts: TranslateRunOptions,
  inputs: TranslateSubjectInput[],
): Promise<TranslateRunResult> {
  let count = 0;
  let empty = 0;
  for (const input of inputs) {
    if (input.textBg.trim() === '') {
      empty++;
      continue;
    }
    const result = await opts.translator.translate(input.textBg, 'bg', 'en');
    opts.repo.upsert({
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      textBg: input.textBg,
      textEn: result.text,
      translator: opts.translator.id,
      confidence: result.confidence,
    });
    count++;
  }
  return { count, empty };
}
