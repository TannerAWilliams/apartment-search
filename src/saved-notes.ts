export const NOTE_LIMIT = 2000;
export const VIEWING_STATUSES = ['Considering', 'Contacted', 'Tour scheduled', 'Toured', 'Applied', 'Passed'] as const;
export type SavedNote = { text: string; status: typeof VIEWING_STATUSES[number] };
export const emptySavedNote = (): SavedNote => ({ text: '', status: 'Considering' });
export function parseSavedNote(value: string | null): SavedNote {
  if (value === null) return emptySavedNote();
  const note = JSON.parse(value);
  if (!note || typeof note.text !== 'string' || note.text.length > NOTE_LIMIT || !VIEWING_STATUSES.includes(note.status)) {
    throw new Error('Saved notes could not be read.');
  }
  return { text: note.text, status: note.status };
}
export function savedNoteKey(listingKey: string): string {
  return 'apartment-search:private-note:v1:' + encodeURIComponent(listingKey);
}
