import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('public server opens browsing but blocks cross-origin writes and anonymous imports', async () => {
 const port=39876; const origin=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['--experimental-strip-types','server/node.ts'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PUBLIC_APP:'true',APP_ACCESS_TOKEN:'test-only-secret'.repeat(3),RENDER_EXTERNAL_URL:origin},stdio:['ignore','pipe','pipe']});
 try {
  await Promise.race([once(child.stdout,'data'), new Promise((_,reject)=>setTimeout(()=>reject(new Error('Startup timed out')),5000).unref())]);
  const config=await fetch(origin+'/api/config'); assert.equal(config.status,200);
  const home=await fetch(origin+'/'); assert.equal(home.status,200); assert.doesNotMatch(await home.text(),/Enter the access password/);
  const post=(body,site=origin)=>fetch(origin+'/api/refresh',{method:'POST',headers:{'Content-Type':'application/json',Origin:site},body:JSON.stringify(body)});
  assert.equal((await post({check:'now'},'https://evil.example')).status,403);
  assert.equal((await post({imports:{}})).status,403);
  // Invalid source exercises the accepted path without fetching any upstream provider.
  assert.equal((await post({check:'now',source:'nonexistent'})).status,422);
  const retry=await post({check:'now',source:'nonexistent'}); assert.equal(retry.status,429); assert.ok(Number(retry.headers.get('retry-after'))>0);
 } finally { child.kill(); await once(child,'exit'); }
});
