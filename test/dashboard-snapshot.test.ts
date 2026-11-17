import { test, expect } from 'bun:test';
import { dashboardSnapshot } from '../server/dashboard-snapshot.ts';
import { handleApi } from '../server/api.ts';
import { formatDashboardValue } from '../src/dashboard-data.ts';
test('official frozen master includes45files and every historic cell; anomalies explicitly retained', () => {
  const result = dashboardSnapshot();
  expect(result.files).toHaveLength(45);
  let cells = 0, blank = 0, negative = 0;
  for (const item of result.files) {
    const { file } = dashboardSnapshot(item.name);
    expect(item.firstMonth).toBe(file.months[0]); expect(item.lastMonth).toBe(file.months.at(-1)); expect(item.areaCount).toBe(file.areas.length);
    cells += file.months.length * file.areas.length;
    for (const area of file.areas) for (const value of area.values) {
      if (value === null) blank++;
      if (value < 0) { negative++; expect(file.metric).toBe('daysOnMarket'); expect(formatDashboardValue(value,file.metric)).toContain('source anomaly'); }
    }
  }
  expect(cells).toBe(1582852); expect(blank).toBe(337240); expect(negative).toBe(15);
  expect(dashboardSnapshot('missing.csv')).toBeNull();
});
test('private snapshot never serves without explicit authentication or in public mode', async () => {
  const request = (token?: string, suffix = '', method = 'GET') => new Request('https://app.test/api/dashboard'+suffix,{method,headers:token?{Authorization:`Bearer ${token}`}:{}});
  for (const [req,env,options] of [
    [request(),{},{}], [request('secret'),{APP_ACCESS_TOKEN:'secret',PUBLIC_APP:'true'},{}],
    [request('wrong'),{APP_ACCESS_TOKEN:'secret'},{}], [request(),{APP_ACCESS_TOKEN:'secret'},{}],
  ] as any[]) expect((await handleApi(req,env,options)).status).toBe(403);
  const res = await handleApi(request('secret'),{APP_ACCESS_TOKEN:'secret'});
  expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('no-store'); expect((await res.json()).files).toHaveLength(45);
  expect((await handleApi(request(),{APP_ACCESS_TOKEN:'secret'},{privateAuthenticated:true})).status).toBe(200);
  expect((await handleApi(request('secret','?file=missing.csv'),{APP_ACCESS_TOKEN:'secret'})).status).toBe(404);
  expect((await handleApi(request('secret','', 'POST'),{APP_ACCESS_TOKEN:'secret'})).status).toBe(405);
  const file = await handleApi(request('secret','?file=rentalIndex_All.csv'),{APP_ACCESS_TOKEN:'secret'});
  expect((await file.json()).file.months[0]).toBe('2007-01');
});
