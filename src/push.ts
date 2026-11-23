/**
 * Turning on notifications in the browser. On iPhone and iPad, Safari delivers notifications only to an
 * app added to the Home Screen (iOS 16.4 or later); Android and desktop browsers support them in a tab.
 */
export type PushSupport = 'available' | 'install-first' | 'blocked' | 'unsupported';
export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };

type Registration = { pushManager: {
  getSubscription(): Promise<{ unsubscribe(): Promise<boolean> } | null>;
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<{ toJSON(): unknown }>;
} };
export type PushBrowser = {
  userAgent: string; standalone: boolean; permission: 'default' | 'granted' | 'denied' | null;
  register(): Promise<Registration> | null; requestPermission(): Promise<string>;
};

/** The real browser, or null outside one (native builds, tests). */
export function browserPush(): PushBrowser | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return {
    userAgent: navigator.userAgent,
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
    permission: supported ? Notification.permission : null,
    register: () => supported ? navigator.serviceWorker.register('/sw.js') as unknown as Promise<Registration> : null,
    requestPermission: () => Notification.requestPermission(),
  };
}

const isAppleMobile = (userAgent: string) => /iPhone|iPad|iPod/.test(userAgent);

export function pushSupport(browser: PushBrowser | null): PushSupport {
  if (!browser) return 'unsupported';
  if (browser.permission === 'denied') return 'blocked';
  if (browser.permission !== null) return 'available';
  return isAppleMobile(browser.userAgent) && !browser.standalone ? 'install-first' : 'unsupported';
}

/** A short name for this device, shown in the list of devices that get notifications. */
export function deviceLabel(userAgent: string) {
  const device = /iPhone/.test(userAgent) ? 'iPhone' : /iPad/.test(userAgent) ? 'iPad' : /Android/.test(userAgent) ? 'Android'
    : /Macintosh/.test(userAgent) ? 'Mac' : /Windows/.test(userAgent) ? 'Windows' : 'Computer';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : '';
  return browser ? `${device} · ${browser}` : device;
}

const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));

/** Asks for permission and subscribes this device with the server's public key. */
export async function subscribePush(publicKey: string, browser: PushBrowser | null = browserPush()): Promise<PushSubscriptionJson> {
  const registration = await browser?.register();
  if (!browser || !registration) throw new Error('This browser cannot show notifications from the app.');
  if (await browser.requestPermission() !== 'granted') throw new Error('Notifications were not allowed. Allow them in this browser’s settings, then try again.');
  // A subscription made with another server key cannot be reused, so start fresh.
  await (await registration.pushManager.getSubscription())?.unsubscribe();
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
  return subscription.toJSON() as PushSubscriptionJson;
}
