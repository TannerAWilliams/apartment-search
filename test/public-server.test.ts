import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, URL } from 'node:url';

test('public server opens browsing but blocks cross-origin writes and anonymous imports', async () => {
 const port=39876; const origin=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['--preload','./test/fixtures/offline-network.ts','server/main.ts'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,DATABASE_URL:'',HOST:'127.0.0.1',PORT:String(port),PUBLIC_APP:'true',APP_ACCESS_TOKEN:'test-only-secret'.repeat(3),RENDER_EXTERNAL_URL:origin},stdio:['ignore','pipe','pipe']});
 try {
  await Promise.race([once(child.stdout,'data'), new Promise((_,reject)=>setTimeout(()=>reject(new Error('Startup timed out')),5000).unref())]);
  const dashboard = await fetch(origin+'/api/dashboard'); assert.equal(dashboard.status,200); assert.equal((await dashboard.json()).files.length,45);
  assert.equal((await fetch(origin+'/api/dashboard',{headers:{Authorization:'Bearer '+ 'test-only-secret'.repeat(3)}})).status,200);
  const config=await fetch(origin+'/api/config'); assert.equal(config.status,200); assert.equal((await config.json()).browserImportAllowed,false);
  const home=await fetch(origin+'/'); assert.equal(home.status,200); assert.doesNotMatch(await home.text(),/Enter the access password/);
  const post=(body: unknown,site=origin)=>fetch(origin+'/api/refresh',{method:'POST',headers:{'Content-Type':'application/json',Origin:site},body:JSON.stringify(body)});
  assert.equal((await post({check:'now'},'https://evil.example')).status,403);
  assert.equal((await post({imports:{}})).status,403);
  // Invalid source exercises the accepted path without fetching any upstream provider.
  assert.equal((await post({check:'now',source:'nonexistent'})).status,422);
  const retry=await post({check:'now',source:'nonexistent'}); assert.equal(retry.status,429); assert.ok(Number(retry.headers.get('retry-after'))>0);
  const after=await fetch(origin+'/api/config'); assert.equal(after.status,200); assert.ok(Number(after.headers.get('x-refresh-retry-after'))>0);
  assert.ok(Number(after.headers.get('x-refresh-retry-after'))<=60);
 } finally { child.kill(); await once(child,'exit'); }
});
