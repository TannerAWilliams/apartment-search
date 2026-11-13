/** Fixed vendor endpoint. Never accept arbitrary WebSocket URLs from requests. */
export const REMOTE_BROWSER_TIMEOUT_MS = 110_000;
export function remoteBrowserEndpoint(token: string): string {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(token)) throw new Error('Invalid remote browser configuration');
  const url = new URL('wss://production-sfo.browserless.io/chromium/playwright');
  url.searchParams.set('token', token);
  url.searchParams.set('timeout', String(REMOTE_BROWSER_TIMEOUT_MS));
  return url.href;
}
/** Vendor errors may embed a credential-bearing URL. Never propagate them. */
export async function connectRemoteBrowser<T>(token: string, connect: (url: string, options: { timeout: number }) => Promise<T>): Promise<T> {
  const endpoint = remoteBrowserEndpoint(token);
  try { return await connect(endpoint, { timeout: 15_000 }); }
  catch (error) {
    const detail = error instanceof Error ? error.message.replace(/(?:wss?|https?):\/\/\S+/g, '[endpoint]').split(token).join('[credential]') : '';
    const category = /EPERM|EACCES/.test(detail) ? 'local-permission' : /ENOTFOUND/.test(detail) ? 'dns' : /ECONNREFUSED/.test(detail) ? 'refused' : /403/.test(detail) ? 'forbidden' : /401/.test(detail) ? 'unauthorized' : /429/.test(detail) ? 'quota' : /timeout/i.test(detail) ? 'timeout' : /version/i.test(detail) ? 'version' : 'unknown';
    throw new Error('Remote browser connection failed' + (category === 'unknown' ? '' : ' (' + category + ')'));
  }
}
