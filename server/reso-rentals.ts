export const RESO_FEED_FORMAT = 'reso-web-api';

export function resoRentalRow(input: unknown) {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;
  if (row.StandardStatus !== 'Active' || row.PropertyType !== 'Residential Lease' ||
      row.InternetEntireListingDisplayYN === false || row.InternetAddressDisplayYN === false ||
      (row.LeaseAmountFrequency != null && row.LeaseAmountFrequency !== 'Monthly')) return null;

  const key = row.ListingKey ?? row.ListingId;
  if (typeof key !== 'string' || !key.trim()) return null;
  const street = [row.StreetNumber, row.StreetDirPrefix, row.StreetName, row.StreetSuffix, row.StreetDirSuffix]
    .filter((part): part is string => typeof part === 'string' && Boolean(part.trim())).join(' ');
  const address = street || (typeof row.UnparsedAddress === 'string' ? row.UnparsedAddress.split(',')[0] : '');
  return {
    id: key,
    status: 'Active',
    address,
    unit: row.UnitNumber,
    city: row.City,
    state: row.StateOrProvince,
    county: row.CountyOrParish,
    zipCode: row.PostalCode,
    price: row.ListPrice,
    bedrooms: row.BedroomsTotal,
    bathrooms: row.BathroomsTotalInteger,
    squareFeet: row.LivingAreaUnits === 'Square Feet' ? row.LivingArea : undefined,
    latitude: row.Latitude,
    longitude: row.Longitude,
    neighborhood: row.SubdivisionName,
    company: row.ListOfficeName,
    listingUrl: row.ListingURL,
    updatedAt: row.ModificationTimestamp,
  };
}
