import { isRecord, oneOf, type Loose } from './domain.ts';
export const NOTE_LIMIT = 2000;
export const VIEWING_STATUSES = ['Considering', 'Contacted', 'Tour scheduled', 'Toured', 'Applied', 'Passed'] as const;
type SavedNote = { text: string; status: (typeof VIEWING_STATUSES)[number] };
export const emptySavedNote = (): SavedNote => ({ text: '', status: 'Considering' });
export function parseSavedNote(value: string | null): SavedNote {
  if (value === null) return emptySavedNote();
  const note = JSON.parse(value);
  const { text, status }: Loose<SavedNote> = isRecord(note) ? note : {};
  if (typeof text !== 'string' || text.length > NOTE_LIMIT || !oneOf(VIEWING_STATUSES, status)) {
    throw new Error('Saved notes could not be read.');
  }
  return { text, status };
}
export function savedNoteKey(listingKey: string): string {
  return 'apartment-search:private-note:v1:' + encodeURIComponent(listingKey);
}
