import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { emptySavedNote, NOTE_LIMIT, parseSavedNote, savedNoteKey, VIEWING_STATUSES } from '../src/saved-notes.ts';
test('notes default independently and round-trip all viewing statuses', () => {
  const empty = emptySavedNote(); empty.text = 'changed';
  assert.deepEqual(parseSavedNote(null), { text: '', status: 'Considering' });
  for (const status of VIEWING_STATUSES) {
    const note = { text: 'Quiet?\nAsk about utilities 🏡', status };
    assert.deepEqual(parseSavedNote(JSON.stringify(note)), note);
  }
  assert.equal(parseSavedNote(JSON.stringify({ text: 'x'.repeat(NOTE_LIMIT), status: 'Applied' })).text.length, NOTE_LIMIT);
});
test('invalid stored notes fail closed rather than silently erase data', () => {
  for (const value of ['{', 'null', '{}', '{"text":4}', JSON.stringify({ text: 'x'.repeat(NOTE_LIMIT + 1), status: 'Applied' }), JSON.stringify({ text: '', status: 'Invented' })]) {
    assert.throws(() => parseSavedNote(value));
  }
});
test('note keys isolate units and safely encode arbitrary listing identities', () => {
  assert.notEqual(savedNoteKey('a|1'), savedNoteKey('a|2'));
  assert.notEqual(savedNoteKey('a/b'), savedNoteKey('a%2Fb'));
  assert.equal(savedNoteKey('a/b'), 'apartment-search:private-note:v1:a%2Fb');
});
