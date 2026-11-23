import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { calculateHousingCost, emptyHousingCosts, HOUSING_COST_FIELDS } from './housing-cost.ts';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const styles = StyleSheet.create({
  panel: { gap: 10, paddingTop: 12 },
  title: { fontSize: 17, fontWeight: '600' },
  note: { fontSize: 13, lineHeight: 19, color: '#475569' },
  field: { gap: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#64748b', borderRadius: 6, padding: 10, color: '#0f172a', backgroundColor: '#fff' },
  error: { color: '#b91c1c', fontSize: 13 },
  reset: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', padding: 10 },
  result: { gap: 6, padding: 12, backgroundColor: '#f1f5f9', borderRadius: 6 },
});

/** Kept separate from provider facts: these estimates do not alter advertised rent or sort order. */
export function HousingCost() {
  const [input, setInput] = useState(emptyHousingCosts);
  const result = calculateHousingCost(input);
  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        Housing cost estimate
      </Text>
      <Text style={styles.note}>
        Enter amounts from the lease or your own estimates. Use gross rent, not advertised net-effective rent. Blank means unknown; enter 0
        only when confirmed. These entries are not saved.
      </Text>
      {HOUSING_COST_FIELDS.map(([key, label]) => (
        <View key={key} style={styles.field}>
          <Text>
            {label}
            {key !== 'leaseMonths' ? ' ($)' : ''}
          </Text>
          <TextInput
            accessibilityLabel={label}
            value={input[key]}
            keyboardType={key === 'leaseMonths' ? 'number-pad' : 'decimal-pad'}
            placeholder="Unknown"
            style={styles.input}
            onChangeText={(value) => setInput((current) => ({ ...current, [key]: value }))}
          />
          {result.errors[key] && (
            <Text accessibilityRole="alert" style={styles.error}>
              {result.errors[key]}
            </Text>
          )}
        </View>
      ))}
      <Text style={styles.note}>
        Concessions are total dollars over the lease, not free-month count. Rent due at signing excludes fees and deposits. Include all
        nonrefundable one-time charges in upfront fees.
      </Text>
      {result.estimate ? (
        <View style={styles.result}>
          <Text>Gross rent + monthly fees: {money(result.estimate.recurringMonthlyCents)}/mo</Text>
          <Text>Average lease cost: {money(result.estimate.effectiveMonthlyCents)}/mo</Text>
          <Text>Total lease cost: {money(result.estimate.leaseCostCents)}</Text>
          <Text>Estimated cash at signing: {money(result.estimate.cashAtSigningCents)}</Text>
          <Text style={styles.note}>
            Lease cost includes concessions, monthly fees and nonrefundable upfront fees, but excludes the refundable deposit of{' '}
            {money(result.estimate.refundableDepositCents)}. Cash at signing includes that deposit and the recurring fees due at signing;
            prepaid rent is not charged again in lease cost. Utilities, moving costs, and other costs are excluded unless entered. Confirm
            concession timing and payment schedule with the landlord.
          </Text>
        </View>
      ) : (
        <Text style={styles.note}>
          {Object.keys(result.errors).length
            ? 'Correct the amounts above to calculate.'
            : 'Complete all eight amounts to compare costs; unknown costs are not treated as free.'}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset housing cost estimate"
        style={styles.reset}
        onPress={() => setInput(emptyHousingCosts())}
      >
        <Text>Reset estimate</Text>
      </Pressable>
    </View>
  );
}
