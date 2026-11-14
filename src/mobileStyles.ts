import { StyleSheet } from 'react-native';
import { colors } from './styles.ts';
export const mobileStyles = StyleSheet.create({
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: 1, borderColor: colors.border },
  summary: { flex: 1, minWidth: 0 },
  freshness: { fontSize: 12, lineHeight: 18, color: colors.muted, paddingVertical: 4 },
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: '#06174b88' },
  sheet: { width: '100%', maxHeight: '90%', backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', paddingBottom: 20 },
  wideSheet: { maxWidth: 680 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  bottomNav: { flexDirection: 'row', backgroundColor: colors.white, borderTopWidth: 1, borderColor: colors.border, paddingBottom: 8 },
  navItem: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  navSelected: { backgroundColor: colors.light, borderTopWidth: 3, borderColor: colors.green },
});
