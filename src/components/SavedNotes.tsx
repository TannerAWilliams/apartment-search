import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Chip } from './ui.tsx';
import { colors, styles } from '../styles.ts';
import { emptySavedNote, NOTE_LIMIT, parseSavedNote, savedNoteKey, VIEWING_STATUSES } from '../saved-notes.ts';

export function SavedNotes({ identity }: { identity: string }) {
  const [note, setNote] = useState(emptySavedNote);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('Loading notes…');
  useEffect(() => {
    let active = true;
    setReady(false);
    setMessage('Loading notes…');
    AsyncStorage.getItem(savedNoteKey(identity))
      .then((value) => {
        const loaded = parseSavedNote(value);
        if (active) {
          setNote(loaded);
          setReady(true);
          setMessage('');
        }
      })
      .catch(() => {
        if (active) setMessage('Notes could not be loaded. Reopen details to retry; existing notes have not been replaced.');
      });
    return () => {
      active = false;
    };
  }, [identity]);
  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    try {
      await AsyncStorage.setItem(savedNoteKey(identity), JSON.stringify(note));
      setMessage('Notes saved on this device.');
    } catch {
      setMessage('Notes could not be saved. Keep details open and try again.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Your notes and viewing status
      </Text>
      <Text style={styles.smallMuted}>
        Only on this device, not synced. Save before closing details. Removing an apartment keeps its notes if you save it again.
      </Text>
      {ready && (
        <>
          <View style={styles.chipRow}>
            {VIEWING_STATUSES.map((status) => (
              <Chip
                key={status}
                selected={note.status === status}
                onPress={() => {
                  if (saving) return;
                  setNote((current) => ({ ...current, status }));
                  setMessage('Unsaved changes');
                }}
              >
                {status}
              </Chip>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Private apartment notes"
            multiline
            maxLength={NOTE_LIMIT}
            editable={!saving}
            value={note.text}
            onChangeText={(text) => {
              setNote((current) => ({ ...current, text }));
              setMessage('Unsaved changes');
            }}
            style={{ minHeight: 88, borderWidth: 1, borderColor: colors.field, borderRadius: 8, padding: 10, fontSize: 16 }}
          />
          <Text style={styles.smallMuted}>
            {note.text.length}/{NOTE_LIMIT} characters
          </Text>
          <Button disabled={saving} onPress={save}>
            {saving ? 'Saving notes…' : 'Save notes'}
          </Button>
        </>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.smallMuted}>
          {message}
        </Text>
      )}
    </View>
  );
}
