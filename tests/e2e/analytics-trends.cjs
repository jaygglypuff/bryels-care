/* W3A e2e (US-5-02, US-5-03, US-5-16): owner overview, area dashboards, KPI records and the trends
 * page on desktop (1440 px) and phone (390 px). Requires a fresh demo seed (pnpm db:reset), which
 * includes the W3A month and its snapshots.
 * Run: BASE_URL=http://localhost:3301 NODE_PATH=$(npm root -g) node tests/e2e/analytics-trends.cjs
 * Fails on assertion errors, error pages, console errors, failed requests and horizontal scrolling on the phone.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const problems = [];

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

async function signIn(browser, email, viewport) {
  const context = await browser.newContext({ viewport, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  const page = await context.newPage();
  const tag = `${email.split('@')[0]}@${viewport.width}`;
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) problems.push(`[${tag}] console error on ${page.url()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[${tag}] page error on ${page.url()}: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`[${tag}] HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(BASE + '/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', 'demo1234');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 60000 });
  return { context, page };
}

async function visit(page, path, viewport) {
  await page.goto(BASE + path, { timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const body = await page.locator('body').innerText();
  for (const bad of ['Application error', 'Internal Server Error', 'This page could not be found', 'could not be loaded', 'Something went wrong', 'Unhandled Runtime Error']) assert(!body.includes(bad), `error page on ${path}: ${bad}`);
  if (viewport.width <= 400) {
    const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert(ok, `horizontal scroll on ${path} at ${viewport.width} px`);
  }
  if (problems.length) throw new Error('Problems:\n' + problems.join('\n'));
  return body;
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const viewport of [DESK, PHONE]) {
      const { context, page } = await signIn(browser, 'owner@bryels-care.test', viewport);
      let body = await visit(page, '/dashboard', viewport);
      assert(body.includes('Owner overview'), 'owner overview title');
      assert(body.includes('Batch journey'), 'batch journey board kept');
      assert(body.includes('Site comparison'), 'site comparison for the owner');
      assert(/Updated \d\d:\d\d · All sites/.test(body), 'updated line with scope');
      assert(body.includes('Not available yet'), 'unavailable tiles say why');
      // Table toggle of the fulfilment chart
      const frame = page.locator('section').filter({ has: page.getByRole('button', { name: 'Table' }) }).first();
      await frame.getByRole('button', { name: 'Table' }).click();
      assert(await frame.locator('table').first().isVisible(), 'table twin visible after toggle');

      body = await visit(page, '/dashboard?period=last_month', viewport);
      for (const area of ['operations', 'inventory', 'quality', 'sales']) {
        body = await visit(page, `/analytics/${area}?period=last_30`, viewport);
        assert(body.toLowerCase().includes(`${area} dashboard`), `${area} dashboard title`);
      }
      body = await visit(page, '/analytics/inventory', viewport);
      assert(body.includes('Stock totals agree with the ledger'), 'inventory totals equal the ledger');

      body = await visit(page, '/analytics/kpi/KPI-SAL-01?scope=all&period=last_30', viewport);
      assert(body.includes('Orders confirmed') && body.includes('Total'), 'drill-down with total row');

      body = await visit(page, '/analytics/trends?k=KPI-SAL-01&k=KPI-OPS-02&k=KPI-FIN-02&grain=day&span=30&comparison=previous&scope=all', viewport);
      assert(body.includes('Trends') && body.includes('Estimate'), 'trends with estimate chip');
      await page.getByRole('button', { name: 'Table' }).first().click();
      const rows = await page.locator('table tbody tr').count();
      assert(rows === 30, `trends table twin has 30 rows (got ${rows})`);
      if (viewport === DESK) {
        await page.fill('#view-name', 'E2E owner view');
        await page.getByRole('button', { name: 'Save view' }).click();
        await page.getByText('View "E2E owner view" saved.').waitFor({ timeout: 30000 });
        assert(await page.getByRole('link', { name: 'E2E owner view' }).isVisible(), 'saved view listed');
        page.once('dialog', (d) => d.accept());
        await page.getByRole('button', { name: 'Remove' }).first().click();
        await page.getByRole('link', { name: 'E2E owner view' }).waitFor({ state: 'detached', timeout: 30000 });
      }
      body = await visit(page, '/analytics/trends?k=a&k=b&k=c&k=d&k=e&k=f&k=g', viewport);
      assert(body.includes('Pick at most 6 KPIs'), 'more than six KPIs refused');
      body = await visit(page, '/analytics/definitions', viewport);
      assert(body.includes('KPI definitions'), 'definitions page');
      await context.close();
    }
    // A site manager has no cross-site view.
    const { context, page } = await signIn(browser, 'manager.nfd@bryels-care.test', DESK);
    let body = await visit(page, '/dashboard', DESK);
    assert(!body.includes('All sites'), 'no All sites for a single-site manager');
    body = await visit(page, '/analytics/trends?scope=all', DESK);
    assert(body.includes("isn't available to you"), 'cross-site trends refused');
    await context.close();
    console.log('[analytics e2e] OK');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
