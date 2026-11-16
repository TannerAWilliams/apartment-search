import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { monitorDatabaseErrors } from '../server/database-errors.ts';

test('idle database failures are handled without logging sensitive error details', () => {
  const pool = new EventEmitter(); const messages: string[] = [];
  monitorDatabaseErrors(pool as unknown as Pool, message => messages.push(message));
  assert.doesNotThrow(() => pool.emit('error', new Error('postgresql://private:secret@host')));
  assert.equal(messages.length, 1); assert.ok(!messages[0].includes('secret'));
  pool.emit('error', new Error('another failure')); assert.equal(messages.length, 2);
});
