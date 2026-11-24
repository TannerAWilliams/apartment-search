/**
 * Neighborhood pages and the renewal check. Both pick a New York City neighborhood and read its report
 * (server/neighborhoods.ts): listings and median rents by size, its buildings, and 311 complaints.
 */
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { formatRent } from '../search.ts';
import { renewalAdvice } from '../renewal.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Field, Link } from '../components/ui.tsx';

export type NeighborhoodReport = {
  name: string;
  listings: number;
  borough: string | null;
  zips: string[];
  sizes: { bedrooms: number; count: number; median: number | null }[];
  buildings: { known: number; stabilized: number; grades: Record<'A' | 'B' | 'C' | 'D', number> };
  complaints: { zip: string; counts: Record<string, number> } | null;
};
type Place = { id: string; label: string; detail: string; count: number };
type Loaders = {
  loadNeighborhoods?: (signal: AbortSignal) => Promise<{ areas?: Place[] }>;
  loadReport?: (name: string) => Promise<NeighborhoodReport>;
  onError: (message: string) => void;
};
const SIZE = ['Studio', '1 BR', '2 BR', '3 BR', '4+ BR'];
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];

/** Chooses a neighborhood: a borough, then one of its neighborhoods (those with the most listings first), or by name. */
function Picker({
  loadNeighborhoods,
  value,
  onChange,
}: Pick<Loaders, 'loadNeighborhoods'> & { value: string; onChange: (name: string) => void }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [borough, setBorough] = useState('Manhattan');
  const [typed, setTyped] = useState('');
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (!loadNeighborhoods) return;
    const controller = new AbortController();
    loadNeighborhoods(controller.signal)
      .then(({ areas = [] }) => setPlaces(areas.filter(({ id }) => id.includes('|'))))
      .catch(() => {});
    return () => controller.abort();
  }, [loadNeighborhoods]);
  const shown = useMemo(() => {
    const query = typed.trim().toLowerCase();
    return places
      .filter(({ label, detail }) => (query ? label.toLowerCase().includes(query) : detail === borough))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [places, borough, typed]);
  return (
    <>
      <View style={styles.chipRow}>
        {BOROUGHS.map((name) => (
          <Chip key={name} selected={!typed && borough === name} onPress={() => (setBorough(name), setTyped(''), setAll(false))}>
            {name}
          </Chip>
        ))}
      </View>
      <Field label="Find a neighborhood" value={typed} onChangeText={setTyped} placeholder="West Village" maxLength={60} />
      <View style={styles.chipRow}>
        {(all ? shown : shown.slice(0, 18)).map(({ id, label }) => (
          <Chip key={id} selected={value === label} onPress={() => onChange(label)}>
            {label}
          </Chip>
        ))}
        {shown.length > 18 && <Chip onPress={() => setAll(!all)}>{all ? 'Show fewer' : `All ${shown.length}`}</Chip>}
      </View>
      {!places.length && <Text style={styles.smallMuted}>Neighborhoods load once the app is connected.</Text>}
    </>
  );
}

function useReport(loadReport: Loaders['loadReport'], name: string, onError: Loaders['onError']) {
  const [report, setReport] = useState<NeighborhoodReport | null>(null);
  useEffect(() => {
    setReport(null);
    if (!name || !loadReport) return;
    let active = true;
    loadReport(name)
      .then((next) => active && setReport(next))
      .catch((error) => active && onError(error instanceof Error ? error.message : 'The neighborhood could not be loaded.'));
    return () => {
      active = false;
    };
  }, [loadReport, name, onError]);
  return report;
}

export function NeighborhoodsPage({
  loadNeighborhoods,
  loadReport,
  onError,
  onShow,
}: Loaders & { onShow: (name: string, borough: string | null) => void }) {
  const [name, setName] = useState('');
  const report = useReport(loadReport, name, onError);
  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          Neighborhoods
        </Text>
        <Text style={styles.bodyText}>
          Rents by size, what’s known about the buildings, and the year’s 311 complaints, for any NYC neighborhood.
        </Text>
      </View>
      <Picker loadNeighborhoods={loadNeighborhoods} value={name} onChange={setName} />
      {name && !report && <Text style={styles.smallMuted}>Loading {name}…</Text>}
      {report && (
        <View style={styles.chartCard}>
          <Text accessibilityRole="header" style={styles.fieldLabel}>
            {report.name}
            {report.borough ? `, ${report.borough}` : ''} · {report.listings.toLocaleString('en-US')} apartments listed
          </Text>
          {report.sizes
            .filter(({ count }) => count)
            .map(({ bedrooms, count, median }) => (
              <Text key={bedrooms} style={styles.bodyText}>
                {SIZE[bedrooms]}: median {formatRent(median!)} ({count} listed)
              </Text>
            ))}
          <Text style={styles.bodyText}>
            {report.buildings.known
              ? `Buildings checked: ${report.buildings.known}; ${report.buildings.stabilized} register rent-stabilized units; grades ${
                  Object.entries(report.buildings.grades)
                    .filter(([, count]) => count)
                    .map(([grade, count]) => `${grade} ${count}`)
                    .join(', ') || 'not known yet'
                }.`
              : 'No buildings here have been checked yet; more are checked every night.'}
          </Text>
          {report.complaints ? (
            <Text style={styles.bodyText}>
              311 complaints in the last year, ZIP {report.complaints.zip}:{' '}
              {Object.entries(report.complaints.counts)
                .map(([group, count]) => `${group.toLowerCase()} ${count.toLocaleString('en-US')}`)
                .join(' · ')}
            </Text>
          ) : (
            <Text style={styles.smallMuted}>311 complaints could not be read right now.</Text>
          )}
          <Button disabled={!report.listings} onPress={() => onShow(report.name, report.borough)}>
            Show apartments in {report.name}
          </Button>
        </View>
      )}
    </View>
  );
}

export function RenewalPage({ loadNeighborhoods, loadReport, onError }: Loaders) {
  const [name, setName] = useState('');
  const [bedrooms, setBedrooms] = useState(1);
  const [rent, setRent] = useState('');
  const [stabilized, setStabilized] = useState(false);
  const report = useReport(loadReport, name, onError);
  const amount = /^\d{3,6}$/.test(rent.trim()) ? Number(rent.trim()) : null;
  const size = report?.sizes[bedrooms];
  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          Renewal check
        </Text>
        <Text style={styles.bodyText}>Lease up for renewal? See what your apartment would rent for today before you sign.</Text>
      </View>
      <Picker loadNeighborhoods={loadNeighborhoods} value={name} onChange={setName} />
      <View style={styles.chipRow}>
        {SIZE.map((label, index) => (
          <Chip key={label} selected={bedrooms === index} onPress={() => setBedrooms(index)}>
            {label}
          </Chip>
        ))}
      </View>
      <Field
        label="Your rent now"
        value={rent}
        onChangeText={(text) => setRent(text.replace(/[^\d]/g, ''))}
        keyboardType="number-pad"
        placeholder="3200"
        maxLength={6}
      />
      <Chip selected={stabilized} onPress={() => setStabilized(!stabilized)}>
        My apartment is rent-stabilized
      </Chip>
      {name && amount && report && size && (
        <View style={styles.chartCard}>
          {renewalAdvice(amount, size.median, size.count, stabilized).map((line) => (
            <Text key={line} style={styles.bodyText}>
              {line}
            </Text>
          ))}
          <Link label="Rent Guidelines Board" url="https://rentguidelinesboard.cityofnewyork.us/" onError={onError} />
        </View>
      )}
    </View>
  );
}
