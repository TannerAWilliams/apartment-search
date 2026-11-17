import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { type DashboardFile, METRICS, formatDashboardValue } from './dashboard-data.ts';
import { dashboardInsights, dashboardPlot, shiftDashboardMonth } from './dashboard-insights.ts';
import { Chip } from './ui.tsx';
import { styles } from './styles.ts';
const COLORS = ['#206248', '#34638c'];
export function DashboardVisuals({ file, areaIndex }: { file: DashboardFile; areaIndex: number }) {
  const [range, setRange] = useState(12);
  const [comparison, setComparison] = useState<number | null>(null);
  const [month, setMonth] = useState(file.months.at(-1) ?? '');
  const [tableLimit, setTableLimit] = useState(24);
  const [width, setWidth] = useState(0);
  const end = file.months.at(-1) ?? '', start = range ? shiftDashboardMonth(end, 1 - range) : file.months[0];
  const primary = dashboardPlot(file, areaIndex, start, end);
  const selectedMonth = primary.some(p => p.month === month) ? month : end;
  const series = [areaIndex, ...(comparison !== null && comparison !== areaIndex ? [comparison] : [])].map(i => ({ area: file.areas[i], points: dashboardPlot(file, i, start, end) }));
  const insights = dashboardInsights(file, areaIndex, selectedMonth);
  const values = series.flatMap(s => s.points.map(p => p.value).filter(v => v !== null));
  const low = Math.min(...values), high = Math.max(...values), span = Math.max(high - low, high * .05, 1);
  const min = Math.max(0, low - span * .1), max = Math.max(min + 1, high + span * .1);
  const x = (m: string) => 16 + (width - 32) * (Date.parse(m + '-01') - Date.parse(start + '-01')) / Math.max(1,Date.parse(end + '-01') - Date.parse(start + '-01'));
  const y = (v: number) => 16 + 168 * (max - v) / (max - min);
  const change = (item: { value: number; unit: string } | null) => item ? `${item.value > 0 ? '+' : ''}${item.value.toFixed(2)} ${item.unit}` : 'Unavailable (missing, anomalous or zero baseline)';
  return <View style={styles.chartCard}>
    <Text accessibilityRole="header" style={styles.panelTitle}>Historical trend and neighborhood context</Text>
    <View style={styles.chipRow}>{[[12,'1 year'],[36,'3 years'],[0,'All history']].map(([n,label]) => <Chip key={n} selected={range === n} onPress={() => { setRange(Number(n)); setTableLimit(24); }}>{label}</Chip>)}</View>
    <Text style={styles.smallMuted}>{start} to {end} · {METRICS[file.metric][1]} · Shared scale, not forced to zero. Missing/anomalous months break the line; no interpolation.</Text>
    {values.length > 0 ? <>
      <Text style={styles.smallMuted}>Axis: {formatDashboardValue(min,file.metric)} to {formatDashboardValue(max,file.metric)}</Text>
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{height:200,width:'100%',position:'relative'}} aria-hidden accessibilityElementsHidden>
        {width > 32 && <View style={{position:'absolute',left:x(selectedMonth),top:12,bottom:12,width:1,backgroundColor:'#718096'}} />}
        {width > 32 && series.map((s,si) => s.points.map((p,i) => {
          if (p.value === null) return null;
          const prev=s.points[i-1], px=x(p.month), py=y(p.value);
          const previousValue = prev?.value;
          const linked = prev && typeof previousValue === 'number' && shiftDashboardMonth(prev.month,1) === p.month;
          const dx=linked ? px-x(prev.month):0, dy=linked ? py-y(previousValue!):0, length=Math.hypot(dx,dy);
          return <React.Fragment key={si+'-'+p.month}>
            {linked && <View style={{position:'absolute',height:2,width:length,left:(px+x(prev.month)-length)/2,top:(py+y(previousValue!))/2,backgroundColor:COLORS[si],transform:[{rotate:Math.atan2(dy,dx)+'rad'}]}} />}
            <View style={{position:'absolute',width:6,height:6,borderRadius:si===0?3:0,left:px-3,top:py-3,backgroundColor:COLORS[si]}} />
          </React.Fragment>;
        }))}
      </View>
    </> : <Text>No valid observations in this range.</Text>}
    {series.map((s,i) => <Text key={s.area.name} style={[styles.fieldLabel,{color:COLORS[i]}]}>{i===0?'Primary (round markers)':'Comparison (square markers)'}: {s.area.name} · {s.area.borough || s.area.type}</Text>)}
    <View style={styles.chipRow}>
      <Chip onPress={() => setComparison(areaIndex)}>Pin this area for comparison, then choose another area</Chip>
      {comparison !== null && <Chip onPress={() => setComparison(null)}>Clear comparison</Chip>}
    </View>
    {insights && <>
      <Text accessibilityRole="header" style={styles.fieldLabel}>{selectedMonth}: {formatDashboardValue(insights.current,file.metric)}</Text>
      <Text style={styles.bodyText}>Prior calendar month: {change(insights.monthly)}. Same month one year earlier: {change(insights.yearly)}.</Text>
      <Text style={styles.smallMuted}>Latest valid observation for this area: {insights.latest ?? 'None'}. Missing later observations are not assumed unchanged.</Text>
      {insights.peers && <Text style={styles.bodyText}>{insights.peers.below} of {insights.peers.count} reporting areas of the same geography type and borough have a lower value; {insights.peers.equal} share this value (including this area). This is not a quality score, affordability verdict or weighted market statistic.</Text>}
    </>}
    <Text style={styles.smallMuted}>Select a month below. The table is the accessible alternative to the visual; swipe horizontally for comparison columns.</Text>
    <ScrollView horizontal><View>
      {primary.slice().reverse().slice(0,tableLimit).map(p => <Pressable key={p.month} accessibilityRole="button" accessibilityState={{selected:p.month===selectedMonth}} onPress={() => setMonth(p.month)} style={{paddingVertical:8,minHeight:44}}>
        <Text style={p.month===selectedMonth?styles.fieldLabel:styles.bodyText}>{p.month}{series.map(s => ` · ${s.area.name}: ${formatDashboardValue(s.area.values[file.months.indexOf(p.month)]??null,file.metric)}`).join('')}</Text>
      </Pressable>)}
    </View></ScrollView>
    {tableLimit < primary.length && <Chip onPress={() => setTableLimit(tableLimit+36)}>Show earlier chart months</Chip>}

  </View>;
}
