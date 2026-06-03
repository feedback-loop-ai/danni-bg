#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const matrixPath = join(ROOT, 'tests', 'parity-matrix.json');
const matrix = JSON.parse(readFileSync(matrixPath, 'utf-8')) as {
  endpoints: { name: string; testId: string }[];
  datasetSchemas: { name: string; testId: string }[];
};

const errors: string[] = [];

const portalDir = join(ROOT, 'specs', 'portal-api');
if (existsSync(portalDir)) {
  const consumed = readdirSync(portalDir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'scale.md')
    .map((f) => f.replace(/\.md$/, ''));
  for (const ep of consumed) {
    if (!matrix.endpoints.some((e) => e.name === ep)) {
      errors.push(`portal-api endpoint '${ep}' has no entry in parity-matrix.json#endpoints`);
    }
  }
}

const schemaDir = join(ROOT, 'specs', 'dataset-schemas');
if (existsSync(schemaDir)) {
  const schemas = readdirSync(schemaDir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''));
  for (const s of schemas) {
    if (!matrix.datasetSchemas.some((e) => e.name === s)) {
      errors.push(`dataset-schemas entry '${s}' has no entry in parity-matrix.json#datasetSchemas`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`Parity matrix gate FAILED:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Parity matrix gate OK\n');
