const autoConfirm = require('./auto-confirm.cjs');
/* ADR-134: print the paper batch record with no internet, then type it in from paper (docs/offline-sync.md §12,
 * docs/offline-acceptance-checklist.md rows 28-38).
 *
 * One tablet-sized context is "the device". The operator makes the paper record of a planned batch, the device saves a
 * copy, the connection is cut (context.setOffline), and the copy prints from the open batch page and from the precached
 * /offline workspace. A save with no internet answers in words. Back online, a line is typed in from paper; signing out
 * deletes the device copy. The printed pages are also rendered to PDF (page.pdf) to check every page prints.
 *
 * Demo profile: LITE. Production build (the service worker only exists there):
 *   DATABASE_URL=… pnpm db:migrate && DEMO_MODE=true DEMO_PROFILE=lite APP_ENV=development pnpm db:demo reset
 *   pnpm build && DATABASE_URL=… APP_ORIGIN=http://localhost:3611 pnpm next start -p 3611
 *   BASE_URL=http://localhost:3611 DATABASE_URL=… NODE_PATH=$(npm root -g) node tests/e2e/paper-record.cjs
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const postgres = require(path.join(__dirname, '../../node_modules/postgres'));

const BASE = process.env.BASE_URL || 'http://localhost:3611';
const OUT = process.env.OUT_DIR || '/tmp';
const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const PW = 'demo1234';
const results = [];

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

async function waitFor(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** The pack HTML the device saved (IndexedDB `bryels-care-offline`, table `paperPacks`). */
const savedPack = (page, batchId) =>
  page.evaluate(
    (id) =>
      new Promise((res) => {
        const r = indexedDB.open('bryels-care-offline');
        r.onsuccess = () => {
          const db = r.result;
          if (![...db.objectStoreNames].includes('paperPacks')) return res(null);
          const g = db.transaction('paperPacks').objectStore('paperPacks').get(id);
          g.onsuccess = () => res(g.result ? { html: g.result.html, pages: g.result.pages.length, userId: g.result.userId } : null);
          g.onerror = () => res(null);
        };
        r.onerror = () => res(null);
      }),
    batchId,
  );

/** The print frame the button made, and what it holds. */
async function printedFrame(page) {
  return waitFor(async () => {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const n = await f.evaluate(() => document.querySelectorAll('.paper-pack-page').length).catch(() => 0);
      if (n) return { pages: n, docs: await f.evaluate(() => (document.body.innerHTML.match(/BC:DOC:DOC-[0-9-]+/g) || []).length) };
    }
    return null;
  }, 'print frame with the pack');
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const device = await browser.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, locale: 'en-PH', timezoneId: 'Asia/Manila', serviceWorkers: 'allow' });
  await device.addInitScript(autoConfirm);
  const dev = await device.newPage();
  try {
    const [batch] = await sql`select b.id, b.batch_number from batches b join sites s on s.id = b.site_id where s.code = 'NFD' and b.status = 'planned' order by b.planned_start_on limit 1`;
    if (!batch) throw new Error('no planned NFD batch in the demo');
    let pages = 0;

    await step('the operator makes the paper record; the device saves it ("Ready to print without internet")', async () => {
      await signIn(dev, 'operator.nfd@bryels-care.test');
      await dev.goto(`${BASE}/production/${batch.id}`);
      await dev.getByRole('button', { name: 'Get the paper record ready' }).click();
      await dev.getByTestId('paper-pack-hint').getByText('Ready to print without internet').waitFor({ timeout: 30000 });
      const saved = await savedPack(dev, batch.id);
      if (!saved || saved.pages < 3) throw new Error(`device copy ${JSON.stringify(saved && saved.pages)}`);
      pages = saved.pages;
      const rows = await sql`select count(*)::int n from batch_paper_records where batch_id = ${batch.id} and pack_id is not null`;
      if (rows[0].n !== pages) throw new Error(`server pages ${rows[0].n} vs device ${pages}`);
      await dev.screenshot({ path: path.join(OUT, 'oa-batch-card.png'), fullPage: false });
    });

    await step('My jobs says the paper records are ready to print without internet; the service worker has /offline', async () => {
      await dev.goto(BASE + '/dashboard');
      await dev.getByTestId('paper-packs-ready').waitFor({ timeout: 30000 });
      await waitFor(() => dev.evaluate(async () => !!(await navigator.serviceWorker.ready) && !!(await caches.match('/offline', { ignoreSearch: true }))), 'service worker with /offline', 90000);
    });

    await step('no internet: Print the paper record on the open batch page prints every page with its DOC number', async () => {
      await dev.goto(`${BASE}/production/${batch.id}`);
      await dev.getByTestId('paper-pack-hint').getByText('Ready to print without internet').waitFor({ timeout: 30000 });
      await device.setOffline(true);
      await dev.getByTestId('print-paper-record').click();
      const f = await printedFrame(dev);
      if (f.pages !== pages || f.docs < pages) throw new Error(`frame ${JSON.stringify(f)} for ${pages} pages`);
    });

    await step('no internet: a save answers "No internet. Nothing was saved." instead of an error page', async () => {
      await dev.getByText('The paper record was not used').click();
      await dev.fill('#paper-not-used-reason', 'Testing with no internet');
      await dev.getByRole('button', { name: 'Close the blank pages' }).click();
      await dev.getByText('No internet. Nothing was saved.').waitFor({ timeout: 20000 });
      const n = await sql`select count(*)::int n from batch_paper_records where batch_id = ${batch.id} and status = 'void'`;
      if (n[0].n !== 0) throw new Error('a page was voided offline');
    });

    await step('no internet: the offline workspace lists the paper record and prints it; the PDF has every page', async () => {
      await dev.goto(BASE + '/offline#paper');
      await dev.getByTestId('offline-paper-records').waitFor({ timeout: 30000 });
      await dev.getByTestId(`print-${batch.batch_number}`).click();
      const f = await printedFrame(dev);
      if (f.pages !== pages) throw new Error(`offline frame ${JSON.stringify(f)}`);
      const saved = await savedPack(dev, batch.id);
      const pdfPage = await device.newPage();
      await pdfPage.setContent(saved.html, { waitUntil: 'load' });
      await pdfPage.emulateMedia({ media: 'print' });
      const pdf = await pdfPage.pdf({ path: path.join(OUT, 'oa-paper-record.pdf'), format: 'A4', preferCSSPageSize: true });
      const sheets = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      if (sheets < pages) throw new Error(`PDF has ${sheets} sheets for ${pages} pages`);
      await pdfPage.close();
      await dev.screenshot({ path: path.join(OUT, 'oa-offline-paper.png') });
    });

    await step('back online: the entry screen lists every page; a step is typed in from paper with the time written on it', async () => {
      await device.setOffline(false);
      await dev.goto(`${BASE}/production/${batch.id}/from-paper`);
      await dev.getByTestId('paper-pages').waitFor({ timeout: 30000 });
      const n = await dev.locator('[data-testid^="paper-page-"]').count();
      if (n !== pages) throw new Error(`entry screen lists ${n} pages`);
      const w = await dev.evaluate(() => document.scrollingElement.scrollWidth);
      if (w > 820) throw new Error(`entry screen is ${w}px wide`);
      // The batch in process: make its paper record, then type its next step (a process step) from the paper.
      const [run] = await sql`select b.id from batches b join sites s on s.id = b.site_id where s.code = 'NFD' and b.status = 'in_process' order by b.planned_start_on limit 1`;
      const next = await sql`select (s->>'stepNo')::int n from batches b, jsonb_array_elements(b.formula_snapshot->'steps') s where b.id = ${run.id} and not exists (select 1 from process_step_records r where r.batch_id = b.id and r.step_no = (s->>'stepNo')::int) order by 1 limit 1`;
      const stepNo = next[0].n;
      await dev.goto(`${BASE}/production/${run.id}`);
      await dev.getByRole('button', { name: 'Get the paper record ready' }).click();
      await dev.getByTestId('paper-pack-hint').getByText('Ready to print without internet').waitFor({ timeout: 30000 });
      await dev.goto(`${BASE}/production/${run.id}/from-paper`);
      const card = dev.getByTestId(`paper-page-${stepNo}`);
      await card.waitFor({ timeout: 30000 });
      const [op] = await sql`select id from users where email = 'operator.nfd@bryels-care.test'`;
      const [ck] = await sql`select id from users where email = 'checker.nfd@bryels-care.test'`;
      const local = new Date(Date.now() - 60_000).toLocaleString('sv-SE', { timeZone: 'Asia/Manila' }).slice(0, 16).replace(' ', 'T');
      await card.locator('input[name=occurredAt]').last().fill(local);
      await card.locator('select[name=doneById]').last().selectOption(op.id);
      await card.locator('select[name=checkedById]').last().selectOption(ck.id);
      for (const r of await card.locator('input[name^="reading-"]').all()) await r.fill('50');
      await card.getByRole('button', { name: `Save step ${stepNo} as done` }).click();
      // The page re-renders with the step typed in: its card says so (the form is gone).
      await card.getByText('Typed in ✓').waitFor({ timeout: 30000 }).catch(async (e) => {
        await dev.screenshot({ path: path.join(OUT, 'oa-from-paper-fail.png'), fullPage: true });
        throw e;
      });
      const [rec] = await sql`select entry_source, status, conducted_by, checked_by, occurred_at from process_step_records where batch_id = ${run.id} and step_no = ${stepNo}`;
      if (rec.entry_source !== 'paper' || rec.conducted_by !== op.id || rec.checked_by !== ck.id) throw new Error(`record ${JSON.stringify(rec)}`);
      if (Math.abs(new Date(rec.occurred_at).getTime() - (Date.now() - 60_000)) > 120_000) throw new Error(`paper time ${rec.occurred_at}`);
      await dev.screenshot({ path: path.join(OUT, 'oa-from-paper.png'), fullPage: false });
    });

    await step('signing out deletes the device copy', async () => {
      await dev.goto(BASE + '/dashboard');
      await dev.getByTestId('account-menu').click();
      await dev.getByRole('button', { name: 'Sign out' }).first().click();
      await dev.waitForURL('**/sign-in**', { timeout: 30000 });
      const saved = await savedPack(dev, batch.id);
      if (saved) throw new Error('the paper record is still on the device after sign-out');
    });
  } finally {
    console.log(JSON.stringify(results));
    await browser.close();
    await sql.end();
    fs.writeFileSync(path.join(OUT, 'oa-e2e-results.json'), JSON.stringify(results, null, 2));
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
