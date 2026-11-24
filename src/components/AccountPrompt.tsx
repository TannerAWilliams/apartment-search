/**
 * Where something belongs to an account (saved apartments, alerts, a shared list, your own listings): what an
 * account adds, and the email-code sign-in that creates one. Everything else works without signing in.
 */
import { Text, View } from 'react-native';
import { colors, styles } from '../styles.ts';
import { SignIn } from './SignIn.tsx';

export function AccountPrompt({ reason, onSignedIn }: { reason: string; onSignedIn: (token: string) => void }) {
  return (
    <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', gap: 12, paddingVertical: 16 }}>
      <Text accessibilityRole="header" style={{ fontSize: 26, lineHeight: 32, fontWeight: '700', color: colors.ink }}>
        Create a free account to {reason}
      </Text>
      <Text style={styles.bodyText}>
        Searching, market data and every other tool work without one. An account keeps your saved apartments, alerts and shared list on
        every device. Enter your email and we’ll send a six-digit code; no password.
      </Text>
      <View style={[styles.signInCard, { marginTop: 0 }]}>
        <SignIn onSignedIn={onSignedIn} primary />
      </View>
    </View>
  );
}
