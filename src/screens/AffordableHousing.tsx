import type { HousingResponse } from '../../server/contracts.ts';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { NYC_SEARCH_DEFAULT } from '../regions.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Disclosure, Link } from '../components/ui.tsx';

const SIZE_LABELS = ['Studio', '1 BR', '2 BR', '3 BR', '4+ BR'];
const HOUSING_PORTAL = 'https://housingconnect.nyc.gov/PublicWeb/';
const HOUSING_DATA = 'https://data.cityofnewyork.us/d/vy5i-a666';
const HDC_PAGE = 'https://www.nychdc.com/find-re-rentals';
const JERSEY_PAGE = 'https://www.jerseycitynj.gov/CityHall/HousingAndDevelopment/affordable_housing/recent_affordable_housing_postings';
const JERSEY_APPLICATION = 'https://affordablehousingjc.com/';
const HOMESEEKER = 'https://homeseeker.westchestergov.com/Listings';
const DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const showDate = (date?: string) => (date ? DATE.format(new Date(date)) : 'unknown');

/** Where each program is applied for, by area. The links are the agencies' own pages. */
const PROGRAMS: [area: string, programs: [name: string, about: string, links: [label: string, url: string][]][]][] = [
  [
    'New York City',
    [
      [
        'Housing lotteries',
        'New income-restricted apartments, filled by lottery on Housing Connect. Open lotteries are listed below.',
        [['Housing Connect: open lotteries', 'https://housingconnect.nyc.gov/PublicWeb/search-lotteries']],
      ],
      [
        'Mitchell-Lama',
        'Middle-income rentals and co-ops with regulated costs. Most waiting lists are closed and reopen by lottery; a few are open and you apply to the building’s manager. Expect a wait of years.',
        [
          ['Waiting-list lotteries on Housing Connect', 'https://housingconnect.nyc.gov/PublicWeb/search-lotteries'],
          [
            'Developments with open waiting lists (PDF)',
            'https://www.nyc.gov/assets/hpd/downloads/pdfs/services/ML-waiting-Lists-Status.pdf',
          ],
          ['How Mitchell-Lama works (HPD)', 'https://www.nyc.gov/site/hpd/services-and-information/mitchell-lama-program.page'],
        ],
      ],
      [
        'Public housing (NYCHA)',
        'Apartments owned by the city’s housing authority, with rent set by income. One application covers every development; the wait is long.',
        [
          ['Apply for public housing', 'https://www.nyc.gov/site/nycha/eligibility/apply.page'],
          ['Check an application', 'https://selfserve.nycha.info/'],
        ],
      ],
    ],
  ],
  [
    'New Jersey',
    [
      [
        'Affordable and subsidized rentals',
        'The state’s free registry of affordable and accessible apartments, searchable by town and rent.',
        [['New Jersey Housing Resource Center', 'https://www.nj.gov/njhrc/find-housing/']],
      ],
    ],
  ],
  [
    'Long Island',
    [
      [
        'Affordable rental lotteries',
        'Income-restricted apartments in Nassau and Suffolk, each filled by its own lottery.',
        [['Long Island Housing Partnership: rentals', 'https://www.lihp.org/rentals/']],
      ],
    ],
  ],
  [
    'Connecticut',
    [
      [
        'Affordable and subsidized rentals',
        'The state’s housing search, from market-rate to affordable, accessible, senior and veteran housing.',
        [['CT Housing Search', 'https://cthousingsearch.org/']],
      ],
    ],
  ],
];

function Programs({ onError }: { onError: (message: string) => void }) {
  const [area, setArea] = useState(PROGRAMS[0]![0]);
  const programs = PROGRAMS.find(([name]) => name === area)![1];
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.chipRow}>
        {PROGRAMS.map(([name]) => (
          <Chip key={name} selected={name === area} onPress={() => setArea(name)}>
            {name}
          </Chip>
        ))}
      </View>
      {programs.map(([name, about, links]) => (
        <View key={name} style={[styles.chartCard, { gap: 6 }]}>
          <Text accessibilityRole="header" style={styles.listingTitle}>
            {name}
          </Text>
          <Text style={styles.bodyText}>{about}</Text>
          {links.map(([label, url]) => (
            <Link key={label} label={label} url={url} onError={onError} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function AffordableHousing({
  region,
  loadHousing,
  onError,
}: {
  region: string;
  loadHousing?: (signal: AbortSignal) => Promise<HousingResponse>;
  onError: (message: string) => void;
}) {
  const [data, setData] = useState<HousingResponse | null>(null);
  const [visible, setVisible] = useState(10);
  const [showRerentals, setShowRerentals] = useState(false);

  useEffect(() => {
    if (!loadHousing) return;
    const controller = new AbortController();
    loadHousing(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [loadHousing]);

  function inArea({ borough }: { borough?: string }) {
    const area = borough?.trim().toLowerCase();
    return region === NYC_SEARCH_DEFAULT ? area === 'manhattan' || area === 'brooklyn' : area === region;
  }
  const rerentals = data?.rerentals?.results.filter(inArea) ?? [];
  const opportunities = data?.opportunities.filter(inArea) ?? [];
  const showJersey = region === 'nj' || region === 'all';
  const showWestchester = region === 'westchester' || region === 'metroNorth' || region === 'all';
  const now = Date.now();

  return (
    <View style={styles.marketplacePanel}>
      <Text accessibilityRole="header" style={styles.panelTitle}>
        Lotteries and public housing
      </Text>
      <Text style={styles.bodyText}>
        Housing lotteries, Mitchell-Lama, public housing and income-restricted rentals, apart from market-rate apartments. Each is applied
        for on its own official site; Walkup links you to the right one.
      </Text>
      <Programs onError={onError} />
      {showWestchester && (
        <View style={styles.chartCard}>
          <Text accessibilityRole="header" style={styles.listingTitle}>
            Westchester County affordable housing
          </Text>
          <Text style={styles.smallMuted}>
            Lotteries, waitlists and first-come rentals from the county's HomeSeeker. Check eligibility, rents and units on each listing.
          </Text>
          {data?.westchester ? (
            <>
              {(() => {
                // Open opportunities first, as rows; ones whose applications closed wait behind a toggle.
                // Closed: the application deadline has passed, or, with no deadline, the lottery has already been held.
                const past = (date: string | null) => date !== null && Date.parse(date) < now;
                const ended = ({ applicationEnd, lottery }: { applicationEnd: string | null; lottery: string | null }) =>
                  past(applicationEnd) || (applicationEnd === null && past(lottery));
                const open = data.westchester.opportunities.filter((opportunity) => !ended(opportunity));
                const closed = data.westchester.opportunities.filter(ended);
                const row = (opportunity: (typeof open)[number], index: number) => (
                  <View key={opportunity.id} style={[{ paddingVertical: 12, gap: 3 }, index > 0 && styles.menuDivider]}>
                    <Text accessibilityRole="header" style={styles.fieldLabel}>
                      {opportunity.name}
                    </Text>
                    <Text style={styles.smallMuted}>{opportunity.location}</Text>
                    <Text style={styles.bodyText}>
                      {past(opportunity.applicationEnd)
                        ? 'Applications closed ' + showDate(opportunity.applicationEnd ?? undefined)
                        : opportunity.applicationEnd
                          ? 'Apply by ' + showDate(opportunity.applicationEnd)
                          : 'No application deadline listed'}
                      {opportunity.lottery ? ' · Lottery ' + showDate(opportunity.lottery) : ''}
                    </Text>
                    <Link label="View listing and apply" url={opportunity.url} onError={onError} />
                  </View>
                );
                return (
                  <>
                    <Text style={styles.smallMuted}>
                      {open.length} open · {closed.length} closed · Checked {showDate(data.westchester.checkedAt)}
                    </Text>
                    <View>{open.map(row)}</View>
                    {closed.length > 0 && (
                      <Disclosure title={`Closed applications (${closed.length})`}>
                        <View>{closed.map(row)}</View>
                      </Disclosure>
                    )}
                  </>
                );
              })()}
            </>
          ) : (
            <Text style={styles.smallMuted}>Nothing saved yet. Resync to check the county’s list, or open it below.</Text>
          )}
          <Link label="Westchester HomeSeeker" url={HOMESEEKER} onError={onError} />
        </View>
      )}
      {showJersey && (
        <View style={styles.chartCard}>
          <Text accessibilityRole="header" style={styles.listingTitle}>
            Jersey City affordable housing applications
          </Text>
          <Text style={styles.smallMuted}>
            Income-restricted application notices, not available units or market-rate listings. Confirm rent, eligibility and deadlines with
            the city.
          </Text>
          {data?.jersey ? (
            <>
              <Text style={styles.smallMuted}>
                {data.jersey.notices.length} buildings · {data.jersey.total} apartments described · City update{' '}
                {showDate(data.jersey.revision)} · Checked {showDate(data.jersey.checkedAt)}
              </Text>
              {data.jersey.notices.map((notice) => (
                <View key={notice.id} style={styles.listing}>
                  <Text accessibilityRole="header" style={styles.listingTitle}>
                    {notice.name}
                  </Text>
                  <Text style={styles.smallMuted}>{notice.address}</Text>
                  <View style={styles.chipRow}>
                    {notice.sizes.map(
                      (count, index) =>
                        count > 0 && (
                          <Text key={index} style={styles.cardStat}>
                            {SIZE_LABELS[index]} · {count}
                          </Text>
                        ),
                    )}
                  </View>
                </View>
              ))}
            </>
          ) : (
            <Text style={styles.smallMuted}>Nothing saved yet. Resync to check the city’s postings, or open them below.</Text>
          )}
          <View style={styles.actionLinks}>
            <Link label="Official Jersey City postings" url={JERSEY_PAGE} onError={onError} />
            <Link label="Jersey City application portal" url={JERSEY_APPLICATION} onError={onError} />
          </View>
        </View>
      )}
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.listingTitle}>
          NYC HDC re-rentals and waitlists
        </Text>
        {data?.rerentals && (
          <>
            <Text style={styles.smallMuted}>
              {rerentals.length} notices in this area · Checked {showDate(data.rerentals.checkedAt)}
              {data.rerentals.limited ? ' · Partial coverage' : ''}
            </Text>
            <Button secondary onPress={() => setShowRerentals(!showRerentals)}>
              {showRerentals ? 'Hide HDC notices' : 'Show HDC notices'}
            </Button>
            {showRerentals &&
              rerentals.map((notice) => (
                <View key={notice.id} style={styles.listing}>
                  <Text accessibilityRole="header" style={styles.listingTitle}>
                    {notice.name}
                  </Text>
                  <Text style={styles.smallMuted}>{[notice.address, notice.borough].filter(Boolean).join(' · ')}</Text>
                  <Text style={styles.bodyText}>
                    {[notice.bedrooms, notice.rent, notice.age, notice.accessibility].filter(Boolean).join(' · ')}
                  </Text>
                  <Link label="View official advertisement" url={notice.url} onError={onError} />
                </View>
              ))}
          </>
        )}
        <Link label="Browse NYC HDC re-rentals" url={HDC_PAGE} onError={onError} />
      </View>
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.listingTitle}>
          NYC Housing Connect
        </Text>
        <Text style={styles.smallMuted}>
          {data?.publishedAt
            ? `NYC Open Data published ${showDate(data.publishedAt)}. Confirm deadlines, rent, and eligibility on the official listing.`
            : 'Use the city portal to browse lotteries and check applications.'}
        </Text>
        <View style={styles.actionLinks}>
          <Link label="Browse Housing Connect" url={HOUSING_PORTAL} onError={onError} />
          <Link label="NYC Open Data source" url={HOUSING_DATA} onError={onError} />
        </View>
      </View>
      {opportunities.length > 0 ? (
        <>
          <Text style={styles.fieldLabel}>{opportunities.length} open rental lotteries in this area</Text>
          {opportunities.slice(0, visible).map((opportunity) => (
            <View style={styles.listing} key={opportunity.id}>
              <Text accessibilityRole="header" style={styles.listingTitle}>
                {opportunity.name}
              </Text>
              <Text style={styles.smallMuted}>
                {[opportunity.borough, `Apply by ${showDate(opportunity.closes)}`].filter(Boolean).join(' · ')}
              </Text>
              {opportunity.addresses.length > 0 && <Text style={styles.smallMuted}>{opportunity.addresses.join(' · ')}</Text>}
              <View style={styles.chipRow}>
                {opportunity.sizes.map(
                  (count, index) =>
                    count > 0 && (
                      <Text key={index} style={styles.cardStat}>
                        {SIZE_LABELS[index]} · {count}
                      </Text>
                    ),
                )}
              </View>
              <Link label="View lottery and application details" url={opportunity.url} onError={onError} />
            </View>
          ))}
          {visible < opportunities.length && (
            <Button secondary onPress={() => setVisible(visible + 10)}>
              Show more lotteries
            </Button>
          )}
        </>
      ) : (
        data?.publishedAt && <Text style={styles.smallMuted}>The current city export has no open rental lotteries in this area.</Text>
      )}
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.listingTitle}>
          Mitchell-Lama
        </Text>
        <Text style={styles.smallMuted}>
          New city lotteries run through Housing Connect. HPD also publishes its development waitlist information.
        </Text>
        <Link
          label="HPD Mitchell-Lama program and open waitlists"
          url="https://www.nyc.gov/site/hpd/services-and-information/mitchell-lama-program.page"
          onError={onError}
        />
      </View>
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.listingTitle}>
          Section 8 and voucher listings
        </Text>
        <Text style={styles.smallMuted}>
          Use the city’s voucher search resources and browse rentals advertised on AffordableHousing.com.
        </Text>
        <Link
          label="NYC voucher housing resources"
          url="https://www.nyc.gov/site/hpd/services-and-information/section-8-housing-search-resources.page"
          onError={onError}
        />
        <Link label="AffordableHousing.com listings" url="https://www.affordablehousing.com/new-york-ny/" onError={onError} />
      </View>
    </View>
  );
}
