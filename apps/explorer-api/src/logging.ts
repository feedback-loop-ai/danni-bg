// Structured logging for the explorer API (T010). Reuses the repo's JSON logger and adds a redactor
// that strips provider secrets from any log context before it is emitted, so an apiKey accidentally
// threaded into a log call can never reach the sink (FR-024, Constitution IV).

import { type LogContext, getLogger } from '../../../src/logging/logger.ts';

const SECRET_KEYS = new Set(['apiKey', 'api_key', 'authorization', 'bearer', 'password', 'token']);
const REDACTED = '[redacted]';

/** Recursively replace any secret-named field with a redaction marker. */
export function redact(context: LogContext): LogContext {
  const out: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (SECRET_KEYS.has(key)) {
      out[key] = REDACTED;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redact(value as LogContext);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const base = getLogger().child({ component: 'explorer-api' });

export const log = {
  info(event: string, fields: LogContext = {}): void {
    base.info(event, redact(fields));
  },
  warn(event: string, fields: LogContext = {}): void {
    base.warn(event, redact(fields));
  },
  error(event: string, fields: LogContext = {}): void {
    base.error(event, redact(fields));
  },
};
