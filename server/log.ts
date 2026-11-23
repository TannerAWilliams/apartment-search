/**
 * Structured logs: one JSON object per line, which Workers Logs indexes by field. Log what failed and
 * where, never secrets, tokens, request bodies or personal data such as addresses.
 */
type Level = 'warn' | 'error';
type Fields = Record<string, string | number | boolean | null | undefined>;

export const log = {
  /** Where lines go; tests replace it to keep output quiet or to inspect what was logged. */
  sink: (level: Level, line: string) => { (level === 'error' ? console.error : console.warn)(line); },
  error(event: string, cause: unknown, fields: Fields = {}) {
    log.sink('error', JSON.stringify({ level: 'error', event, ...fields, ...describe(cause) }));
  },
  warn(event: string, fields: Fields = {}) {
    log.sink('warn', JSON.stringify({ level: 'warn', event, ...fields }));
  },
};

function describe(cause: unknown) {
  if (!(cause instanceof Error)) return { error: String(cause) };
  return { error: `${cause.name}: ${cause.message}`, stack: cause.stack?.split('\n').slice(1, 6).map((line) => line.trim()).join(' | ') };
}
