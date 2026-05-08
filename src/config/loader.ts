import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError } from '../lib/errors.ts';
import { type DanniConfig, DanniConfigSchema } from './schema.ts';

export interface LoadConfigOptions {
  path?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export function loadConfig(options: LoadConfigOptions = {}): DanniConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const path = resolve(cwd, options.path ?? env['DANNI_CONFIG'] ?? 'danni.config.json');

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new ConfigError(`Cannot read config file at ${path}`, {
      path,
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Config file is not valid JSON: ${path}`, {
      path,
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  const result = DanniConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new ConfigError(`Config validation failed at ${path}`, { path, issues });
  }
  return result.data;
}

export function parseConfig(input: unknown): DanniConfig {
  const result = DanniConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new ConfigError('Config validation failed', { issues });
  }
  return result.data;
}
