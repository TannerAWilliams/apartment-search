import type { ListingData } from '../domain.ts';
import { Text, View } from 'react-native';
import { savedCommuteEstimate } from '../commute-estimate.ts';
import { styles } from '../styles.ts';
const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
export function CommuteDetails({ listing }: { listing: ListingData }) {
  const estimate = savedCommuteEstimate(listing);
  // Without a saved estimate there is nothing to show; the directions links above check the trip.
  if (!estimate) return null;
  return (
    <View style={{ gap: 5 }}>
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Commute context
      </Text>
      {estimate ? (
        <>
          <Text style={styles.bodyText}>To {estimate.destination.label} · weekday-morning arrival</Text>
          <Text style={styles.bodyText}>
            Transit: {estimate.transitMinutes === null ? 'Unavailable' : `${estimate.transitMinutes} min`} · Driving:{' '}
            {estimate.drivingMinutes === null ? 'Unavailable' : `${estimate.drivingMinutes} min`}
          </Text>
          <Text style={styles.smallMuted}>
            TravelTime estimate checked {date.format(new Date(estimate.checkedAt))} ET. This is a saved estimate, not current traffic or a
            guarantee. Different destinations are not comparable. Use directions to check your actual trip.
          </Text>
        </>
      ) : (
        <Text style={styles.smallMuted}>
          No route estimate with recorded destination context is saved. Use the directions links to check your trip; distance alone is not a
          commute-time estimate.
        </Text>
      )}
    </View>
  );
}
