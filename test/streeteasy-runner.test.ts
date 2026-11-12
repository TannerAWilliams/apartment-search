import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for (const state of ['missing','stale','current']) test('external runner handles '+state+' inventory',()=>{
 const setup = `
 let imported=false;
 const state=${JSON.stringify(state)};
 const old=new Date(Date.now()-25*60*60_000).toISOString();
 globalThis.fetch=async(url,options)=>{
   if(String(url).startsWith('https://api-v6.streeteasy.com/')){
     if(state==='current')throw Error('current data must not be fetched');
     return Response.json({data:{searchRentals:{totalCount:0,edges:[]}}});
   }
   if(String(url).endsWith('/api/refresh')){imported=true;return Response.json({state:'complete'});}
   const now=new Date().toISOString();
   const sources=imported?[{id:'streeteasy-live',status:'updated',transport:'v6-daily',total:0,listingCount:0,updatedAt:now}]:
    state==='missing'?[]:[{id:'streeteasy-live',status:'updated',transport:'v6-daily',total:0,listingCount:0,updatedAt:state==='current'?now:old}];
   return Response.json({refresh:{sources}});
 };
 `;
 const result=spawnSync(process.execPath,['--experimental-strip-types','--import','data:text/javascript,'+encodeURIComponent(setup),'scripts/sync-streeteasy.ts'],
  {cwd:process.cwd(),input:'synthetic-test-token\n',encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).state,state==='current'?'already_current':'updated');
});
