/**
 * The application kit (src/application-kit.ts): a renter profile, the income rule, the documents to gather and a
 * ready-written inquiry for any saved apartment. Everything here stays on this device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import {
  DOCUMENTS,
  emptyProfile,
  GUARANTOR_MULTIPLE,
  INCOME_MULTIPLE,
  incomeCheck,
  inquiryText,
  PROFILE_FIELDS,
  profileText,
  type RenterProfile,
} from '../application-kit.ts';
import type { ListingData } from '../domain.ts';
import { formatRent } from '../search.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Field } from '../components/ui.tsx';

const KEY = 'apartment-search:application-kit:v1';
type Kit = { profile: RenterProfile; documents: string[] };

/** Copies text on the web, or opens the share sheet in the app. */
async function copy(text: string) {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) await navigator.clipboard.writeText(text);
  else await Share.share({ message: text });
}

export function ApplyPage({ saved, onError }: { saved: ListingData[]; onError: (message: string) => void }) {
  const [kit, setKit] = useState<Kit>({ profile: emptyProfile(), documents: [] });
  const [loaded, setLoaded] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((value) => {
        const stored = value ? (JSON.parse(value) as Partial<Kit>) : {};
        setKit({ profile: { ...emptyProfile(), ...stored.profile }, documents: Array.isArray(stored.documents) ? stored.documents : [] });
      })
      .catch(() => onError('Your application kit could not be read from this device.'))
      .finally(() => setLoaded(true));
  }, [onError]);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(KEY, JSON.stringify(kit)).catch(() => onError('This device could not keep your application kit.'));
  }, [kit, loaded, onError]);

  const listing = saved.find(({ id }) => id === chosen) ?? null;
  const income = incomeCheck(kit.profile.annualIncome, listing?.rent);
  const share = async (text: string, done: string) => {
    try {
      await copy(text);
      setNotice(done);
    } catch {
      onError('That could not be copied.');
    }
  };
  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          Application kit
        </Text>
        <Text style={styles.bodyText}>
          Good apartments go fast. Fill this in once, gather your documents, and send a ready-written message the moment you find one. It
          stays on this device.
        </Text>
      </View>
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.fieldLabel}>
          Your renter profile
        </Text>
        {PROFILE_FIELDS.map(([key, label, placeholder]) => (
          <Field
            key={key}
            label={label}
            value={kit.profile[key]}
            placeholder={placeholder}
            maxLength={key === 'about' ? 200 : 80}
            keyboardType={key === 'annualIncome' || key === 'creditScore' ? 'number-pad' : key === 'email' ? 'email-address' : undefined}
            onChangeText={(text) => setKit((current) => ({ ...current, profile: { ...current.profile, [key]: text } }))}
          />
        ))}
        <Text style={styles.bodyText}>
          {income
            ? `Landlords usually want a yearly income of ${INCOME_MULTIPLE} times the rent: yours fits rents up to ${formatRent(income.maxRent)}.`
            : `Landlords usually want a yearly income of ${INCOME_MULTIPLE} times the rent, or a guarantor earning ${GUARANTOR_MULTIPLE} times.`}
        </Text>
        <Button secondary onPress={() => share(profileText(kit.profile), 'Your profile is copied.')}>
          Copy your profile
        </Button>
      </View>
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.fieldLabel}>
          Documents to have ready ({kit.documents.length} of {DOCUMENTS.length})
        </Text>
        <View style={styles.chipRow}>
          {DOCUMENTS.map((document) => (
            <Chip
              key={document}
              selected={kit.documents.includes(document)}
              onPress={() =>
                setKit((current) => ({
                  ...current,
                  documents: current.documents.includes(document)
                    ? current.documents.filter((item) => item !== document)
                    : [...current.documents, document],
                }))
              }
            >
              {document}
            </Chip>
          ))}
        </View>
        <Text style={styles.smallMuted}>In New York, an application fee can be at most $20, and the deposit at most one month’s rent.</Text>
      </View>
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.fieldLabel}>
          Write to a landlord or broker
        </Text>
        {saved.length === 0 ? (
          <Text style={styles.smallMuted}>Save an apartment first; then choose it here.</Text>
        ) : (
          <View style={styles.chipRow}>
            {saved.map((item) => (
              <Chip key={item.id} selected={chosen === item.id} onPress={() => setChosen(chosen === item.id ? null : item.id)}>
                {item.address}
              </Chip>
            ))}
          </View>
        )}
        {listing && income && 'qualifies' in income && (
          <Text style={styles.bodyText}>
            {income.qualifies
              ? `Your income meets the usual rule for ${formatRent(listing.rent)} (${formatRent(income.needed!)} a year).`
              : `The usual rule asks for ${formatRent(income.needed!)} a year; a guarantor would need ${formatRent(income.guarantorNeeds!)}.`}
          </Text>
        )}
        {listing && (
          <>
            <Text selectable style={styles.bodyText}>
              {inquiryText(kit.profile, listing)}
            </Text>
            <Button
              onPress={() =>
                share(inquiryText(kit.profile, listing), 'The message is copied. Paste it into the listing’s contact form or an email.')
              }
            >
              Copy the message
            </Button>
          </>
        )}
      </View>
      {notice !== '' && (
        <Text accessibilityRole="alert" style={styles.bodyText}>
          {notice}
        </Text>
      )}
    </View>
  );
}
