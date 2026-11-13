/** Explicit synthetic-only remote qualification. No provider URLs or caller URLs. */
import { timingSafeEqual } from 'node:crypto';
import { nativeBrowserEndpoint } from '../server/native-browser-connection.ts';
import { NativeFixtureController } from './native-fixture-controller.ts';
export type NativeResult = { status:'passed'|'failed'; checks: Array<{name:string;passed:boolean;evidence?:Record<string,number|boolean>}>; termination:string; completeQualification:false };
export function fixtureDocumentMatches(snapshot:{url:string;readyState:string;text:string},url:string,expected:string){return snapshot.url===url&&snapshot.readyState!=='loading'&&snapshot.text.trimEnd()===expected}
export async function runNativeFixtureBasics(token:string,signal:AbortSignal):Promise<NativeResult>{
 if(signal.aborted)throw Error('Canceled');
 const socket=new WebSocket(nativeBrowserEndpoint(token));
 let controller:NativeFixtureController|undefined;
 const checks:Array<{name:string;passed:boolean;evidence?:Record<string,number|boolean>}>=[];
 let timedOut=false;
 const cancel=()=>{timedOut=true;if(controller)void controller.close().catch(()=>{}).finally(()=>socket.close());else socket.close();};
 signal.addEventListener('abort',cancel,{once:true});
 const deadline=setTimeout(cancel,90000);
 try {
  await new Promise<void>((ok,no)=>{const timer=setTimeout(()=>no(Error('open timeout')),15000);const finish=(pass:boolean)=>{clearTimeout(timer);pass?ok():no(Error('open failed'));};socket.addEventListener('open',()=>finish(true),{once:true});socket.addEventListener('error',()=>finish(false),{once:true});socket.addEventListener('close',()=>finish(false),{once:true});});
  controller=new NativeFixtureController(socket,{ownedDisposableBrowser:true,origins:['https://apartment-native-fixture-a.onrender.com','https://apartment-native-fixture-b.onrender.com']});
  await controller.start();checks.push({name:'bootstrap',passed:true});
  const cases=[['health','/health','fixture-only'],['cookie-set','/cookie','cookie-set'],['cookie-persisted','/cookie/check','{"present":true}'],['gzip-decoded','/gzip','native-fixture-decoded-body\n'.repeat(128).trimEnd()],['br-decoded','/br','native-fixture-decoded-body\n'.repeat(128).trimEnd()]];
  for(const [name,path,expected] of cases){
   if(timedOut)throw Error('deadline');
   await controller.navigate('https://apartment-native-fixture-a.onrender.com'+path);
   let passed=false;
   for(let attempt=0;attempt<30&&!timedOut;attempt++){await new Promise(r=>setTimeout(r,100));const snapshot=await controller.documentSnapshot();if(fixtureDocumentMatches(snapshot,'https://apartment-native-fixture-a.onrender.com'+path,expected)){passed=true;break;}}
   checks.push({name,passed});if(!passed)break;
  }
 } catch {checks.push({name:'execution',passed:false});}
 finally {if(controller)try{await controller.close()}catch{}else socket.close();clearTimeout(deadline);signal.removeEventListener('abort',cancel);}
 const termination=controller?.terminationState||'unconfirmed';
 return {status:checks.length===6&&checks.every(c=>c.passed)&&termination==='acknowledged'?'passed':'failed',checks,termination,completeQualification:false};
}
/** Authenticated, once-per-process explicit trigger. Never starts from health/read. */
export function nativeQualificationGate(controlToken:string,run:(signal:AbortSignal)=>Promise<NativeResult>,idle:()=>boolean,path='/native/qualification'){
 const abort=new AbortController();
 let state:'idle'|'running'|'finished'='idle';let result:NativeResult|undefined;let runningWork:Promise<void>|undefined;
 const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return {cancel(){abort.abort();return runningWork||Promise.resolve()},get running(){return state==='running'},async handle(request:Request):Promise<Response|undefined>{
  if(new URL(request.url).pathname!==path)return;
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(controlToken))return reply(404,{error:'disabled'});
  const got=Buffer.from(request.headers.get('authorization')||''),want=Buffer.from('Bearer '+controlToken);
  if(got.length!==want.length||!timingSafeEqual(got,want))return reply(401,{error:'unauthorized'});
  if(request.method==='GET')return reply(200,{state,result});
  if(request.method!=='POST')return reply(405,{error:'method'});
  if(abort.signal.aborted||state!=='idle'||!idle())return reply(409,{error:'busy-or-already-used'});
  state='running';runningWork=Promise.resolve().then(()=>run(abort.signal)).then(r=>{result=r},()=>{result={status:'failed',checks:[],termination:'unconfirmed',completeQualification:false}}).finally(()=>{state='finished'});
  return reply(202,{state});
 }};
}

/** Destination counters are inspected separately; this reports exercise/cleanup only. */
export async function runNativeFixtureContainment(token:string,signal:AbortSignal):Promise<NativeResult>{
 const checks:Array<{name:string;passed:boolean;evidence?:Record<string,number|boolean>}>=[];let termination='not-requested';
 for(const [name,path] of [['redirect','/redirect'],['forbidden-iframe','/harness/iframe'],['worker','/harness/worker'],['websocket','/harness/websocket'],['overflow','/overflow']]){
  if(signal.aborted)break;
  const socket=new WebSocket(nativeBrowserEndpoint(token));let controller:NativeFixtureController|undefined;let opened=false;let navigationAttempted=false;
  const cancel=()=>{if(controller)void controller.close().catch(()=>{}).finally(()=>socket.close());else socket.close()};
  signal.addEventListener('abort',cancel,{once:true});const deadline=setTimeout(cancel,18000);
  try {
   await new Promise<void>((ok,no)=>{const timer=setTimeout(()=>no(Error('open timeout')),10000);const finish=(pass:boolean)=>{clearTimeout(timer);pass?ok():no(Error('open failed'))};socket.addEventListener('open',()=>finish(true),{once:true});socket.addEventListener('error',()=>finish(false),{once:true});socket.addEventListener('close',()=>finish(false),{once:true})});opened=true;
   // The second controlled fixture is intentionally NOT admitted. Requests to it
   // must be blocked, with zero arrivals verified at its independent counters.
   controller=new NativeFixtureController(socket,{ownedDisposableBrowser:true,origins:['https://apartment-native-fixture-a.onrender.com','https://qualification-unused.invalid']});
   await controller.start();navigationAttempted=true;
   try{await controller.navigate('https://apartment-native-fixture-a.onrender.com'+path)}catch{/* Navigation rejection is expected for denied/oversized responses. */}
   await new Promise(r=>setTimeout(r,1000));
  }catch{/* Never return endpoint/token-bearing errors. */}
  finally{if(controller)try{await controller.close()}catch{}else socket.close();clearTimeout(deadline);signal.removeEventListener('abort',cancel)}
  termination=controller?.terminationState||'unconfirmed';
  const evidence=controller?.observations;
  const faultObserved=!!evidence&&({redirect:evidence.redirectResponses>0,'forbidden-iframe':evidence.deniedOriginRequests>0,worker:evidence.workerTargets>0,websocket:evidence.webSocketCspBlocked>0,overflow:evidence.resourceOverflow} as Record<string,boolean>)[name];
  const passed=faultObserved&&opened&&navigationAttempted&&termination==='acknowledged'&&controller?.pendingLocalWork.active===0&&controller.pendingLocalWork.queued===0;
  checks.push({name:name+'-exercised-and-cleaned',passed,evidence:controller?.observations});if(!passed)break;
 }
 return {status:checks.length===5&&checks.every(c=>c.passed)?'passed':'failed',checks,termination,completeQualification:false};
}
