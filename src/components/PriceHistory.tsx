import { Text, View } from 'react-native';
import { displayPriceHistory } from '../price-history.ts';
import { formatRent } from '../search.ts';
import { styles } from '../styles.ts';
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
            Source: {history.sourceId}. Checks are observations, not proof that an apartment is still available. Missing listings are not
            marked rented.
          </Text>
          <Text style={styles.smallMuted}>First observed: {date.format(new Date(history.firstObservedAt))} ET</Text>
          <Text style={styles.smallMuted}>Last observed: {date.format(new Date(history.lastObservedAt))} ET</Text>
          {history.observations.map((point, index) => (
            <Text key={index} style={styles.bodyText}>
              {date.format(new Date(point.checkedAt))} ET · {formatRent(point.rent)}/mo ·{' '}
              {point.priceIncludesFees ? 'includes reported fees' : 'asking rent; fees not confirmed'}
            </Text>
          ))}
          <Text style={styles.smallMuted}>
            Only the first observation and price or fee-basis changes are shown. Different fee bases are not like-for-like comparisons.
          </Text>
          {history.truncated && <Text style={styles.smallMuted}>Older changes were trimmed; showing the most recent 24 observations.</Text>}
        </>
      )}
    </View>
  );
}
