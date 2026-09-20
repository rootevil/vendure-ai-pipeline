export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface CreateLoggerOptions {
  readonly level?: LogLevel;
  readonly base?: Record<string, unknown>;
  readonly stdout?: NodeJS.WritableStream;
  readonly stderr?: NodeJS.WritableStream;
}

function writeJson(
  stream: NodeJS.WritableStream,
  level: LogLevel,
  message: string,
  fields: Record<string, unknown>,
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  };
  stream.write(`${JSON.stringify(entry)}\n`);
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const base = options.base ?? {};
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const log = (entryLevel: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) {
      return;
    }
    const stream = entryLevel === 'error' || entryLevel === 'warn' ? stderr : stdout;
    writeJson(stream, entryLevel, message, { ...base, ...fields });
  };

  return {
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
    child: (fields) =>
      createLogger({
        level,
        base: { ...base, ...fields },
        stdout,
        stderr,
      }),
  };
}
