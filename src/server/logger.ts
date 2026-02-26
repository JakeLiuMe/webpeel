/**
 * Lightweight structured logger — no external dependencies.
 * Respects LOG_LEVEL env var: debug | info | warn | error  (default: info)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info') as LogLevel;

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= (LEVELS[LOG_LEVEL] ?? LEVELS.info);
}

function formatLog(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>,
): string {
  const ts = new Date().toISOString();
  const base = `${ts} [${level.toUpperCase()}] [${component}] ${message}`;
  if (data && Object.keys(data).length > 0) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export function createLogger(component: string) {
  return {
    debug(msg: string, data?: Record<string, unknown>): void {
      if (shouldLog('debug')) console.debug(formatLog('debug', component, msg, data));
    },
    info(msg: string, data?: Record<string, unknown>): void {
      if (shouldLog('info')) console.info(formatLog('info', component, msg, data));
    },
    warn(msg: string, data?: Record<string, unknown>): void {
      if (shouldLog('warn')) console.warn(formatLog('warn', component, msg, data));
    },
    error(msg: string, data?: Record<string, unknown>): void {
      if (shouldLog('error')) console.error(formatLog('error', component, msg, data));
    },
  };
}
