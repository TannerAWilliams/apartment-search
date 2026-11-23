import { Text, View } from 'react-native';
import { displayPriceHistory } from '../price-history.ts';
import { formatRent } from '../search.ts';
import { styles } from '../styles.ts';
import { MARKETPLACE_NAMES } from '../marketplaces.ts';
const date = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
export function PriceHistory({ value }: { value: unknown }) {
  const history = displayPriceHistory(value);
  return (
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Observed price history
      </Text>
      {!history ? (
        <Text style={styles.smallMuted}>
          No recorded price history yet. History starts with successful source refreshes; it is not backfilled.
        </Text>
      ) : (
        <>
          <Text style={styles.smallMuted}>
            Seen on {MARKETPLACE_NAMES[history.sourceId.replace(/-live$/, '')] ?? history.sourceId.replace(/-live$/, '')} from{' '}
            {date.format(new Date(history.firstObservedAt))} to {date.format(new Date(history.lastObservedAt))} ET. A listing seen is not
            proof it is still available.
          </Text>
          {history.observations.map((point, index) => (
            <Text key={index} style={styles.bodyText}>
              {date.format(new Date(point.checkedAt))} ET · {formatRent(point.rent)}/mo ·{' '}
              {point.priceIncludesFees ? 'includes reported fees' : 'asking rent; fees not confirmed'}
            </Text>
          ))}
          {history.truncated && <Text style={styles.smallMuted}>Older changes were trimmed; showing the most recent 24 observations.</Text>}
        </>
      )}
    </View>
  );
}
