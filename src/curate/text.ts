import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ensureDir } from '../lib/fs.ts';
import type {
  CurateContext,
  CuratedArtifactOutput,
  Curator,
  TextSchema,
  TransformRule,
} from './curator.ts';
import { curatedRelDir } from './curator.ts';
import { decodeBytes, detectEncoding } from './encoding.ts';

export class TextCurator implements Curator {
  readonly kind = 'text' as const;

  canHandle(_: CurateContext): boolean {
    return true;
  }

  async curate(ctx: CurateContext): Promise<CuratedArtifactOutput> {
    const bytes = readFileSync(ctx.rawAbsPath);
    const detection = detectEncoding(bytes);
    const text = decodeBytes(bytes, detection.encoding);
    const transformRules: TransformRule[] = [];
    if (detection.encoding === 'cp1251') {
      transformRules.push({ rule: 'utf8-from-windows1251', appliedTo: '*' });
    }
    const schema: TextSchema = {
      kind: 'text',
      encoding: 'utf-8',
      transformRules,
    };
    const dir = join(ctx.storeRoot, 'curated', curatedRelDir(ctx.resource));
    ensureDir(dir);
    writeFileSync(join(dir, 'data.txt'), text);
    writeFileSync(join(dir, 'schema.json'), `${JSON.stringify(schema, null, 2)}\n`);
    return {
      kind: 'text',
      path: relative(join(ctx.storeRoot, 'curated'), join(dir, 'data.txt')),
      schema,
      transformRules,
    };
  }
}
