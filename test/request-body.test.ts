import { test, expect } from 'bun:test';
import { readRequestBody, RequestTooLarge } from '../server/request-body.ts';
test('bounded body reads empty, exact-cap and multi-byte content by bytes', async () => {
  expect((await readRequestBody(new Request('http://localhost'), 4)).length).toBe(0);
  const exact = new Request('http://localhost', { method: 'POST', body: 'éé' });
  expect(new TextDecoder().decode(await readRequestBody(exact, 4))).toBe('éé');
  await expect(readRequestBody(new Request('http://localhost', { method: 'POST', body: 'ééé' }), 4)).rejects.toBeInstanceOf(RequestTooLarge);
});
test('oversized streaming body is canceled before further consumption', async () => {
  let canceled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { canceled = true; } });
  await expect(readRequestBody(new Request('http://localhost', { method: 'POST', body: stream }), 4)).rejects.toBeInstanceOf(RequestTooLarge);
  expect(canceled).toBe(true);
});
