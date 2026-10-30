/* Customer portal (W4E, US-8-01 / US-8-02) against a running server in demo mode on a fresh seed:
 *   DATABASE_URL=… DEMO_MODE=true pnpm next dev -p 3405   (after migrate + seed)
 *   NODE_PATH=$(npm root -g) BASE_URL=http://localhost:3405 node tests/e2e/portal.cjs
 * Checks: the staff "Try the demo" panel offers the portal accounts as a separate "Customer portal"
 * group linking to the portal sign-in; one-click portal sign-in; ordering from the approved catalogue;
 * the order enters the internal machine (confirmed within limits; Salon Amihan on credit hold → under
 * review); order tracking, documents and reorder; 390 px phones never scroll sideways; tenant isolation
 * over HTTP (foreign order 404, staff API 401 with the portal cookie, portal API 401 with the staff
 * cookie); the staff "Portal access" panel on the customer page. Screenshots go to SHOTS_DIR.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3405';
const SHOTS = process.env.SHOTS_DIR || process.cwd();
const problems = [];
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
};
const log = (...a) => console.log('[portal-e2e]', ...a);
const inDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

async function newPage(browser, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`page error on ${page.url()}: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return { context, page };
}

async function noSideScroll(page, what) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  assert(w <= 391, `${what}: no horizontal scroll at 390 px (scrollWidth ${w})`);
}

async function portalOneClick(page, name) {
  await page.goto(BASE + '/portal/sign-in');
  await page.getByRole('button', { name: new RegExp('^Sign in to the portal as ' + name) }).click();
  await page.waitForURL(BASE + '/portal', { timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch();
  try {
    // 1. Staff sign-in page: the portal accounts are a separate group linking to the portal sign-in.
    const { context: s1, page: sp } = await newPage(browser);
    await sp.goto(BASE + '/sign-in');
    await sp.getByRole('switch', { name: 'Try the demo' }).click();
    const group = sp.getByRole('group', { name: 'Customer portal' });
    assert(await group.isVisible(), 'Customer portal group on the staff demo panel');
    const link = group.getByRole('link', { name: /Joy Castillo/ });
    assert((await link.getAttribute('href')).startsWith('/portal/sign-in?email=portal.mabuhay%40bryels-care.test'), 'group links to the portal sign-in');
    await sp.screenshot({ path: path.join(SHOTS, 'portal-staff-demo-panel.png'), fullPage: true });
    await link.click();
    await sp.waitForURL('**/portal/sign-in?email=*');
    assert((await sp.getByLabel('Email').inputValue()) === 'portal.mabuhay@bryels-care.test', 'email prefilled');
    log('staff demo panel links to the portal sign-in with the email prefilled');
    await s1.close();

    // 2. Joy (Mabuhay, buyer) on a 390 px phone: home, order, tracking, documents, reorder.
    const { context: c1, page: p } = await newPage(browser, { width: 390, height: 844 });
    await portalOneClick(p, 'Joy Castillo');
    assert(await p.getByRole('heading', { name: /Hello, Joy/ }).isVisible(), 'portal home');
    await noSideScroll(p, 'home');
    await p.screenshot({ path: path.join(SHOTS, 'portal-home-390.png'), fullPage: true });
    await p.getByRole('navigation', { name: 'Customer portal' }).getByRole('link', { name: 'Order', exact: true }).click();
    await p.waitForURL('**/portal/order');
    assert(await p.getByText('ACS-135').first().isVisible(), 'catalogue shows ACS-135');
    assert(await p.getByText('PHP 72.50').first().isVisible(), 'contract price shown');
    await noSideScroll(p, 'order form');
    await p.getByLabel(/Quantity of .*/).first().fill('480');
    await p.getByLabel('Deliver by').fill(inDays(10));
    await p.getByLabel('Your PO number (optional)').fill('MPG-PO-E2E');
    await p.screenshot({ path: path.join(SHOTS, 'portal-order-390.png'), fullPage: true });
    await p.getByRole('button', { name: 'Place order' }).click();
    await p.waitForURL('**/portal/orders/*?placed=1', { timeout: 30000 });
    assert(await p.getByText(/was sent to Bryel's Care/).isVisible(), 'placed banner');
    const placedUrl = p.url().split('?')[0];
    const placedText = await p.content();
    assert(/Confirmed/.test(placedText), 'within limits the order is confirmed by the internal rules');
    assert(!/credit|approval reason|Placed in the customer portal by/i.test(await p.locator('main').innerText()), 'no internal notes or credit words on the order page');
    await noSideScroll(p, 'order page');
    await p.screenshot({ path: path.join(SHOTS, 'portal-order-placed-390.png'), fullPage: true });
    log('Joy placed an order on a phone; confirmed by the internal rules');

    await p.getByRole('link', { name: 'Reorder' }).first().click();
    await p.waitForURL('**/portal/order?from=*');
    assert((await p.getByLabel(/Quantity of .*/).first().inputValue()) === '480', 'reorder prefilled');
    log('reorder prefills the quantities');

    await p.goto(BASE + '/portal/documents');
    assert(await p.getByText(/Quotation QT-/).first().isVisible(), 'quotation listed');
    await noSideScroll(p, 'documents');
    await p.getByText(/Quotation QT-/).first().click();
    await p.waitForURL('**/portal/documents/quotation/*');
    assert(await p.getByText('customer copy', { exact: false }).isVisible(), 'customer copy view');
    await noSideScroll(p, 'quotation');
    await p.screenshot({ path: path.join(SHOTS, 'portal-quotation-390.png'), fullPage: true });
    await p.goto(BASE + '/portal/account');
    await noSideScroll(p, 'account');
    log('documents, quotation and account pages fit 390 px');

    // 3. Carla (Salon Amihan, credit hold): her order stops for review.
    const { context: c2, page: q } = await newPage(browser);
    await portalOneClick(q, 'Carla Dizon');
    await q.goto(BASE + '/portal/order');
    await q.getByLabel(/Quantity of .*GBS|Quantity of .*/).first().fill('48');
    await q.getByLabel('Deliver by').fill(inDays(8));
    await q.getByRole('button', { name: 'Place order' }).click();
    await q.waitForURL('**/portal/orders/*?placed=1', { timeout: 30000 });
    assert(await q.getByText('Under review').first().isVisible(), 'credit hold order is under review');
    const carlaOrderUrl = q.url().split('?')[0];
    await q.screenshot({ path: path.join(SHOTS, 'portal-salon-under-review.png'), fullPage: true });
    log('Salon Amihan order stops at review (credit hold)');

    // 4. Isolation over HTTP.
    const carlaId = carlaOrderUrl.split('/').pop();
    await p.goto(BASE + '/portal/orders/' + carlaId);
    assert(await p.getByText('Order not found').isVisible(), "Joy cannot open Carla's order (404 page)");
    const api = await p.evaluate(async (id) => (await fetch('/api/portal/v1/orders/' + id)).status, carlaId);
    assert(api === 404, 'portal API answers 404 for a foreign order (got ' + api + ')');
    const own = await p.evaluate(async (u) => (await fetch('/api/portal/v1/orders/' + u.split('/').pop())).status, placedUrl);
    assert(own === 200, 'own order via portal API');
    const staffApi = await p.evaluate(async () => (await fetch('/api/v1/sales/orders/export?format=csv')).status);
    assert(staffApi === 401, 'staff API rejects the portal cookie with 401 (got ' + staffApi + ')');
    const staffPage = await p.goto(BASE + '/dashboard');
    assert(p.url().includes('/sign-in') && !p.url().includes('/portal/'), 'staff pages send a portal user to the staff sign-in');
    log('isolation: foreign order 404, staff API 401, staff pages need a staff session', staffPage && staffPage.status());
    await c1.close();
    await c2.close();

    // 5. Staff: the Portal access panel on the customer page; the staff cookie opens nothing in the portal.
    const { context: s2, page: st } = await newPage(browser);
    await st.goto(BASE + '/sign-in');
    await st.getByLabel('Email').fill('sales@bryels-care.test');
    await st.getByLabel('Password').fill('demo1234');
    await st.getByRole('button', { name: 'Sign in', exact: true }).click();
    await st.waitForURL('**/dashboard', { timeout: 30000 });
    const portalApi = await st.evaluate(async () => (await fetch('/api/portal/v1/orders')).status);
    assert(portalApi === 401, 'portal API rejects the staff cookie (got ' + portalApi + ')');
    await st.goto(BASE + '/sales/customers');
    await st.getByRole('link', { name: 'Mabuhay Pharmacy Group' }).first().click();
    // Customers is a split view: the list opens the customer panel; portal access is on the full record.
    await st.getByRole('link', { name: 'Open full record' }).click();
    await st.getByRole('heading', { name: 'Portal access' }).waitFor({ timeout: 20000 });
    assert(await st.getByText('portal.mabuhay@bryels-care.test').isVisible(), 'portal users listed');
    assert(await st.getByText(/link valid until/).first().isVisible(), 'open invitation shown with its expiry');
    await st.getByRole('heading', { name: 'Portal access' }).scrollIntoViewIfNeeded();
    await st.screenshot({ path: path.join(SHOTS, 'portal-staff-panel.png'), fullPage: true });
    log('staff panel lists the portal users; portal API 401 with the staff cookie');
    await s2.close();
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error('[portal-e2e] problems:\n' + problems.join('\n'));
    process.exit(1);
  }
  log('all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
