import type { DatasetRow } from '../store/repos/datasets.ts';
import type { ResourceRow } from '../store/repos/resources.ts';

export interface EntityCandidate {
  id: string;
  kind: 'organization' | 'geographic_unit' | 'time_period' | 'named_subject' | 'tag' | 'group';
  canonicalLabelBg: string;
  canonicalLabelEn?: string | null;
  attributes?: Record<string, unknown>;
  evidence: Record<string, unknown>;
  confidence: number;
}

export interface ExtractContext {
  dataset: DatasetRow;
  resources: ResourceRow[];
}

export interface Extractor {
  readonly id: string;
  extract(ctx: ExtractContext): Promise<EntityCandidate[]>;
}
