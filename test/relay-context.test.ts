import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { relayRequest } from '../server/relay-policy.ts';

test('StreetEasy receives fixed source context, without caller-controlled credentials or identity', () => {
  for (const input of [
    {source:'streeteasy',page:1},
    {source:'streeteasy',page:2,lower:0,upper:2147483647},
    {source:'streeteasy',page:1,headers:{Origin:'https://evil.test',Referer:'http://localhost',Cookie:'secret',Authorization:'secret','User-Agent':'spoof'}},
  ]) {
    const request=relayRequest(input);
    assert.ok(request);
    const headers=new Headers(request.init.headers);
    assert.equal(headers.get('Origin'),'https://streeteasy.com');
    assert.equal(headers.get('Referer'),'https://streeteasy.com/for-rent/nyc');
    assert.equal(headers.get('Cookie'),null);
    assert.equal(headers.get('Authorization'),null);
    assert.equal(headers.get('User-Agent'),null);
    assert.equal(request.init.redirect,'error');
  }
});
test('StreetEasy context never leaks to other providers',()=>{
  const request=relayRequest({source:'hotpads',market:'new-york-ny'});
  assert.ok(request);
  assert.deepEqual(Object.fromEntries(new Headers(request.init.headers)),{accept:'text/html'});
});
