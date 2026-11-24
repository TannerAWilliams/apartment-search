/** What a pushed alert shows. Shared by the service worker and its tests. */
type PushedAlert = { title: string; body: string; tag?: string; url: string };

/** The notification for a push message, with safe defaults for anything missing or malformed. */
export function alertFromPush(data: { json(): unknown } | null): PushedAlert {
  let value: Record<string, unknown> = {};
  try {
    const parsed = data?.json();
    if (parsed && typeof parsed === 'object') value = parsed as Record<string, unknown>;
  } catch {
    /* not JSON: use the defaults */
  }
  return {
    title: typeof value.title === 'string' ? value.title : 'Walkup',
    body: typeof value.body === 'string' ? value.body : 'A saved search has new matches.',
    tag: typeof value.tag === 'string' ? value.tag : undefined,
    url: typeof value.url === 'string' && value.url.startsWith('/') ? value.url : '/',
  };
}
