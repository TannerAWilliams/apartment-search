import { expect, test } from 'bun:test';
import { readBuildingFacts } from '../server/building-facts.ts';
import { findHousehold } from '../server/households.ts';
import { zipComplaints } from '../server/neighborhoods.ts';
import { readSettings } from '../server/nightly.ts';
import { readPaidList } from '../server/plans.ts';
import { readSaved } from '../server/saved.ts';
import { handleApi } from './fixtures/api.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const garbled = () => {
  const bucket = createMemoryBucket();
  return { ...bucket, get: async (key: string) => (await bucket.get(key)) ?? { ...(await textObject()), key } };
};
async function textObject() {
  const holder = createMemoryBucket();
  await holder.put('x', 'not json');
  return (await holder.get('x'))!;
}

test('a stored document that is not JSON reads as empty, never as a crash', async () => {
  const bucket = garbled();
  expect(await readBuildingFacts(bucket)).toEqual({});
  expect(await readPaidList(bucket)).toEqual([]);
  expect(await readSaved(bucket, 'a@example.test')).toEqual([]);
  expect((await readSettings(bucket)).nightlyResync).toBe(true);
  expect(await findHousehold(bucket, 'a@example.test')).toBeNull();
  const complaints = await zipComplaints(bucket, '10014', async () => Response.json([]), new Date('2026-11-24T00:00:00Z'));
  expect(complaints.counts.Noise).toBe(0);
});

test('a building report is still answered when its facts cannot be kept', async () => {
  const bucket = {
    ...createMemoryBucket(),
    get: async () => null,
    put: async () => {
      throw new Error('storage down');
    },
  };
  const city = async (url: string) =>
    Response.json(
      new URL(url).pathname.includes('kj4p')
        ? [
            {
              buildingid: '1',
              boroid: '3',
              boro: 'BROOKLYN',
              housenumber: '1',
              streetname: 'MAIN STREET',
              zip: '11201',
              recordstatus: 'Active',
            },
          ]
        : [],
    );
  const response = await handleApi(
    new Request('https://app.test/api/building-report', {
      method: 'POST',
      body: JSON.stringify({ address: '1 Main Street', city: 'Brooklyn', state: 'NY', zip: '11201' }),
      headers: { 'Content-Type': 'application/json' },
    }),
    { BUCKET: bucket },
    { fetcher: city },
  );
  expect(response.status).toBe(200);
});
