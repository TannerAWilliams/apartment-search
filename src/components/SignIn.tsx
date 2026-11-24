/** Sign-in with an email code: type your email, get a six-digit code by email, type the code. */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { API_ORIGIN } from '../app-shared.ts';
import { styles } from '../styles.ts';
import { Button, Field } from './ui.tsx';

async function post(path: string, body: object) {
  const response = await fetch(`${API_ORIGIN}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'That did not work. Check the code and try again.',
    );
  return response;
}

/** Calls onSignedIn with the session token the native app sends from now on (the web app gets a cookie and an empty token). */
/** `primary` draws the first button as the page's main action, as on the landing page. */
export function SignIn({ onSignedIn, primary = false }: { onSignedIn: (token: string) => void; primary?: boolean }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      const address = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter your email address.');
      await post('email-otp/send-verification-otp', { email: address, type: 'sign-in' });
      setSentTo(address);
      setCode('');
    });

  const signIn = () =>
    run(async () => {
      if (!/^\d{6}$/.test(code.trim())) throw new Error('Enter the six-digit code from the email.');
      const response = await post('sign-in/email-otp', { email: sentTo, otp: code.trim() });
      onSignedIn(response.headers.get('set-auth-token') ?? '');
    });

  return (
    <View style={styles.tokenForm}>
      {!sentTo ? (
        <>
          <Field
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            maxLength={254}
          />
          <Button secondary={!primary} onPress={sendCode} disabled={busy}>
            {busy ? 'Sending…' : 'Email me a sign-in code'}
          </Button>
        </>
      ) : (
        <>
          <Text style={styles.smallMuted}>If {sentTo} can sign in, a code is on its way. It expires in 10 minutes.</Text>
          <Field
            label="Sign-in code"
            placeholder="6-digit code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button secondary onPress={signIn} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <Button secondary onPress={() => setSentTo('')} disabled={busy}>
            Use a different email
          </Button>
        </>
      )}
      {message ? (
        <Text accessibilityRole="alert" style={styles.smallMuted}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}
