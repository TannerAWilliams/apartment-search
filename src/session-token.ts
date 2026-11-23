/**
 * The native app's sign-in session token, kept in the device's secure storage (Keychain on iOS, Keystore on
 * Android). The web app keeps its session in a cookie instead, so these do nothing there.
 */
import { Platform } from 'react-native';

const KEY = 'apartment-search.session';
const native = Platform.OS !== 'web';
const store = () => import('expo-secure-store');

export async function savedSessionToken() {
  return native ? ((await (await store()).getItemAsync(KEY).catch(() => null)) ?? '') : '';
}

export async function saveSessionToken(token: string) {
  if (!native) return;
  const secure = await store();
  await (token ? secure.setItemAsync(KEY, token) : secure.deleteItemAsync(KEY));
}
