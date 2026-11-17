export function savedCommuteEstimate(listing: any) {
  const estimate = listing?.commuteEstimate;
  const destination = estimate?.destination;
  if (estimate?.provider !== 'TravelTime' || estimate?.arrivalPeriod !== 'weekday_morning' ||
      typeof estimate?.checkedAt !== 'string' || !Number.isFinite(Date.parse(estimate.checkedAt)) ||
      typeof destination?.label !== 'string' || !destination.label || destination.label.length > 200 ||
      !Number.isFinite(destination?.latitude) || Math.abs(destination.latitude) > 90 ||
      !Number.isFinite(destination?.longitude) || Math.abs(destination.longitude) > 180) return null;
  const minutes = (seconds: unknown) => typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 10800 ? Math.ceil(seconds / 60) : null;
  return { destination: { ...destination }, checkedAt: estimate.checkedAt, transitMinutes: minutes(listing.transitSeconds), drivingMinutes: minutes(listing.drivingSeconds) };
}
/** Provider inventory is not evidence of a route calculated for this user's destination. */
export function withoutCommuteEstimate(listing: any) {
  const { transitSeconds: _transit, drivingSeconds: _driving, commuteEstimate: _estimate, ...inventory } = listing;
  return inventory;
}
