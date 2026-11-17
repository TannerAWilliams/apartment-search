import { test, expect } from 'playwright/test';
// Fully local fixture. No listing providers, brokers, calendars or maps are contacted.
test('tour planner adds, persists, edits, checks and removes a personal appointment', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('apartment-search:saved-listings:v1', JSON.stringify([{ id: 'tour-fixture', address: '123 Test Street', unit: '2', city: 'Brooklyn', state: 'NY', zip: '11201', rent: 2000, bedrooms: 1, kind: 'manual', sources: [] }])));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (url.pathname === '/api/config') return route.fulfill({ json: { mode:'snapshot', commuteConfigured:false, sources:[], refresh:{sources:[]} } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:{matches:[],total:0,mapPoints:[],refresh:{sources:[]}}});
    return route.continue();
  });
  await page.goto('/'); await page.getByRole('tab',{name:/Saved/}).click();
  await page.getByRole('button',{name:'Plan apartment tours',exact:true}).click();
  await page.getByRole('radio').filter({hasText:'123 Test Street'}).click();
  await page.getByLabel('Tour date (YYYY-MM-DD)',{exact:true}).fill('2027-01-10');
  await page.getByLabel('Start time (HH:mm, 24-hour device time)',{exact:true}).fill('14:30');
  await page.getByRole('button',{name:'Add planned tour',exact:true}).click();
  await expect(page.getByText('1 / 30 tours.',{exact:false})).toBeVisible();
  await page.getByRole('checkbox',{name:/Water pressure/}).check();
  await page.getByRole('button',{name:'Edit tour',exact:true}).click();
  await page.getByLabel('Appointment notes (included in calendar export)',{exact:true}).fill('Ask about laundry');
  await page.getByRole('button',{name:'Save appointment changes',exact:true}).click();
  await page.reload(); await page.getByRole('tab',{name:/Saved/}).click(); await page.getByRole('button',{name:'Plan apartment tours',exact:true}).click();
  await expect(page.getByText('Ask about laundry',{exact:true})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:/Water pressure/})).toBeChecked();
  await page.getByRole('button',{name:'Remove tour',exact:true}).click();
  await expect(page.getByText('0 / 30 tours.',{exact:false})).toBeVisible();
});
