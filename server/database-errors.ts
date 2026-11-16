import type { Pool } from 'pg';

// pg emits idle-client failures outside request promises. Handle them without
// logging the error object, which may contain database connection information.
export function monitorDatabaseErrors(pool: Pick<Pool, 'on'>, report: (message: string) => void = console.error) {
  pool.on('error', () => report('Database connection interrupted; subsequent requests will retry a connection.'));
}
