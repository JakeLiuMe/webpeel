/**
 * Lightweight structured logger — no external dependencies.
 *
 * Production: JSON lines (structured, parseable by log aggregators)
 * Development: Human-readable console output
 *
 * Supports child loggers for request-scoped context.
 *
 * Levels: debug < info < warn < error < silent
 *
 * Respects WEBPEEL_LOG_LEVEL env var.
 * Defaults: production → 'info', development → 'debug'.
 *
 * All output goes to stderr so stdout stays clean for data/JSON (CLI piping).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const currentLevel = (): LogLevel => {
  const env = process.env.WEBPEEL_LOG_LEVEL?.toLowerCase() as LogLevel;
  if (env && env in LEVELS) return env;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

const isProduction = process.env.NODE_ENV === 'production';

interface LogContext {
  [key: string]: any;
}

export interface Logger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  child: (context: LogContext) => Logger;
}

function formatJson(level: string, module: string, args: any[], context: LogContext): string {
  // Extract message and data from args
  let msg = '';
  const data: any = {};

  for (const arg of args) {
    if (typeof arg === 'string') {
      msg = msg ? `${msg} ${arg}` : arg;
    } else if (typeof arg === 'object' && arg !== null) {
      // Merge objects into data
      if (arg instanceof Error) {
        data.error = { message: arg.message, stack: arg.stack, name: arg.name };
        if ('code' in arg) data.error.code = (arg as any).code;
      } else {
        Object.assign(data, arg);
      }
    } else {
      msg = msg ? `${msg} ${String(arg)}` : String(arg);
    }
  }

  const entry: Record<string, any> = {
    level,
    module,
    msg,
    timestamp: new Date().toISOString(),
    ...context,
  };

  if (Object.keys(data).length > 0) {
    entry.data = data;
  }

  try {
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({ level, module, msg: String(args), timestamp: new Date().toISOString() });
  }
}

function createLoggerInternal(module: string, context: LogContext = {}): Logger {
  const prefix = `[webpeel:${module}]`;

  const shouldLog = (level: LogLevel): boolean => LEVELS[currentLevel()] <= LEVELS[level];

  const logFn = (level: LogLevel, ...args: any[]) => {
    if (!shouldLog(level)) return;

    if (isProduction) {
      console.error(formatJson(level, module, args, context));
    } else {
      // Human-readable for development
      console.error(
        prefix,
        ...(level === 'warn' ? ['[WARN]'] : level === 'error' ? ['[ERROR]'] : []),
        ...args.map((a) => {
          if (typeof a === 'object' && a !== null && !(a instanceof Error)) {
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }
          return a;
        })
      );
    }
  };

  return {
    debug: (...args: any[]) => logFn('debug', ...args),
    info: (...args: any[]) => logFn('info', ...args),
    warn: (...args: any[]) => logFn('warn', ...args),
    error: (...args: any[]) => logFn('error', ...args),
    child: (childContext: LogContext) => createLoggerInternal(module, { ...context, ...childContext }),
  };
}

export function createLogger(module: string): Logger {
  return createLoggerInternal(module);
}
