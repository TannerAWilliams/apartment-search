/** Explicit executable for synthetic qualification only. No provider traffic. */
import { createNativeFixture } from './native-fixture-server.ts';
const {server} = createNativeFixture({
 origin: process.env.RENDER_EXTERNAL_URL || '',
 peerOrigin: process.env.NATIVE_FIXTURE_PEER || '',
 controlToken: process.env.NATIVE_FIXTURE_CONTROL_TOKEN || '',
});
const port = Number(process.env.PORT || '10000');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid fixture port');
server.listen(port,'0.0.0.0',()=>console.log('Synthetic native fixture ready'));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>server.close(()=>process.exit(0)));
