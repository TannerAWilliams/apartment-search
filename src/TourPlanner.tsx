import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Chip, Field, Link } from './ui.tsx';
import { styles } from './styles.ts';
import { listingKey } from './listings.ts';
import { TOUR_KEY, MAX_TOURS, TOUR_CHECKLIST, parseTours, validateTours, localTourStart, moveTour, chronologicalTours, overlappingTourIds, tourRoute, tourDay, toursOnDay, exportTours, type Tour } from './tour-planner.ts';

/** When `open` is given, the parent shows the toggle (a tool chip) and this renders only the panel. */
export function TourPlanner({ listings, open: shown }: { listings: any[]; open?: boolean }) {
  const [ownOpen, setOpen] = useState(false), [tours, setTours] = useState<Tour[]>([]), [ready, setReady] = useState(false);
  const open = shown ?? ownOpen;
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(''), [date, setDate] = useState(''), [time, setTime] = useState(''), [duration, setDuration] = useState('30'), [notes, setNotes] = useState('');
  const [routeDay, setRouteDay] = useState('');
  const saving = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { let active = true; AsyncStorage.getItem(TOUR_KEY).then(raw => { const loaded = parseTours(raw); if (active) { setTours(loaded); setReady(true); } }).catch(() => { if (active) setError('Tour plan could not be loaded. Existing storage has not been overwritten.'); }); return () => { active = false; }; }, []);
  async function save(next: Tour[]) {
    if (!ready || saving.current) return false;
    saving.current = true;
    setBusy(true); setError(''); setMessage('');
    try { const checked = validateTours(next); await AsyncStorage.setItem(TOUR_KEY, JSON.stringify(checked)); setTours(checked); setMessage('Tour plan saved on this device.'); return true; }
    catch { setError('Tour plan could not be saved. Your previous saved plan is unchanged.'); return false; }
    finally { saving.current = false; setBusy(false); }
  }
  function clearForm() { setEditing(null); setSelected(''); setDate(''); setTime(''); setDuration('30'); setNotes(''); }
  async function add() {
    try {
      const previous = tours.find(t => t.id === editing);
      const listing = listings.find(l => listingKey(l) === selected);
      if (!previous && !listing) throw Error('Choose a saved apartment first.');
      const minutes = Number(duration); if (!/^\d+$/.test(duration) || minutes < 5 || minutes > 240) throw Error('Duration must be 5–240 minutes.');
      const address = previous?.address ?? [listing.address, listing.unit ? 'Unit ' + listing.unit : '', listing.city, listing.state, listing.zip].filter(Boolean).join(', ');
      const tour: Tour = { id: previous?.id ?? 'tour-' + Date.now() + '-' + Math.random().toString(36).slice(2), listingKey: previous?.listingKey ?? selected, address,
        startsAt: localTourStart(date, time), minutes, notes, checked: previous?.checked ?? [] };
      if (await save(previous ? tours.map(t => t.id === previous.id ? tour : t) : [...tours, tour])) clearForm();
    } catch (e) { setError(e instanceof Error ? e.message : 'Check the tour details.'); }
  }
  function edit(t: Tour) { const d = new Date(t.startsAt); setEditing(t.id); setSelected(t.listingKey); setDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`); setTime(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`); setDuration(String(t.minutes)); setNotes(t.notes); }
  async function calendar() {
    try { const content = exportTours(tours); if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'apartment-tours.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    setMessage('Calendar file downloaded. Import it into your calendar; this does not book tours or invite anyone.');
    } else { const result = await Share.share({ message: content, title: 'Apartment tours calendar (.ics content)' }); if (result.action === Share.sharedAction) setMessage('Calendar text shared. Native calendar-file import is not supported here; use web to download the .ics file.'); }
    } catch { setError('Calendar export failed. Your saved tour plan is unchanged.'); }
  }
  const days = [...new Set(tours.map(tourDay))].sort();
  const selectedDay = days.includes(routeDay) ? routeDay : days[0] ?? '';
  const routeTours = toursOnDay(tours, selectedDay);
  const overlaps = overlappingTourIds(tours), route = tourRoute(routeTours);
  // Controlled and closed: render nothing, so the parent's spacing does not leave a gap.
  if (shown === false) return null;
  return <View style={{ gap: 10 }}>
    {shown === undefined && <Button secondary onPress={() => setOpen(!open)}>{open ? 'Hide tour planner' : 'Plan apartment tours'}</Button>}
    {open && <>
      <Text style={styles.panelTitle}>Apartment tours</Text>
      <Text style={styles.smallMuted}>Personal plans, not confirmed bookings. Stored only on this device. Use one tab: concurrent tabs can overwrite tour edits. No broker messages are sent. Times use your device timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Calendar export includes your notes. Hiding this panel keeps unsaved form edits until you leave Saved; leaving Saved discards unsaved edits.</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.smallMuted}>{message}</Text>}
      {ready && <>
        <Text style={styles.fieldLabel}>{editing ? 'Edit appointment' : 'Choose a saved apartment'}</Text>
        {!editing && <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>{listings.map(l => { const key = listingKey(l); return <Pressable key={key} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: selected === key }} aria-checked={selected === key} onPress={() => setSelected(key)} style={{ padding: 12, minHeight: 44 }}><Text>{selected === key ? '● ' : '○ '}{l.address}{l.unit ? ', ' + l.unit : ''}</Text></Pressable>; })}</ScrollView>}
        {!listings.length && !editing && <Text style={styles.smallMuted}>Save an apartment from Search to plan a tour.</Text>}
        <Field label="Tour date (YYYY-MM-DD)" value={date} onChangeText={value => { if (!saving.current) setDate(value); }} placeholder="2026-12-05" maxLength={10} />
        <Field label="Start time (HH:mm, 24-hour device time)" value={time} onChangeText={value => { if (!saving.current) setTime(value); }} placeholder="14:30" maxLength={5} />
        <Field label="Duration in minutes" value={duration} onChangeText={value => { if (!saving.current) setDuration(value); }} keyboardType="number-pad" maxLength={3} />
        <Field label="Appointment notes (included in calendar export)" value={notes} onChangeText={value => { if (!saving.current) setNotes(value); }} maxLength={2000} />
        <Button disabled={busy || (!editing && tours.length >= MAX_TOURS)} onPress={add}>{editing ? 'Save appointment changes' : 'Add planned tour'}</Button>
        {editing && <Button secondary disabled={busy} onPress={clearForm}>Cancel editing</Button>}
        <Text style={styles.smallMuted}>{tours.length} / {MAX_TOURS} tours. Route uses the selected day and follows the order below without optimization. Travel time is not included; leave time between appointments.</Text>
        {!!tours.length && <>
          <Button secondary disabled={busy} onPress={() => save(chronologicalTours(tours))}>Order by appointment time</Button>
          <Button secondary disabled={busy} onPress={calendar}>Export calendar (.ics)</Button>
          <Text style={styles.fieldLabel}>Route day (device timezone)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{days.map(day => <Chip key={day} selected={selectedDay === day} onPress={() => setRouteDay(day)}>{day}</Chip>)}</View>
          <Text style={styles.smallMuted}>{selectedDay}: {routeTours.length} stops. Day selection changes only the route, not your saved appointments or calendar export.</Text>
          {route ? <Link label="Open walking route in Google Maps" url={route} onError={setError} /> : <Text style={styles.smallMuted}>Route links require 2–5 stops on the selected day and valid addresses short enough for a Maps URL. No stops are silently omitted.</Text>}
        </>}
        {tours.map((t, i) => <View key={t.id} style={{ borderWidth: 1, borderColor: '#ddd', padding: 12, gap: 8 }}>
          <Text style={styles.fieldLabel}>{i + 1}. {t.address}</Text><Text>{new Date(t.startsAt).toLocaleString()} · {t.minutes} minutes</Text>
          {overlaps.has(t.id) && <Text accessibilityRole="alert" style={styles.error}>Overlaps another planned appointment.</Text>}
          {!!t.notes && <Text>{t.notes}</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button secondary disabled={busy || i === 0} onPress={() => save(moveTour(tours,t.id,-1))}>Move up</Button>
            <Button secondary disabled={busy || i === tours.length-1} onPress={() => save(moveTour(tours,t.id,1))}>Move down</Button>
            <Button secondary disabled={busy} onPress={() => edit(t)}>Edit tour</Button>
            <Button secondary disabled={busy} onPress={async () => { if (await save(tours.filter(item => item.id !== t.id))) { if (editing === t.id) clearForm(); } }}>Remove tour</Button>
          </View>
          {TOUR_CHECKLIST.map((item,index) => <Pressable key={item} disabled={busy} accessibilityRole="checkbox" accessibilityState={{ checked: t.checked.includes(index), disabled: busy }} aria-checked={t.checked.includes(index)} aria-disabled={busy} onPress={() => save(tours.map(other => other.id === t.id ? { ...t, checked: t.checked.includes(index) ? t.checked.filter(n => n !== index) : [...t.checked,index] } : other))} style={{ padding: 8, minHeight: 44 }}><Text>{t.checked.includes(index) ? '☑ ' : '☐ '}{item}</Text></Pressable>)}
        </View>)}
      </>}
    </>}
  </View>;
}
