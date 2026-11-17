import { SQL } from 'bun';
import type { BucketDatabase } from './postgres-bucket.ts';
import { databaseCloseReporter } from './database-errors.ts';

// SQL text is static application SQL; values are always separately bound.
// reserve() pins BEGIN/LOCK/CAS/quota/COMMIT to the same physical connection.
export function createBunDatabase(url: string, options: { max?: number; schema?: string } = {}) {
  if (!['postgres:', 'postgresql:'].includes(new URL(url).protocol)) throw new Error('A PostgreSQL URL is required.');
  if (options.schema && !/^apartment_test_[a-f0-9]{32}$/.test(options.schema)) throw new Error('Invalid test schema.');
  let closing = false;
  const reportClose = databaseCloseReporter();
  const sql = new SQL(url, {
    adapter: 'postgres', max: options.max ?? 5, connectionTimeout: 10,
    connection: { statement_timeout: 15000, ...(options.schema ? { search_path: options.schema } : {}) },
    onclose: error => { if (!closing) reportClose(error); },
  });
  const query: BucketDatabase['query'] = async (text, parameters = []) => ({ rows: await sql.unsafe(text, parameters) });
  return {
    query,
    async connect() {
      const connection = await sql.reserve({ signal: AbortSignal.timeout(10000) });
      return {
        query: async (text: string, parameters: any[] = []) => ({ rows: await connection.unsafe(text, parameters) }),
        release: () => connection.release(),
      };
    },
    end: () => { closing = true; return sql.close({ timeout: 5 }); },
  } satisfies BucketDatabase & { end(): Promise<void> };
}
