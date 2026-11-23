/**
 * Structured logs: one JSON object per line, which Workers Logs indexes by field. Log what failed and
 * where, never secrets, tokens, request bodies or personal data such as addresses.
 */
type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, string | number | boolean | null | undefined>;
/** One logged line, parsed. */
export type LogRecord = Fields & { level: Level; event: string; error?: string; stack?: string };

/** Writes a line to the console stream for its level, which Workers Logs reads. */
export const consoleSink = (level: Level, line: string) => {
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
};

export const log = {
  /** Where lines go; tests replace it to keep output quiet or to inspect what was logged. */
  sink: consoleSink,
  error(event: string, cause: unknown, fields: Fields = {}) {
    log.sink('error', JSON.stringify({ level: 'error', event, ...fields, ...describe(cause) }));
  },
  info(event: string, fields: Fields = {}) {
    log.sink('info', JSON.stringify({ level: 'info', event, ...fields }));
  },
  warn(event: string, fields: Fields = {}) {
    log.sink('warn', JSON.stringify({ level: 'warn', event, ...fields }));
  },
};

function describe(cause: unknown) {
  if (!(cause instanceof Error)) return { error: String(cause) };
  return {
    error: `${cause.name}: ${cause.message}`,
    stack: cause.stack
      ?.split('\n')
      .slice(1, 6)
      .map((line) => line.trim())
      .join(' | '),
  };
}
