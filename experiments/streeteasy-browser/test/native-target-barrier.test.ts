import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeTargetBarrier, type TargetBarrierTransport, type PausedTarget } from '../server/native-target-barrier.ts';
const main: PausedTarget = {targetId:'main',sessionId:'s1',type:'page',waitingForDebugger:true};
const frame: PausedTarget = {targetId:'frame',sessionId:'s2',type:'iframe',parentSessionId:'s1',waitingForDebugger:true};
function fake() {
  const calls: string[] = [];
  const transport: TargetBarrierTransport = {
    autoAttach: async id => {calls.push(`attach:${id ?? 'root'}`);},
    installHttpGuard: async id => {calls.push(`http:${id}`);},
    blockWebSockets: async id => {calls.push(`ws:${id}`);},
    resume: async id => {calls.push(`resume:${id}`);},
    closeBrowser: async () => {calls.push('close');},
  };
  return {calls,transport};
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => {resolve=r;}); return {promise,resolve}; }
test('main and child resume only after every guard; child waits for parent', async () => {
  const {calls,transport}=fake(); const b=new NativeTargetBarrier(transport,'main'); await b.start();
  await Promise.all([b.attached(main),b.attached(frame)]);
  assert.deepEqual(calls,['attach:root','attach:s1','http:s1','ws:s1','resume:s1','attach:s2','http:s2','ws:s2','resume:s2']); await b.close();
});
test('initial attach race waits for root auto attach acknowledgment', async () => {
  const {calls,transport}=fake(); const gate=deferred(); const orig=transport.autoAttach;
  transport.autoAttach=async(id,s)=>{await orig(id,s); if(!id) await gate.promise;};
  const b=new NativeTargetBarrier(transport,'main'); const start=b.start(); const attach=b.attached(main);
  await new Promise(r=>setImmediate(r)); assert.deepEqual(calls,['attach:root']); gate.resolve(); await Promise.all([start,attach]); assert.ok(calls.includes('resume:s1')); await b.close();
});
for (const type of ['worker','service_worker','shared_worker','other','browser','webview']) test(`denies ${type} without resume`,async()=>{
  const {calls,transport}=fake(); const b=new NativeTargetBarrier(transport,'main'); await b.start(); await b.attached({...frame,type}); assert.deepEqual(calls,['attach:root','close']);
});
test('denies popup, orphan frame, unpaused target, unknown main and pre-start event',async()=>{
  for(const target of [{...main,openerId:'x'},{...frame,parentSessionId:'unknown'},{...main,waitingForDebugger:false},{...main,targetId:'other'}]) {
    const {calls,transport}=fake(); const b=new NativeTargetBarrier(transport,'main'); await b.start(); await b.attached(target); assert.deepEqual(calls,['attach:root','close']);
  }
  const {calls,transport}=fake(); const b=new NativeTargetBarrier(transport,'main'); await b.attached(main); assert.deepEqual(calls,['close']);
});
test('failure at any setup step closes browser with no subsequent resume',async()=>{
  for(const key of ['autoAttach','installHttpGuard','blockWebSockets'] as const) {
    const {calls,transport}=fake(); const b=new NativeTargetBarrier(transport,'main'); await b.start(); transport[key]=async()=>{throw Error('secret error');}; await b.attached(main); assert.equal(calls.at(-1),'close'); assert.equal(calls.some(x=>x.startsWith('resume:')),false);
  }
});
test('detach while guard pending aborts and late resolution cannot resume',async()=>{
  const {calls,transport}=fake(); const gate=deferred(); transport.installHttpGuard=()=>gate.promise;
  const b=new NativeTargetBarrier(transport,'main'); await b.start(); const task=b.attached(main); await new Promise(r=>setImmediate(r)); await b.detached('s1'); await task; gate.resolve(); await new Promise(r=>setImmediate(r)); assert.equal(calls.includes('resume:s1'),false); assert.equal(calls.filter(x=>x==='close').length,1);
});
test('hung parent setup times out, closes once, never resumes queued child',async()=>{
  const {calls,transport}=fake(); transport.installHttpGuard=()=>new Promise(()=>{});
  const b=new NativeTargetBarrier(transport,'main',10); await b.start(); await Promise.all([b.attached(main),b.attached(frame)]); assert.equal(calls.filter(x=>x==='close').length,1); assert.equal(calls.some(x=>x.startsWith('resume:')),false);
});
test('duplicate identity and transport failure close once',async()=>{
  const {calls,transport}=fake(); const b=new NativeTargetBarrier(transport,'main'); await b.start(); await b.attached(main); await b.attached({...frame,sessionId:'s1'}); await b.transportFailed(); assert.equal(calls.filter(x=>x==='close').length,1);
});
test('closure failure is observable, never reported as successful shutdown',async()=>{
  const {transport}=fake(); transport.closeBrowser=async()=>{throw Error('close failed');}; const b=new NativeTargetBarrier(transport,'main'); await assert.rejects(b.transportFailed(),/close failed/); assert.equal(b.stopped,true);
});
test('root setup failure and resume failure invalidate browser',async()=>{
  for(const phase of ['root','resume']) {
    const {calls,transport}=fake(); const b=new NativeTargetBarrier(transport,'main');
    if(phase==='root') transport.autoAttach=async()=>{throw Error('failed');};
    else transport.resume=async()=>{throw Error('failed');};
    await b.start(); await b.attached(main); assert.equal(b.stopped,true); assert.equal(calls.filter(x=>x==='close').length,1);
  }
});
test('target identity cannot be reused with a different session',async()=>{
  const {calls,transport}=fake(); const b=new NativeTargetBarrier(transport,'main'); await b.start(); await b.attached(main); await b.attached({...main,sessionId:'new'}); assert.equal(b.stopped,true); assert.equal(calls.includes('resume:new'),false);
});
test('target count is bounded including root page',async()=>{
  const {calls,transport}=fake(); const b=new NativeTargetBarrier(transport,'main'); await b.start(); await b.attached(main);
  for(let i=0;i<16;i++) await b.attached({...frame,targetId:`f${i}`,sessionId:`frame${i}`});
  assert.equal(b.stopped,true); assert.equal(calls.filter(x=>x.startsWith('resume:')).length,16); assert.equal(calls.includes('resume:frame15'),false);
});
