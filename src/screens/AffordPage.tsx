/** What rent can I afford? Landlords' 40× rule, Dave Ramsey's 25% of take-home pay, and a guarantor's 80× (src/affordability.ts). */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { affordability, RESIDENCES, type Residence, takeHome } from '../affordability.ts';
import { Button, Chip, Field } from '../components/ui.tsx';
import { formatRent } from '../search.ts';
import { colors, styles } from '../styles.ts';

const dollars = (text: string) => {
  const amount = Number(text.replace(/[^\d]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

/** A percentage as typed, "6" or "6.5", kept between 0 and 100 with at most one decimal. */
const percentText = (text: string) => {
  const cleaned = text.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
  const [whole = '', decimal] = cleaned.split('.');
  const value = whole.slice(0, 3) + (decimal === undefined ? '' : '.' + decimal.slice(0, 1));
  return Number(value) > 100 ? '100' : value;
};
const percent = (text: string) => {
  const value = Number(text);
  return text !== '' && Number.isFinite(value) && value > 0 ? value : null;
};
/** The 2025 limit on what an employee can put into a 401(k) (under 50). */
const LIMIT_401K = 23_500;

/** Shows an amount as it is typed, "$120,000", so a missing or extra zero is easy to see. */
const money = (text: string) => {
  const digits = text.replace(/\D/g, '').slice(0, 7);
  return digits ? '$' + Number(digits).toLocaleString('en-US') : '';
};

export function AffordPage({ onSearch }: { onSearch: (maxRent: number) => void }) {
  const [income, setIncome] = useState('');
  const [residence, setResidence] = useState<Residence>('nyc');
  const [pretax, setPretax] = useState('');
  const [own, setOwn] = useState('');
  const gross = dollars(income);
  // Both are percentages of yearly income before tax, as pay stubs and 401(k) plans put them.
  const pretaxShare = percent(pretax);
  const ownShare = percent(own);
  const pretaxDollars = gross && pretaxShare ? Math.round((gross * pretaxShare) / 100) : 0;
  const monthlyTakeHome = gross && ownShare ? Math.round((gross * ownShare) / 100 / 12) : undefined;
  const result = gross ? affordability(gross, residence, { pretax: pretaxDollars, monthlyTakeHome }) : null;
  const taxes = gross ? takeHome(gross, residence, pretaxDollars) : null;
  const estimatedShare = gross && taxes ? Math.round((taxes.yearly / gross) * 100) : null;
  const card = (title: string, amount: number, detail: string, rule: string) => (
    <View style={[styles.chartCard, { gap: 6, flexGrow: 1, flexBasis: 260 }]}>
      <Text style={styles.smallMuted}>{title}</Text>
      <Text style={{ fontSize: 30, fontWeight: '700', color: colors.ink }}>
        {formatRent(amount)}
        <Text style={{ fontSize: 16, fontWeight: '400', color: colors.muted }}> a month</Text>
      </Text>
      <Text style={styles.bodyText}>{detail}</Text>
      <Button secondary onPress={() => onSearch(amount)}>
        {`Search up to ${formatRent(amount)} (${rule})`}
      </Button>
    </View>
  );
  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          What can I afford?
        </Text>
        <Text style={styles.bodyText}>
          Two ways to set a budget: what landlords will approve, and what leaves room for the rest of your life.
        </Text>
      </View>
      <View style={styles.chartCard}>
        <Field
          label="Your yearly income before tax"
          value={income}
          onChangeText={(text) => setIncome(money(text))}
          keyboardType="number-pad"
          placeholder="$120,000"
          maxLength={10}
        />
        <Text style={styles.fieldLabel}>Where you live</Text>
        <View style={styles.chipRow}>
          {RESIDENCES.map(([key, label]) => (
            <Chip key={key} selected={residence === key} onPress={() => setResidence(key)}>
              {label}
            </Chip>
          ))}
        </View>
        <Field
          label="401(k) or other pre-tax savings, % of income (optional)"
          value={pretax}
          onChangeText={(text) => setPretax(percentText(text))}
          keyboardType="decimal-pad"
          placeholder="e.g. 6"
          maxLength={5}
        />
        {pretaxDollars > 0 && (
          <Text style={styles.smallMuted}>
            {formatRent(pretaxDollars)} a year
            {pretaxDollars > LIMIT_401K ? `, more than the ${formatRent(LIMIT_401K)} a 401(k) alone allows in 2025` : ''}
          </Text>
        )}
        <Field
          label="Or the share of your pay you actually take home, % (optional)"
          value={own}
          onChangeText={(text) => setOwn(percentText(text))}
          keyboardType="decimal-pad"
          placeholder={estimatedShare ? `Estimated: ${estimatedShare}` : 'Estimated for you'}
          maxLength={5}
        />
        {monthlyTakeHome !== undefined && <Text style={styles.smallMuted}>{formatRent(monthlyTakeHome)} a month</Text>}
      </View>
      {result && taxes && gross ? (
        <>
          <View style={[styles.chipRow, { alignItems: 'stretch' }]}>
            {card(
              'What landlords approve',
              result.landlord,
              `Most New York landlords want a yearly income of 40 times the rent, the same as rent at 30% of your gross pay.`,
              '40× rule',
            )}
            {card(
              'What Dave Ramsey recommends',
              result.ramsey,
              `Housing at no more than 25% of your take-home pay of about ${formatRent(result.takeHome)} a month.`,
              '25% rule',
            )}
          </View>
          <View style={styles.chartCard}>
            <Text style={styles.fieldLabel}>Your take-home pay, estimated</Text>
            {(
              [
                ['Yearly income', gross],
                ['Federal income tax', -taxes.federal],
                ['Social Security and Medicare', -taxes.payroll],
                [
                  residence === 'nj'
                    ? 'New Jersey income tax'
                    : residence === 'ct'
                      ? 'Connecticut income tax'
                      : 'New York State income tax',
                  -taxes.state,
                ],
                ...(residence === 'nyc' ? ([['New York City income tax', -taxes.city]] as const) : []),
                ...(pretaxDollars ? ([['Pre-tax savings', -pretaxDollars]] as const) : []),
              ] as const
            ).map(([label, amount]) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={styles.bodyText}>{label}</Text>
                <Text style={styles.bodyText}>{amount < 0 ? '−' + formatRent(Math.round(-amount)) : formatRent(Math.round(amount))}</Text>
              </View>
            ))}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                borderTopWidth: 1,
                borderTopColor: colors.border,
                paddingTop: 8,
              }}
            >
              <Text style={styles.menuLabel}>Take-home, a month</Text>
              <Text style={styles.menuLabel}>{formatRent(Math.round(taxes.monthly))}</Text>
            </View>
            <Text style={styles.smallMuted}>
              An estimate for a single filer with the standard deduction, using 2025 tax rates. Your pay stub is more exact; enter it above.
            </Text>
          </View>
          <Text style={styles.bodyText}>
            Not enough for the landlord rule? A guarantor usually needs to earn 80 times the rent: {formatRent(result.guarantorIncome)} a
            year for a {formatRent(result.landlord)} apartment.
          </Text>
        </>
      ) : (
        <Text style={styles.smallMuted}>Enter your income to see both budgets.</Text>
      )}
    </View>
  );
}
