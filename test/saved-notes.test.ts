import { expect, test } from 'bun:test';
import { emptySavedNote, NOTE_LIMIT, parseSavedNote, savedNoteKey, VIEWING_STATUSES } from '../src/saved-notes.ts';
test('notes default independently and round-trip all viewing statuses', () => {
  const empty = emptySavedNote(); empty.text = 'changed';
  expect(parseSavedNote(null)).toStrictEqual({ text: '', status: 'Considering' });
  for (const status of VIEWING_STATUSES) {
    const note = { text: 'Quiet?\nAsk about utilities 🏡', status };
    expect(parseSavedNote(JSON.stringify(note))).toStrictEqual(note);
  }
  expect(parseSavedNote(JSON.stringify({ text: 'x'.repeat(NOTE_LIMIT), status: 'Applied' })).text.length).toBe(NOTE_LIMIT);
});
test('invalid stored notes fail closed rather than silently erase data', () => {
  for (const value of ['{', 'null', '{}', '{"text":4}', JSON.stringify({ text: 'x'.repeat(NOTE_LIMIT + 1), status: 'Applied' }), JSON.stringify({ text: '', status: 'Invented' })]) {
    expect(() => parseSavedNote(value)).toThrow();
  }
});
test('note keys isolate units and safely encode arbitrary listing identities', () => {
  expect(savedNoteKey('a|1')).not.toBe(savedNoteKey('a|2'));
  expect(savedNoteKey('a/b')).not.toBe(savedNoteKey('a%2Fb'));
  expect(savedNoteKey('a/b')).toBe('apartment-search:private-note:v1:a%2Fb');
});
