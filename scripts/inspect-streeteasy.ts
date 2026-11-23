import { requirePinnedBun } from './check-runtime.ts';
import { MAX_PUBLIC_HTML_BYTES } from '../server/public-rentals.ts';
import { parseStreetEasyPublicSearch } from '../server/streeteasy.ts';

requirePinnedBun();

const usage = 'Usage: bun run inspect:streeteasy ./streeteasy.html';

async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  if (args.length !== 1) throw new Error(usage);

  const file = Bun.file(args[0]);
  if (!await file.exists()) throw new Error('The saved StreetEasy HTML file could not be opened.');
  if (file.size > MAX_PUBLIC_HTML_BYTES) throw new Error('The saved HTML exceeds the app’s 5 MiB page limit.');

  const page = await parseStreetEasyPublicSearch(await file.text(), new Date());
  const listings = page.listings.map(({ id, address, unit, rent, sources }) => {
    const url = sources.find(({ id: provider }) => provider === 'streeteasy')?.url ?? null;
    const listingId = id.match(/^streeteasy:(\d+)$/)?.[1] ?? url?.match(/\/rental\/(\d+)$/)?.[1] ?? null;
    return {
      title: unit ? address + ' #' + unit : address,
      monthlyRent: rent,
      listingId,
      url,
    };
  });
  console.log(JSON.stringify({
    coverage: 'one saved StreetEasy search page',
    reportedTotal: page.total,
    extractedCount: listings.length,
    listings,
  }, null, 2));
}

await main(Bun.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unable to inspect StreetEasy HTML.');
  process.exitCode = 1;
});
