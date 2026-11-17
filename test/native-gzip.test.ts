import { test, expect } from 'bun:test';
import { gunzipSync, strFromU8 } from 'fflate';

test('Bun snapshot gzip remains compatible with the browser decoder', () => {
  const original = { month: '2026-01', rows: [['Café', null, 0, 1800]] };
  for (const options of [{}, { level: 9 as const }]) {
    const encoded = Buffer.from(Bun.gzipSync(JSON.stringify(original), options)).toString('base64');
    const bytes = Buffer.from(encoded, 'base64');
    expect([...bytes.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
    expect(JSON.parse(strFromU8(gunzipSync(bytes)))).toEqual(original);
  }
});
