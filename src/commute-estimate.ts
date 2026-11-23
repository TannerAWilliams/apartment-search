import { isRecord, type ListingData, type Loose } from './domain.ts';

type Routed = Pick<ListingData, 'commuteEstimate' | 'transitSeconds' | 'drivingSeconds'>;

/** The saved estimate when it is complete and plausible; saved listings come from device storage and may be malformed. */
export function savedCommuteEstimate(listing: Loose<Routed> | null | undefined) {
  const estimate = isRecord(listing?.commuteEstimate) ? listing.commuteEstimate : null;
  const destination = isRecord(estimate?.destination) ? estimate.destination : null;
  if (
    !estimate ||
    !destination ||
    estimate.provider !== 'TravelTime' ||
    estimate.arrivalPeriod !== 'weekday_morning' ||
    typeof estimate.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(estimate.checkedAt)) ||
    typeof destination.label !== 'string' ||
    !destination.label ||
    destination.label.length > 200 ||
    typeof destination.latitude !== 'number' ||
    !Number.isFinite(destination.latitude) ||
    Math.abs(destination.latitude) > 90 ||
    typeof destination.longitude !== 'number' ||
    !Number.isFinite(destination.longitude) ||
    Math.abs(destination.longitude) > 180
  )
    return null;
  const minutes = (seconds: unknown) =>
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 10800 ? Math.ceil(seconds / 60) : null;
  return {
    destination: { ...destination, label: destination.label, latitude: destination.latitude, longitude: destination.longitude },
    checkedAt: estimate.checkedAt,
    transitMinutes: minutes(listing?.transitSeconds),
    drivingMinutes: minutes(listing?.drivingSeconds),
  };
}
/** Provider inventory is not evidence of a route calculated for this user's destination. */
export function withoutCommuteEstimate<T extends object>(listing: T): Omit<T, keyof Routed> {
  const { transitSeconds: _transit, drivingSeconds: _driving, commuteEstimate: _estimate, ...inventory } = listing as T & Partial<Routed>;
  return inventory;
}
