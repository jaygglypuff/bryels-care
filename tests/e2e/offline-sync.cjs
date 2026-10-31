const autoConfirm = require('./auto-confirm.cjs');
/* Offline capture and replay on a phone-sized device (W4D: US-7-01, US-7-02, US-7-04, US-7-06;
 * docs/testing.md §6 offline.* rows marked E2E in docs/offline-acceptance-checklist.md).
 *
 * One mobile browser context (390 x 844) is "the device": it registers itself, a site manager approves
 * it from a desktop context, it downloads offline data, goes offline (context.setOffline), opens the
 * precached /offline workspace from the service worker, captures a blind count line, survives a closed
 * tab, comes back online and syncs; then the person signs out (the device store is deleted), the
 * production operator signs in on the same device, captures a weighing offline and replays it online.
 * Server state is checked in the database after each replay.
 *
 * Run against a production build (the service worker only exists there) on a fresh seed:
 *   DATABASE_URL=postgres://postgres@localhost:5432/<db> ALLOW_DEMO_SEED=true pnpm db:reset
 *   pnpm build && DATABASE_URL=… APP_ORIGIN=http://localhost:3404 pnpm next start -p 3404
 *   BASE_URL=http://localhost:3404 DATABASE_URL=… NODE_PATH=$(npm root -g) node tests/e2e/offline-sync.cjs
 */
const path = require('path');
const { chromium } = require('playwright');
const postgres = require(path.join(__dirname, '../../node_modules/postgres'));

const BASE = process.env.BASE_URL || 'http://localhost:3404';
const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/bryels_test_w4d', { max: 2, onnotice: () => {} });
const PW = 'demo1234';
let browser;
const results = [];


/** A handheld (keyboard-wedge) scanner: a fast key burst ending in Enter with nothing focused (ScanOrPick). */
async function scanBurst(page, text) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.type(text, { delay: 4 });
  await page.keyboard.press('Enter');
}

async function signIn(page, email) {
  await page.goto(BASE + '/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 30000 });
}

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push([name, 'ok']);
    console.log('ok  ', name, `${Date.now() - t} ms`);
  } catch (e) {
    results.push([name, 'FAIL', e.message.split('\n')[0]]);
    console.log('FAIL', name, e.message.split('\n').slice(0, 3).join(' | '));
    throw e;
  }
}

async function noSideScroll(page, label) {
  const w = await page.evaluate(() => document.scrollingElement.scrollWidth);
  if (w > 390) throw new Error(`${label}: page is ${w}px wide at a 390px viewport`);
}

async function waitFor(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  await desk.addInitScript(autoConfirm);
  const mg = await desk.newPage();
  mg.on('dialog', (d) => d.accept());
  const device = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-PH', timezoneId: 'Asia/Manila', serviceWorkers: 'allow' });
  await device.addInitScript(autoConfirm);
  let dev = await device.newPage();
  dev.on('dialog', (d) => d.accept());
  const label = `E2E counting phone ${Date.now().toString(36)}`;
  let countId;

  try {
    await step('manager releases the planned count CNT-26-0001', async () => {
      await signIn(mg, 'manager.nfd@bryels-care.test');
      await mg.goto(BASE + '/inventory/counts');
      await mg.getByRole('link', { name: 'CNT-26-0001', exact: true }).first().click();
      await mg.waitForURL(/\/inventory\/counts\/[0-9a-f-]{36}$/);
      countId = mg.url().split('/').pop();
      await mg.getByRole('button', { name: 'Start count' }).click(); // auto-confirm presses "Yes, start the count"
      await mg.getByText('Counting now (shelves locked)', { exact: true }).first().waitFor({ timeout: 15000 });
    });

    await step('US-7-06: the warehouse operator asks to register the phone; /sync fits 390 px', async () => {
      await signIn(dev, 'warehouse.nfd@bryels-care.test');
      await dev.goto(BASE + '/sync');
      await dev.fill('#device-label', label);
      await dev.getByRole('button', { name: 'Request registration' }).click();
      await dev.getByText('Registration requested').waitFor({ timeout: 15000 });
      await dev.getByText('Waiting for approval').first().waitFor({ timeout: 15000 });
      await noSideScroll(dev, '/sync');
    });

    await step('US-7-06: the site manager approves it for counting and weighing', async () => {
      await mg.goto(BASE + '/admin/devices');
      const item = mg.locator(`[data-testid="device-${label}"]`);
      await item.waitFor();
      await item.getByRole('button', { name: 'Approve device' }).click();
      await item.getByText('Registered', { exact: true }).waitFor({ timeout: 15000 });
      await item.getByText(/Offline: Weighing \(dispensing\), Stock counts/).waitFor();
    });

    await step('US-7-01: the phone downloads offline data; the service worker precaches /offline', async () => {
      await dev.goto(BASE + '/sync');
      await dev.getByText('Registered', { exact: true }).first().waitFor({ timeout: 15000 });
      await dev.getByRole('button', { name: 'Download offline data' }).first().click();
      await dev.getByText(/Offline data for NFD saved on this device/).waitFor({ timeout: 30000 });
      await dev.locator('[data-testid=freshness-badge]').first().waitFor();
      await waitFor(() => dev.evaluate(async () => !!(await navigator.serviceWorker.ready) && !!(await caches.match('/offline', { ignoreSearch: true }))), 'service worker ready with /offline precached', 60000);
    });

    const [pkgLot] = await sql`select l.lot_number from inventory_lots l join inventory_balances b on b.lot_id = l.id join locations x on x.id = b.location_id join sites s on s.id = x.site_id where s.code = 'NFD' and x.code = 'PKG-01' and b.qty_base > 0 order by l.lot_number limit 1`;

    await step('US-7-04: offline, the /offline workspace opens from the service worker and a count line is saved on the device', async () => {
      await device.setOffline(true);
      await dev.goto(BASE + '/offline');
      await dev.getByText('Count (blind)').waitFor({ timeout: 15000 });
      await noSideScroll(dev, '/offline');
      await dev.selectOption('#oc-location', { label: 'PKG-01 · Packaging shelf' });
      await scanBurst(dev, `BC:LOT:${pkgLot.lot_number}`);
      await dev.locator('[data-testid=oc-lot]').waitFor();
      await dev.fill('#oc-qty', '7');
      await dev.getByRole('button', { name: 'Save count on this device' }).click();
      await dev.getByText('Saved on this device. It will sync when you are back online.').waitFor();
      await dev.locator('[data-testid=offline-status]', { hasText: 'Offline · 1 pending' }).waitFor();
    });

    await step('offline.tab_closed_pending: the queue survives a closed tab', async () => {
      await dev.close();
      dev = await device.newPage();
      dev.on('dialog', (d) => d.accept());
      await dev.goto(BASE + '/offline');
      await dev.getByRole('button', { name: /^Queue · 1$/ }).click();
      await dev.locator('[data-testid=offline-queue]').getByText('Pending sync').waitFor();
    });

    await step('offline.airplane_mid_workflow: back online the count is replayed once and posted', async () => {
      await device.setOffline(false);
      await dev.evaluate(() => window.dispatchEvent(new Event('online')));
      await dev.locator('[data-testid=offline-status]', { hasText: 'Synced' }).waitFor({ timeout: 30000 });
      const rows = await sql`select e.qty_base::text as qty, u.email from stock_count_entries e join users u on u.id = e.counted_by where e.stock_count_id = ${countId}`;
      if (rows.length !== 1 || Number(rows[0].qty) !== 7 || rows[0].email !== 'warehouse.nfd@bryels-care.test') throw new Error(`count entries ${JSON.stringify(rows)}`);
      const cmds = await sql`select status from sync_commands where command_type = 'inventory.stock_count.record'`;
      if (cmds.length !== 1 || cmds[0].status !== 'applied') throw new Error(`sync_commands ${JSON.stringify(cmds)}`);
    });

    await step('offline.logout_clears_cache: signing out deletes the device store; the next person sees nothing', async () => {
      await dev.goto(BASE + '/dashboard');
      await dev.locator('summary[aria-label=Account]').click();
      await dev.getByRole('button', { name: 'Sign out' }).first().click();
      await dev.waitForURL('**/sign-in**', { timeout: 30000 });
      const names = await dev.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
      if (names.includes('bryels-care-offline')) {
        const n = await dev.evaluate(() => new Promise((res) => { const r = indexedDB.open('bryels-care-offline'); r.onsuccess = () => { const db = r.result; const stores = [...db.objectStoreNames]; if (!stores.length) return res(0); const tx = db.transaction(stores); let total = 0; let left = stores.length; for (const s of stores) { const c = tx.objectStore(s).count(); c.onsuccess = () => { total += c.result; if (--left === 0) res(total); }; } }; r.onerror = () => res(-1); }));
        if (n !== 0) throw new Error(`device store still holds ${n} rows after sign-out`);
      }
    });

    let target;
    await step('the production operator signs in on the same device and downloads offline data', async () => {
      await signIn(dev, 'operator.nfd@bryels-care.test');
      await dev.goto(BASE + '/sync');
      await dev.getByText('Registered', { exact: true }).first().waitFor({ timeout: 15000 });
      await dev.locator('[data-testid=outbox-list]').waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
      await dev.getByRole('button', { name: 'Download offline data' }).first().click();
      await dev.getByText(/Offline data for NFD saved on this device/).waitFor({ timeout: 30000 });
      [target] = await sql`select bm.id, bm.theoretical_qty_g::text as qty from batch_materials bm join batches b on b.id = bm.batch_id where b.batch_number = 'B-26-0004' and bm.line_no = 1`;
    });

    await step('US-7-04: offline weighing at target is saved on the device', async () => {
      await device.setOffline(true);
      await dev.goto(BASE + '/offline');
      await dev.getByRole('button', { name: 'Weighing', exact: true }).click();
      await dev.selectOption('#ow-line', target.id);
      const hint = await dev.getByText(/^Suggested \(FEFO, as cached\): /).innerText();
      const lotNo = hint.replace(/^Suggested \(FEFO, as cached\): /, '').split(',')[0].trim();
      await scanBurst(dev, `BC:LOT:${lotNo}`);
      await dev.locator('[data-testid=ow-lot]').waitFor();
      if (await dev.locator('#ow-loc').count()) await dev.selectOption('#ow-loc', { index: 1 });
      await dev.fill('#ow-qty', String(Number(target.qty)));
      if (await dev.locator('#ow-scale').count()) await dev.selectOption('#ow-scale', 'SC-01');
      await dev.getByText(/^Within tolerance/).waitFor();
      await dev.getByRole('button', { name: 'Save weighing on this device' }).click();
      await dev.getByText(/^Saved on this device\. It syncs when you are back online/).waitFor();
      await noSideScroll(dev, '/offline weighing');
    });

    await step('back online the weighing is replayed through the dispensing service; the checker signs later', async () => {
      await device.setOffline(false);
      await dev.evaluate(() => window.dispatchEvent(new Event('online')));
      await dev.locator('[data-testid=offline-status]', { hasText: 'Synced' }).waitFor({ timeout: 30000 });
      const recs = await sql`select d.is_within_tolerance, d.checker_id, u.email from dispense_records d join users u on u.id = d.operator_id where d.batch_material_id = ${target.id} and d.voided_at is null`;
      if (recs.length !== 1 || !recs[0].is_within_tolerance || recs[0].checker_id !== null || recs[0].email !== 'operator.nfd@bryels-care.test') throw new Error(`dispense records ${JSON.stringify(recs)}`);
      const [cmd] = await sql`select status, device_registration_id is not null as has_device from sync_commands where command_type = 'production.dispense_record.create'`;
      if (!cmd || cmd.status !== 'applied' || !cmd.has_device) throw new Error(`sync command ${JSON.stringify(cmd)}`);
    });
  } catch {
    /* the failing step was printed */
  }

  const failed = results.filter((r) => r[1] !== 'ok');
  console.log(`\nOFFLINE E2E ${failed.length ? 'FAILED' : 'PASSED'}: ${results.length - failed.length}/${results.length} steps`);
  await browser.close();
  await sql.end();
  process.exit(failed.length ? 1 : 0);
})();
