const encoder = new TextEncoder();

/**
 * Compares two secrets without revealing, through response timing, how much of them matched: both are hashed
 * to 32 bytes with SHA-256 (Web Crypto), and every byte of the two hashes is compared.
 */
export async function secretsEqual(a: string, b: string) {
  const [left, right] = await Promise.all([a, b].map(async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))));
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
