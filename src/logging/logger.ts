export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogContext {
  run_id?: string;
  dataset_id?: string;
  resource_id?: string;
  [key: string]: unknown;
}

export interface LogRecord extends LogContext {
  level: LogLevel;
  ts: string;
  event: string;
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: (line: string) => void;
  now?: () => Date;
  baseContext?: LogContext;
}

export interface Logger {
  readonly level: LogLevel;
  debug(event: string, fields?: LogContext): void;
  info(event: string, fields?: LogContext): void;
  warn(event: string, fields?: LogContext): void;
  error(event: string, fields?: LogContext): void;
  child(context: LogContext): Logger;
}

function defaultSink(line: string): void {
  process.stderr.write(`${line}\n`);
}

class LoggerImpl implements Logger {
  readonly level: LogLevel;
  private readonly sink: (line: string) => void;
  private readonly now: () => Date;
  private readonly baseContext: LogContext;

  constructor(opts: LoggerOptions) {
    this.level = opts.level ?? 'info';
    this.sink = opts.sink ?? defaultSink;
    this.now = opts.now ?? (() => new Date());
    this.baseContext = opts.baseContext ?? {};
  }

  private emit(level: LogLevel, event: string, fields: LogContext = {}): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) {
      return;
    }
    const record: LogRecord = {
      ...this.baseContext,
      ...fields,
      level,
      ts: this.now().toISOString(),
      event,
    };
    this.sink(JSON.stringify(record));
  }

  debug(event: string, fields?: LogContext): void {
    this.emit('debug', event, fields);
  }
  info(event: string, fields?: LogContext): void {
    this.emit('info', event, fields);
  }
  warn(event: string, fields?: LogContext): void {
    this.emit('warn', event, fields);
  }
  error(event: string, fields?: LogContext): void {
    this.emit('error', event, fields);
  }

  child(context: LogContext): Logger {
    return new LoggerImpl({
      level: this.level,
      sink: this.sink,
      now: this.now,
      baseContext: { ...this.baseContext, ...context },
    });
  }
}

let _root: Logger | undefined;

export function getLogger(): Logger {
  if (!_root) {
    const envLevel = process.env.DANNI_LOG_LEVEL as LogLevel | undefined;
    const level: LogLevel = envLevel && envLevel in LEVEL_RANK ? envLevel : 'info';
    _root = new LoggerImpl({ level });
  }
  return _root;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  return new LoggerImpl(opts);
}

export function withContext(context: LogContext): Logger {
  return getLogger().child(context);
}

export function _resetLogger(): void {
  _root = undefined;
}
