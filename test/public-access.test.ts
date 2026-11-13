import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicRequestLimits, isPublicRefresh } from '../server/public-access.ts';
test('public refresh allows fetching but rejects anonymous imports and extra properties', () => {
  assert.equal(isPublicRefresh({check:'now'}), true);
  assert.equal(isPublicRefresh({check:'now',source:'streeteasy-live',sessionStart:false}), true);
  for (const body of [null,[],{}, {check:'now',imports:{}},{check:'now',fallback:true},{check:'now',source:{}},{check:'now',sessionStart:'true'}]) assert.equal(isPublicRefresh(body),false);
});
test('refresh cooldown is global and resets after a minute', () => {
  let time = 1000; const limits = createPublicRequestLimits(() => time);
  assert.equal(limits.refreshRetrySeconds(),0);
  assert.equal(limits.refreshRetrySeconds(),60);
  time += 30_001; assert.equal(limits.refreshRetrySeconds(),30);
  time += 30_000; assert.equal(limits.refreshRetrySeconds(),0);
});
test('public API budget is bounded independent of spoofed IP headers', () => {
  let time=1000; const limits=createPublicRequestLimits(() => time);
  for(let i=0;i<240;i++) assert.equal(limits.allowApi(),true);
  assert.equal(limits.allowApi(),false);
  time+=60_000; assert.equal(limits.allowApi(),true);
});
test('reading remaining cooldown never reserves or extends a refresh slot', () => {
  let time = 1000; const limits = createPublicRequestLimits(() => time);
  assert.equal(limits.refreshRemainingSeconds(), 0);
  assert.equal(limits.refreshRemainingSeconds(), 0);
  assert.equal(limits.refreshRetrySeconds(), 0);
  time += 59_001;
  assert.equal(limits.refreshRemainingSeconds(), 1);
  assert.equal(limits.refreshRemainingSeconds(), 1);
  time += 999;
  assert.equal(limits.refreshRemainingSeconds(), 0);
  assert.equal(limits.refreshRetrySeconds(), 0);
});
