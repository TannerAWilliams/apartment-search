import { test, expect } from 'bun:test';
import base64 from 'base64-js';
import { gunzipSync, strFromU8 } from 'fflate';

test('Bun snapshot gzip remains compatible with the browser decoder', () => {
  const original = { month: '2026-01', rows: [['Café', null, 0, 1800]] };
  for (const options of [{}, { level: 9 as const }]) {
    const encoded = base64.fromByteArray(Bun.gzipSync(JSON.stringify(original), options));
    const bytes = base64.toByteArray(encoded);
    expect([...bytes.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
    expect(JSON.parse(strFromU8(gunzipSync(bytes)))).toEqual(original);
  }
});
