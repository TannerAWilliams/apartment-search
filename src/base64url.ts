/** Base64url (RFC 4648 §5), as JSON Web Tokens and Web Push keys use it: no padding, `-` and `_` for `+` and `/`. */
export const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));

export const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
