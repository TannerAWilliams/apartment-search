import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJerseyAffordable, loadJerseyAffordable } from '../server/jersey-affordable.ts';
const now = new Date('2026-11-19T12:00:00Z');
const notice = (name: string, address: string, counts: string) => `<p><strong>"${name}"</strong><br>"${name}" is located at ${address}, Jersey City, NJ 07302. This building has ${counts} available.</p>`;
const fixtures = [notice('Casa One','166 Van Reipen Ave.','7 studio apartments, 10 one-bedroom apartments, and 1 three-bedroom apartment'),notice('Modera Lofts','350 Warren St.','a studio apartment and 1 one-bedroom apartment and 2 two-bedroom apartments'),notice('40 Lembeck','40 Lembeck Ave.','2 two-bedroom apartments and 1 three-bedroom apartment'),notice('485 Marin','485 Marin Blvd.','3 studio apartments, 7 one-bedroom apartments, and 2 two-bedroom apartment')];
const page = (items = fixtures.join(''), date='11-16-2026') => `<div><h4><span>Current Affordable Housing Postings</span></h4><p>Flyer Attachment (Updated ${date}; 12 PM EST)</p><a href="https://affordablehousingjc.com/">Apply</a>${items}</div>`;
test('four structured notices preserve 37 published bedroom counts without prices or deadlines', () => {
 const data = parseJerseyAffordable(page(),now); assert.equal(data.total,37); assert.equal(data.notices.length,4); assert.deepEqual(data.notices[1].sizes,[1,1,2,0,0]); assert.equal(data.revision,'2026-11-16'); assert.equal('rent' in data.notices[0],false); assert.equal('closes' in data.notices[0],false);
});
test('empty, changed structure, invalid or future revisions fail rather than claiming zero', () => {
 for (const value of [page(''),page().replace('Current Affordable Housing Postings','Unavailable'),page().replace('https://affordablehousingjc.com/','https://example.com'),page(undefined,'02-30-2026'),page(undefined,'12-01-2026')]) assert.throws(()=>parseJerseyAffordable(value,now));
});
test('partial, duplicate or unfamiliar counts fail closed', () => {
 for (const value of [page(fixtures[0]+fixtures[0]),page().replace('7 studio apartments','seven studio apartments'),page().replace('7 studio apartments','0 studio apartments'),page().replace('7 studio apartments','1 studio apartment and 7 studio apartments'),page().replace('07302. This building','invalid. This building')]) assert.throws(()=>parseJerseyAffordable(value,now));
});
test('loader rejects HTTP, content type and oversized bodies; success uses only fixed official URL',async()=>{
 for(const response of [new Response('blocked',{status:403}),new Response('{}',{headers:{'content-type':'application/json'}}),new Response('x'.repeat(512001),{headers:{'content-type':'text/html'}})]) await assert.rejects(()=>loadJerseyAffordable(()=>response,now));
 const data=await loadJerseyAffordable((url,init)=>{assert.equal(new URL(url).hostname,'www.jerseycitynj.gov');assert.equal(init?.redirect,'error');return new Response(page(),{headers:{'content-type':'text/html'}})},now);assert.equal(data.total,37);
});

test('earlier unrelated h4 cannot supply the postings revision or application link',()=>{
 const outside = '<h4>Other content</h4><p>Updated 11-16-2026;</p><a href="https://affordablehousingjc.com/">Apply</a>';
 assert.throws(()=>parseJerseyAffordable(outside + '<h4>Current Affordable Housing Postings</h4>'+fixtures[0]+'</div>',now));
 assert.equal(parseJerseyAffordable(outside+page(),now).total,37);
});
