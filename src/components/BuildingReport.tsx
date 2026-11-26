import type { ListingData } from '../domain.ts';
import type { retrieveBuildingRecords } from '../../server/building-records.ts';
export type BuildingRecordsResult = Awaited<ReturnType<typeof retrieveBuildingRecords>>;
export type CheckBuilding = (listing: ListingData, signal: AbortSignal) => Promise<BuildingRecordsResult>;
import { cachedBuildingReport, buildingRequestIdentity } from '../building-report-cache.ts';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { buildingReport, justFixOwnershipUrl, JUSTFIX_RENT_HISTORY_URL } from '../building-report.ts';
import { styles } from '../styles.ts';
import { Link } from './ui.tsx';
export function BuildingReport({
  listing,
  onError,
  onCheckBuilding,
}: {
  listing: ListingData;
  onError?: (message: string) => void;
  onCheckBuilding?: CheckBuilding;
}) {
  const [result, setResult] = useState<BuildingRecordsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const identity = buildingRequestIdentity(listing);
  useEffect(() => {
    const run = ++sequence.current;
    const controller = new AbortController();
    setResult(null);
    setError('');
    if (!onCheckBuilding || !buildingReport(listing).nyc) {
      setBusy(false);
      return () => controller.abort();
    }
    setBusy(true);
    cachedBuildingReport(listing, onCheckBuilding, controller.signal)
      .then((next) => {
        if (run === sequence.current && !controller.signal.aborted) setResult(next);
      })
      .catch(() => {
        if (run === sequence.current && !controller.signal.aborted)
          setError('Official records could not be checked. Findings remain unknown.');
      })
      .finally(() => {
        if (run === sequence.current && !controller.signal.aborted) setBusy(false);
      });
    return () => {
      sequence.current++;
      controller.abort();
    };
  }, [identity, onCheckBuilding]);
  const report = buildingReport(listing);
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Building due diligence
      </Text>
      <Text style={styles.smallMuted}>
        {report.scope} · {report.address}
      </Text>
      {!result && (
        <Text style={styles.smallMuted}>
          Building identity: {report.identity}. Complaints: unknown. Violations: unknown. Bedbug history: unknown. Flood-zone check: not
          performed. Official record check: not performed.
        </Text>
      )}
      {!result && <Text style={styles.smallMuted}>{report.notice}</Text>}
      {report.nyc && !onCheckBuilding && (
        <Text style={styles.smallMuted}>Connect to the inventory server to retrieve official HPD records.</Text>
      )}
      {busy && (
        <Text accessibilityRole="status" style={styles.smallMuted}>
          Loading official building records automatically…
        </Text>
      )}
      <Text style={styles.smallMuted}>
        Reports load when details open. Completed reports may be reused for five minutes in this session; partial or unknown reports for 30
        seconds. Close and reopen after that to check again.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.smallMuted}>
          {error}
        </Text>
      ) : null}
      {result && (
        <View style={{ gap: 4 }}>
          <Text style={styles.fieldLabel}>Official building report: {result.status}</Text>
          <Text style={styles.smallMuted}>Retrieved {result.checkedAt}. Retrieval time is not the source update time.</Text>
          <Text style={styles.smallMuted}>
            {result.identity
              ? `Exact active HPD building match: ${result.identity.address} · ${result.identity.borough} · building ID ${result.identity.buildingId}${result.identity.bin ? ' · BIN ' + result.identity.bin : ''}${result.identity.bbl ? ' · BBL ' + result.identity.bbl : ''}`
              : 'Building identity unmatched.'}
          </Text>
          <Text style={styles.fieldLabel}>Complaints and HPD violations</Text>
          <Text style={styles.smallMuted}>Open HPD violations: {result.openViolations ?? 'unknown'}.</Text>
          <Text style={styles.smallMuted}>Distinct HPD complaints in the last 365 days: {result.complaintsLast365Days ?? 'unknown'}.</Text>
          <Text style={styles.smallMuted}>
            311 service requests on this tax lot in the last 365 days: {result.requests311?.total ?? 'unknown'}.
          </Text>
          {result.requests311?.topProblems.length ? (
            <Text style={styles.smallMuted}>
              Most reported problems: {result.requests311.topProblems.map(({ problem, count }) => `${problem} (${count})`).join(' · ')}
            </Text>
          ) : null}
          <Text style={styles.smallMuted}>311 and HPD reports can overlap. Complaints and issued violations are counted separately.</Text>
          <Text style={styles.fieldLabel}>Property ownership</Text>
          <Text style={styles.smallMuted}>
            {result.taxLotOwner
              ? `${result.taxLotOwner.name} · NYC PLUTO tax-lot owner${result.taxLotOwner.edition ? ' · ' + result.taxLotOwner.edition : ''}`
              : 'Unknown: no tax-lot owner record verified.'}
          </Text>
          <Text style={styles.smallMuted}>Check the recorded deed for title and the HPD registration for management contacts.</Text>
          <Link
            label="Research landlord and related buildings on JustFix"
            url={justFixOwnershipUrl(result.identity?.bbl)}
            onError={onError}
          />
          <Text style={styles.fieldLabel}>Rent stabilization</Text>
          <Text style={styles.smallMuted}>
            {result.rentRegistration?.matched
              ? `State rent registration on this tax lot · latest filing year ${result.rentRegistration.latestYear}${result.rentRegistration.registeredUnits != null ? ' · ' + result.rentRegistration.registeredUnits + ' registered units reported' : ''}.`
              : result.rentRegistration
                ? 'No state registration match found for this tax lot.'
                : 'State registration could not be verified.'}
          </Text>
          <Text style={styles.smallMuted}>
            Apartment-level stabilization status: unverified. Use HCR rent history for the specific apartment.
          </Text>
          <Link label="Request your apartment’s rent history with JustFix" url={JUSTFIX_RENT_HISTORY_URL} onError={onError} />
          <Text style={styles.smallMuted}>
            {result.bedbugs
              ? `Latest owner-filed bedbug report: ${result.bedbugs.periodStart} to ${result.bedbugs.periodEnd}, filed ${result.bedbugs.filedAt}. Units reported: ${result.bedbugs.units}; infested ${result.bedbugs.infested}; eradicated ${result.bedbugs.eradicated}; reinfested ${result.bedbugs.reinfested}. This is an owner filing, not an independent inspection or a statement of current infestation. Corrections use the latest filing, never summed.`
              : 'Bedbug annual filing: unknown / no unambiguous report retrieved.'}
          </Text>
          <Text style={styles.fieldLabel}>Pests, evictions and Housing Court, since {result.sinceTwoYears}</Text>
          <Text style={styles.smallMuted}>
            {result.rodents
              ? `City rat inspections of this tax lot: ${result.rodents.inspections}; ${result.rodents.ratActivity} found rats.`
              : 'City rat inspections: unknown.'}
          </Text>
          <Text style={styles.smallMuted}>
            {result.evictions === null
              ? 'Evictions carried out by a city marshal: unknown.'
              : `Residents evicted by a city marshal on this tax lot${result.evictionsSince ? ` since ${result.evictionsSince}` : ''}: ${result.evictions}${result.taxLotOwner?.units ? `, in ${result.taxLotOwner.units} apartments` : ''}.`}
          </Text>
          <Text style={styles.smallMuted}>
            {result.housingCourt
              ? result.housingCourt.cases
                ? `Housing Court cases over this building: ${result.housingCourt.kinds.map(({ kind, count }) => `${kind} (${count})`).join(' · ')}.`
                : 'No Housing Court cases over this building.'
              : 'Housing Court cases: unknown.'}
          </Text>
          <Text style={styles.smallMuted}>
            {result.hpdRegistration
              ? result.hpdRegistration.current
                ? `Registered with HPD through ${result.hpdRegistration.through}.`
                : `No current HPD registration${result.hpdRegistration.through ? ` (the last ran to ${result.hpdRegistration.through})` : ''}. Buildings with three or more apartments must register every year.`
              : 'HPD registration: unknown.'}
          </Text>
          <Text style={styles.smallMuted}>
            A case or an eviction is a record of a dispute, not a finding against the owner; evictions the city could not place on a tax lot
            are not counted.
          </Text>
          <Text style={styles.fieldLabel}>DOB records by matched BIN</Text>
          {result.dob ? (
            result.dob.map((source) => (
              <View key={source.dataset} style={{ gap: 2 }}>
                <Link label={source.label} url={`https://data.cityofnewyork.us/d/${source.dataset}`} onError={onError} />
                <Text style={styles.smallMuted}>
                  {source.groups === null
                    ? 'Unknown / source unavailable'
                    : source.groups.length
                      ? source.groups.map((group) => `${group.status}: ${group.count}`).join(' · ')
                      : 'No records returned from this dataset.'}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.smallMuted}>Unknown: a valid exact building BIN is unavailable.</Text>
          )}
          <Text style={styles.smallMuted}>
            DOB datasets can overlap. Check the official building history for full records and current status.
          </Text>
          <Text style={styles.fieldLabel}>Preliminary flood-map screening</Text>
          <Text style={styles.smallMuted}>
            {result.flood
              ? `${result.flood.layer}: ${result.flood.intersects ? 'special flood hazard area returned at this point' : 'no special flood hazard area returned at this point'}. Mapped zone labels: ${result.flood.zones.join(', ') || 'none'}. Checked at the matched building point in the official HPD bedbug dataset (${result.flood.point.latitude}, ${result.flood.point.longitude}), not the listing/neighborhood coordinates.`
              : 'Unknown: no usable matched official building point or map response.'}
          </Text>
          <Text style={styles.smallMuted}>
            This is the 2015 preliminary coastal 100-year layer, not effective FEMA insurance mapping, all flood scenarios, current/future
            risk or the entire building footprint. A point outside it does not mean flood-safe. Stormwater and unit/floor exposure are not
            assessed.
          </Text>
          <Link
            label="Official NYC preliminary flood layer"
            url="https://a841-dotweb01.nyc.gov/arcgis/rest/services/Climate_Resiliency/Climate_Resiliency/MapServer/7"
            onError={onError}
          />
          {(result.errors ?? []).map((message, index) => (
            <Text key={index} style={styles.smallMuted}>
              {message}
            </Text>
          ))}
        </View>
      )}
      {report.nyc ? (
        <>
          {!result && (
            <>
              <Link label="Search for a landlord or building on JustFix" url={justFixOwnershipUrl()} onError={onError} />
              <Link label="Request your apartment’s rent history with JustFix" url={JUSTFIX_RENT_HISTORY_URL} onError={onError} />
            </>
          )}
          <Text style={styles.smallMuted}>
            Review checklist: match the exact borough, address and BIN/BBL or HPD building ID; separate open from closed records; inspect
            recent heat/hot-water, pests and maintenance reports; check DOB permits and any vacate orders. Ask about unresolved conditions
            at the viewing. Records are not a substitute for inspecting the apartment.
          </Text>
          {report.sources.map((source) => (
            <View key={source.name} style={{ gap: 3 }}>
              <Link label={source.name} url={source.url} onError={onError} />
              <Text style={styles.smallMuted}>{source.purpose}</Text>
            </View>
          ))}
        </>
      ) : (
        <Text style={styles.smallMuted}>
          These NYC databases may not cover this address. Confirm the municipality and use its housing/building department. No NYC findings
          are inferred.
        </Text>
      )}
    </View>
  );
}
