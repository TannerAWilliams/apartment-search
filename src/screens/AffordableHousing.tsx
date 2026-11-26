import type { HousingResponse } from '../../server/contracts.ts';
import type React from 'react';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { INCOME_YEAR, RENT_YEAR, restrictionLines } from '../affordable-limits.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Disclosure, Link } from '../components/ui.tsx';

const SIZE_LABELS = ['Studio', '1 BR', '2 BR', '3 BR', '4+ BR'];
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
const showDate = (date?: string | null) => (date ? DATE.format(new Date(date)) : 'unknown');

const AREAS = ['New York City', 'New Jersey', 'Westchester', 'Long Island', 'Connecticut'] as const;
type Area = (typeof AREAS)[number];
/** The area the page opens on: the one being searched, when it is one of these. */
const areaOf = (region: string): Area =>
  region === 'nj'
    ? 'New Jersey'
    : region === 'westchester' || region === 'metroNorth'
      ? 'Westchester'
      : region === 'ct'
        ? 'Connecticut'
        : region === 'longIsland'
          ? 'Long Island'
          : 'New York City';
const PAGE = 10;

/** One program: its name, what it is, what is open now (when Walkup has it), and where to apply. */
function Program({ title, about, children }: { title: string; about: string; children: React.ReactNode }) {
  return (
    <View style={[styles.chartCard, { gap: 8 }]}>
      <Text accessibilityRole="header" style={styles.listingTitle}>
        {title}
      </Text>
      <Text style={styles.smallMuted}>{about}</Text>
      {children}
    </View>
  );
}

/** Rows of a list, ten at a time. */
function Rows<T>({ items, row, more }: { items: T[]; row: (item: T, index: number) => React.ReactNode; more: string }) {
  const [visible, setVisible] = useState(PAGE);
  return (
    <>
      <View>{items.slice(0, visible).map(row)}</View>
      {visible < items.length && (
        <Button secondary onPress={() => setVisible(visible + PAGE)}>
          {more}
        </Button>
      )}
    </>
  );
}

const Sizes = ({ sizes }: { sizes: number[] }) => (
  <View style={styles.chipRow}>
    {sizes.map(
      (count, index) =>
        count > 0 && (
          <Text key={index} style={styles.cardStat}>
            {SIZE_LABELS[index]} · {count}
          </Text>
        ),
    )}
  </View>
);

export function AffordableHousing({
  region,
  workplace,
  loadHousing,
  onError,
}: {
  region: string;
  /** Where the person works, when they have said, and the miles to it: each lottery then shows how far it is. */
  workplace?: { label: string; miles: (place: unknown) => number | null };
  loadHousing?: (signal: AbortSignal) => Promise<HousingResponse>;
  onError: (message: string) => void;
}) {
  const [data, setData] = useState<HousingResponse | null>(null);
  const [area, setArea] = useState<Area>(areaOf(region));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loadHousing) return;
    const controller = new AbortController();
    loadHousing(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [loadHousing]);

  const now = Date.now();
  const rowStyle = (index: number) => [{ paddingVertical: 12, gap: 4 }, index > 0 && styles.menuDivider];
  const lotteries = data?.opportunities ?? [];
  const rerentals = data?.rerentals?.results ?? [];
  // While the lists are on their way, and when they could not be read: the links below each still work.
  const waiting = data ? null : (
    <Text style={styles.smallMuted}>
      {failed || !loadHousing ? 'The list could not be loaded. Use the link below.' : 'Loading the list…'}
    </Text>
  );

  return (
    <View style={styles.marketplacePanel}>
      <Text accessibilityRole="header" style={styles.panelTitle}>
        Lotteries and public housing
      </Text>
      <Text style={styles.bodyText}>
        Housing lotteries, Mitchell-Lama, public housing and income-restricted rentals that are open now, apart from market-rate apartments.
        You apply on each program’s official site.
      </Text>
      <View style={styles.chipRow}>
        {AREAS.map((name) => (
          <Chip key={name} selected={name === area} onPress={() => setArea(name)}>
            {name}
          </Chip>
        ))}
      </View>

      {area === 'New York City' && (
        <>
          <Program
            title={`Open housing lotteries${data && !data.stale ? ` (${lotteries.length})` : ''}`}
            about="New income-restricted apartments, filled by lottery on NYC Housing Connect."
          >
            {waiting}
            {data &&
              (data.stale ? (
                <Text style={styles.bodyText}>
                  Walkup isn’t listing individual lotteries right now. The city’s published list is from {showDate(data.publishedAt)}, and
                  lotteries can close before that list says they do. Housing Connect shows what is open today.
                </Text>
              ) : (
                <Text style={styles.smallMuted}>
                  From the city’s list, published {showDate(data.publishedAt)}. Income limits are the city’s {INCOME_YEAR} ceilings for a
                  household of one, and rents its {RENT_YEAR} ceilings for each income band; each lottery’s own page has its exact rents,
                  its minimum income and whether it is still open.
                </Text>
              ))}
            <Rows
              items={lotteries}
              more="Show more lotteries"
              row={(lottery, index) => (
                <View key={lottery.id} style={rowStyle(index)}>
                  <Text accessibilityRole="header" style={styles.fieldLabel}>
                    {lottery.name}
                  </Text>
                  <Text style={styles.bodyText}>
                    {[lottery.borough, `Apply by ${showDate(lottery.closes)}`].filter(Boolean).join(' · ')}
                  </Text>
                  {lottery.addresses.length > 0 && <Text style={styles.smallMuted}>{lottery.addresses.join(' · ')}</Text>}
                  {(() => {
                    const miles = workplace ? workplace.miles(lottery) : null;
                    return miles === null ? null : (
                      <Text style={styles.bodyText}>
                        {miles.toFixed(1)} miles from {workplace!.label.split(',')[0]}, in a straight line
                      </Text>
                    );
                  })()}
                  <Sizes sizes={lottery.sizes} />
                  {restrictionLines(lottery.bands, lottery.sizes).map((line) => (
                    <Text key={line} style={styles.bodyText}>
                      {line}
                    </Text>
                  ))}
                  <Link label="View lottery and apply" url={lottery.url} onError={onError} />
                </View>
              )}
            />
            <View style={styles.actionLinks}>
              <Link
                label="All lotteries on Housing Connect"
                url="https://housingconnect.nyc.gov/PublicWeb/search-lotteries"
                onError={onError}
              />
              <Link label="NYC Open Data source" url={HOUSING_DATA} onError={onError} />
            </View>
          </Program>

          <Program
            title={`Re-rentals and open waitlists${data?.rerentals ? ` (${rerentals.length})` : ''}`}
            about="Income-restricted apartments that came back on the market, and waitlists taking names, advertised by the city’s Housing Development Corporation."
          >
            {waiting}
            {data?.rerentals && (
              <Text style={styles.smallMuted}>
                Checked {showDate(data.rerentals.checkedAt)}
                {data.rerentals.limited ? ' · Partial coverage' : ''}
              </Text>
            )}
            <Rows
              items={rerentals}
              more="Show more re-rentals"
              row={(notice, index) => (
                <View key={notice.id} style={rowStyle(index)}>
                  <Text accessibilityRole="header" style={styles.fieldLabel}>
                    {notice.name}
                  </Text>
                  <Text style={styles.bodyText}>
                    {[notice.bedrooms, notice.rent, notice.age, notice.accessibility].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={styles.smallMuted}>{[notice.address, notice.borough].filter(Boolean).join(' · ')}</Text>
                  <Link label="View official advertisement" url={notice.url} onError={onError} />
                </View>
              )}
            />
            <Link label="All HDC re-rentals" url={HDC_PAGE} onError={onError} />
          </Program>

          <Program
            title="Mitchell-Lama"
            about="Middle-income rentals and co-ops with regulated costs. Most waiting lists are closed and reopen by lottery on Housing Connect; a few are open, and you apply to the building’s manager. Expect a wait of years. The city publishes the open lists only as a PDF, so they are not listed here."
          >
            <Link
              label="Developments with open waiting lists (PDF)"
              url="https://www.nyc.gov/assets/hpd/downloads/pdfs/services/ML-waiting-Lists-Status.pdf"
              onError={onError}
            />
            <Link
              label="How Mitchell-Lama works (HPD)"
              url="https://www.nyc.gov/site/hpd/services-and-information/mitchell-lama-program.page"
              onError={onError}
            />
          </Program>

          <Program
            title="Public housing (NYCHA)"
            about="Apartments owned by the city’s housing authority, with rent set by income. There is no list of vacancies: one application covers every development, and the wait is long."
          >
            <Link label="Apply for public housing" url="https://www.nyc.gov/site/nycha/eligibility/apply.page" onError={onError} />
            <Link label="Check an application" url="https://selfserve.nycha.info/" onError={onError} />
          </Program>

          <Program title="Section 8 and vouchers" about="Apartments whose owners take housing vouchers.">
            <Link
              label="NYC voucher housing resources"
              url="https://www.nyc.gov/site/hpd/services-and-information/section-8-housing-search-resources.page"
              onError={onError}
            />
            <Link label="AffordableHousing.com listings" url="https://www.affordablehousing.com/new-york-ny/" onError={onError} />
          </Program>
        </>
      )}

      {area === 'New Jersey' && (
        <>
          <Program
            title="Jersey City affordable housing applications"
            about="Income-restricted buildings taking applications, from the city’s postings. Confirm rent, eligibility and deadlines with the city."
          >
            {waiting}
            {data?.jersey ? (
              <>
                <Text style={styles.smallMuted}>
                  {data.jersey.notices.length} buildings · {data.jersey.total} apartments described · City update{' '}
                  {showDate(data.jersey.revision)} · Checked {showDate(data.jersey.checkedAt)}
                </Text>
                <View>
                  {data.jersey.notices.map((notice, index) => (
                    <View key={notice.id} style={rowStyle(index)}>
                      <Text accessibilityRole="header" style={styles.fieldLabel}>
                        {notice.name}
                      </Text>
                      <Text style={styles.smallMuted}>{notice.address}</Text>
                      <Sizes sizes={notice.sizes} />
                    </View>
                  ))}
                </View>
              </>
            ) : (
              data && <Text style={styles.smallMuted}>Nothing saved yet. Open the city’s postings below.</Text>
            )}
            <View style={styles.actionLinks}>
              <Link label="Official Jersey City postings" url={JERSEY_PAGE} onError={onError} />
              <Link label="Jersey City application portal" url={JERSEY_APPLICATION} onError={onError} />
            </View>
          </Program>
          <Program
            title="The rest of New Jersey"
            about="The state’s free registry of affordable and accessible apartments, searchable by town and rent. Walkup does not have its list."
          >
            <Link label="New Jersey Housing Resource Center" url="https://www.nj.gov/njhrc/find-housing/" onError={onError} />
          </Program>
        </>
      )}

      {area === 'Westchester' && (
        <Program
          title="Westchester County affordable housing"
          about="Lotteries, waitlists and first-come rentals from the county’s HomeSeeker. Check eligibility, rents and units on each listing."
        >
          {waiting}
          {data?.westchester
            ? (() => {
                // Open opportunities first; ones whose applications closed wait behind a toggle.
                // Closed: the application deadline has passed, or, with no deadline, the lottery has already been held.
                const past = (date: string | null) => date !== null && Date.parse(date) < now;
                const ended = ({ applicationEnd, lottery }: { applicationEnd: string | null; lottery: string | null }) =>
                  past(applicationEnd) || (applicationEnd === null && past(lottery));
                const open = data.westchester.opportunities.filter((opportunity) => !ended(opportunity));
                const closed = data.westchester.opportunities.filter(ended);
                const row = (opportunity: (typeof open)[number], index: number) => (
                  <View key={opportunity.id} style={rowStyle(index)}>
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
              })()
            : data && <Text style={styles.smallMuted}>Nothing saved yet. Open the county’s list below.</Text>}
          <Link label="Westchester HomeSeeker" url={HOMESEEKER} onError={onError} />
        </Program>
      )}

      {area === 'Long Island' && (
        <Program
          title="Affordable rental lotteries"
          about="Income-restricted apartments in Nassau and Suffolk, each filled by its own lottery through the Long Island Housing Partnership. Walkup does not have its list yet, so this one is a link."
        >
          <Link label="Long Island Housing Partnership: open rentals" url="https://www.lihp.org/rentals/" onError={onError} />
        </Program>
      )}

      {area === 'Connecticut' && (
        <Program
          title="Affordable and subsidized rentals"
          about="The state’s housing search covers affordable, accessible, senior and veteran housing. Walkup does not have its list yet, so this one is a link."
        >
          <Link label="CT Housing Search" url="https://cthousingsearch.org/" onError={onError} />
        </Program>
      )}
    </View>
  );
}
