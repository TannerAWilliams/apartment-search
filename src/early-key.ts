/** Where the page's early script leaves its requests: a key per request, and its response on the way. */
export type EarlyRequests = Record<string, Promise<Response> | undefined>;
/** A request's key: its address, and its body when it has one. */
export const earlyKey = (url: string, body?: unknown) => url + (typeof body === 'string' ? ' ' + body : '');
