import { test, expect } from 'bun:test';
import { inventoryUnavailable } from '../src/inventory-state.ts';
test('missing active inventory is not mislabeled a filtered zero', () => {
  expect(inventoryUnavailable({mode:'live',total:0,sources:[]})).toBe(true);
  expect(inventoryUnavailable({mode:'live',total:0,sources:[{id:'x',name:'X',status:'unavailable'}]})).toBe(true);
  expect(inventoryUnavailable({mode:'live',total:0,sources:[{id:'x',name:'X',status:'searched'}]})).toBe(false);
  expect(inventoryUnavailable({mode:'live',total:1,sources:[]})).toBe(false);
  expect(inventoryUnavailable({mode:'saved',total:0,sources:[]})).toBe(false);
  expect(inventoryUnavailable({mode:'snapshot',total:0,sources:[]})).toBe(false);
});
