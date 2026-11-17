import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { databaseCloseReporter } from '../server/database-errors.ts';
test('database close errors are sanitized including unexpected connection closure', () => {
  const messages: string[] = [];
  const report = databaseCloseReporter(message => messages.push(message));
  report(new Error('postgresql://private:secret@host'));
  assert.equal(messages.length, 1); assert.ok(!messages[0].includes('secret'));
  report(null);
  report(Object.assign(new Error('shutdown'), { code: 'ERR_POSTGRES_CONNECTION_CLOSED' }));
  assert.equal(messages.length, 2);
});
