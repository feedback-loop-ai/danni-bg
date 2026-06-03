import type { CurateContext, CuratedArtifactOutput, Curator } from './curator.ts';

export class UncuratedMarker implements Curator {
  readonly kind = 'uncurated' as const;

  constructor(private readonly reason: string) {}

  canHandle(_: CurateContext): boolean {
    return true;
  }

  async curate(ctx: CurateContext): Promise<CuratedArtifactOutput> {
    return {
      kind: 'uncurated',
      path: '',
      schema: { kind: 'uncurated' },
      transformRules: [],
      uncuratedReason: `${this.reason} (resource ${ctx.resource.id})`,
    };
  }
}
