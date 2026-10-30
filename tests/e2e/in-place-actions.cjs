/* In-place action regression check (ADR-043, docs/ux-system.md "Rules: 5.8a").
 * Every action is taken right after a client-side navigation and must show its result AND the
 * re-rendered page within 10 s, with no reload: receipts, counts, adjustments, QA inspection and
 * review, holds, settings, batch weighing, notifications and work orders.
 * Run against a production build on a fresh seed (pnpm db:reset; pnpm build && pnpm start):
 *   NODE_PATH=$(npm root -g) node tests/e2e/in-place-actions.cjs     (exit 1 on any stale screen)
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = 'demo1234';
const manilaDate = (o = 0) => new Date(Date.now() + o * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
let browser;

async function asUser(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 30000 });
  return { context, page, errors };
}

/** Waits for the locator; a timeout means the screen stayed unchanged (no reload is attempted). */
async function fresh(u, locator, label) {
  try {
    await locator.waitFor({ timeout: 10000 });
  } catch {
    const main = (await u.page.locator('main').innerText().catch(() => '')).slice(0, 600).replace(/\n+/g, ' | ');
    throw new Error(`STALE: ${label} on ${u.page.url()} — page shows: ${main}`);
  }
  if (u.errors.length) throw new Error('page error: ' + u.errors.join('; '));
}

const results = [];
async function step(name, fn, u) {
  const t = Date.now();
  try {
    await fn();
    results.push([name, 'ok', Date.now() - t]);
    console.log('ok  ', name, `${Date.now() - t} ms`);
  } catch (e) {
    results.push([name, 'FAIL', Date.now() - t, e.message.split('\n')[0]]);
    console.log('FAIL', name, e.message.split('\n')[0]);
    if (u && !e.message.startsWith('STALE')) console.log('MAIN:', u.page.url(), (await u.page.locator('main').innerText().catch(() => '')).slice(0, 1500).replace(/\n+/g, ' | '));
  }
}

(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const wh = await asUser('warehouse.nfd@bryels-care.test');
  const mg = await asUser('manager.nfd@bryels-care.test');
  const qa = await asUser('qa.nfd@bryels-care.test');
  const ad = await asUser('admin@bryels-care.test');
  const op = await asUser('operator.nfd@bryels-care.test');
  const pl = await asUser('planner.nfd@bryels-care.test');
  const ql = await asUser('qa.lead@bryels-care.test');

  // 1. Receipts: change a line discrepancy on the draft receipt.
  await step('receipt: change discrepancy', async () => {
    const p = wh.page;
    await p.goto(BASE + '/inventory/receipts');
    await p.getByRole('link', { name: /^Draft/ }).first().click();
    await p.waitForURL(/\/inventory\/receive\/[0-9a-f-]{36}$/);
    await p.getByText('Change discrepancy').first().click();
    const form = p.locator('form', { has: p.locator('input[name=lineId]') }).first();
    const note = `Repro ${Date.now()}: drum 2 dented, seal intact`;
    await form.locator('input[name=note]').fill(note);
    await form.locator('button[type=submit]').click();
    await fresh(wh, p.getByText(`Damaged: ${note}`).first(), 'receipt discrepancy');
  }, wh);

  // 2. Counts: release (freeze) the planned count, then cancel it.
  await step('count: release and freeze', async () => {
    const p = mg.page;
    await p.goto(BASE + '/inventory/counts');
    await p.getByRole('link', { name: 'CNT-26-0001', exact: true }).first().click();
    await p.waitForURL(/\/inventory\/counts\/[0-9a-f-]{36}$/);
    await p.getByRole('button', { name: 'Release and freeze' }).click();
    // The release form leaves with the Planned state; the page itself shows the new state.
    await fresh(mg, p.getByText('Counting (frozen)', { exact: true }).first(), 'count release refresh (status)');
    await fresh(mg, p.getByText(/^0 of [1-9]\d* lines counted$/).first(), 'count lines snapshotted');
  }, mg);
  await step('count: cancel', async () => {
    const p = mg.page;
    await p.getByRole('button', { name: 'Cancel count' }).first().click();
    const reason = p.locator('input[name=reason]').first();
    await reason.waitFor({ timeout: 5000 });
    await reason.fill('Repro: count rescheduled');
    await p.getByRole('button', { name: 'Cancel count' }).last().click();
    await fresh(mg, p.getByText('Repro: count rescheduled', { exact: true }).first(), 'count cancel refresh (reason shown)');
    await fresh(mg, p.getByText('Cancelled', { exact: true }).first(), 'count cancel refresh (status)');
  }, mg);

  // 3. Adjustments: approve, then post.
  await step('adjustment: approve', async () => {
    const p = mg.page;
    await p.goto(BASE + '/inventory/adjustments');
    await p.getByRole('link', { name: 'ADJ-26-00001', exact: true }).first().click();
    await p.waitForURL(/\/inventory\/adjustments\/[0-9a-f-]{36}$/);
    await p.getByRole('button', { name: 'Approve', exact: true }).first().click();
    const reason = p.locator('input[name=reason]');
    if (await reason.count()) {
      await reason.first().fill('Repro: damage confirmed on site');
      await p.getByRole('button', { name: 'Approve', exact: true }).last().click();
    }
    await fresh(mg, p.getByText(/^Approved/).first(), 'adjustment approve message');
    await fresh(mg, p.getByRole('button', { name: /^Post/ }).first(), 'adjustment approve refresh (Post offered)');
  }, mg);
  await step('adjustment: post', async () => {
    const p = mg.page;
    await p.getByRole('button', { name: /^Post/ }).first().click();
    await fresh(mg, p.getByText('posted', { exact: true }).first(), 'adjustment post refresh (status)');
    await fresh(mg, p.getByText(/^Posted\. Corrections are a reversal/).first(), 'adjustment post refresh (next step)');
  }, mg);

  // 4. QA: incoming inspection on a quarantined lot: sample, every result, submit.
  await step('qa: start inspection (redirect)', async () => {
    const p = qa.page;
    await p.goto(BASE + '/quality');
    await p.getByRole('link', { name: 'L-2610-00013', exact: true }).first().click();
    await p.waitForURL(/\/quality\/lots\//);
    await p.getByRole('button', { name: 'Start inspection' }).click();
    await p.waitForURL(/\/quality\/inspections\/[0-9a-f-]{36}/, { timeout: 15000 });
  }, qa);
  await step('qa: record sample', async () => {
    const p = qa.page;
    await p.locator('input[name=qty]').first().fill('10');
    await p.getByRole('button', { name: 'Record sample' }).click();
    await fresh(qa, p.getByText(/^Sample 1 recorded/).first(), 'sample message');
    await fresh(qa, p.getByRole('cell', { name: '10.0 g' }).first(), 'sample row');
  }, qa);
  await step('qa: record every result', async () => {
    const p = qa.page;
    for (let guard = 0; guard < 8; guard++) {
      const li = p.locator('li').filter({ has: p.getByRole('button', { name: 'Record result' }) }).first();
      if (!(await li.count())) break;
      const title = (await li.locator('p').first().innerText()).trim();
      await li.locator('input[name=value]').fill('Conforms (repro)');
      const conforms = li.locator('select[name=conforms]');
      if (await conforms.count()) await conforms.selectOption('yes');
      await li.getByRole('button', { name: 'Record result' }).click();
      await fresh(qa, p.locator('li', { hasText: title }).getByText('Pass', { exact: true }).first(), 'result ' + title);
    }
  }, qa);
  await step('qa: awaiting review after the last result', async () => {
    await fresh(qa, qa.page.getByText('Awaiting review').first(), 'inspection status after last result');
    qa.inspectionUrl = qa.page.url();
  }, qa);
  await step('qa: review by a second QA user', async () => {
    const p = ql.page;
    await p.goto(BASE + '/quality/inspections');
    await p.getByRole('link', { name: /^INS-\d{2}-\d{5}$/ }).filter({ hasText: (await qa.page.locator('h1').innerText()).trim() }).first().click();
    await p.waitForURL(/\/quality\/inspections\/[0-9a-f-]{36}/);
    await p.selectOption('#decision', 'approve');
    await p.getByRole('button', { name: 'Record review' }).click();
    await fresh(ql, p.getByText('Approved · pass').first(), 'review refresh');
  }, ql);

  // 5. Holds: place (redirect), then mark under investigation (in place).
  await step('hold: place (redirect) and investigate', async () => {
    const p = qa.page;
    await p.goto(BASE + '/quality/holds');
    await p.getByRole('link', { name: 'Place hold' }).first().click();
    await p.waitForURL(/\/quality\/holds\/new/);
    await p.fill('#lot', 'L-2610-00012');
    await p.selectOption('#reasonCode', { index: 1 });
    await p.fill('#reason', 'Repro: supplier notice received, checking the lot');
    await p.getByRole('button', { name: 'Place hold' }).click();
    await p.waitForURL(/\/quality\/holds\/[0-9a-f-]{36}/, { timeout: 15000 });
    const note = p.locator('textarea[name=note], input[name=note]').first();
    await note.waitFor({ timeout: 10000 });
    await note.fill('Repro: investigating with the supplier');
    await p.getByRole('button', { name: 'Mark investigating' }).click();
    // The investigate form leaves with the open state; the status and the timeline show the change.
    await fresh(qa, p.getByText('Investigating', { exact: true }).first(), 'investigate refresh (status)');
    await fresh(qa, p.getByText('Repro: investigating with the supplier').first(), 'investigate refresh (timeline)');
    qa.holdNumber = (await p.locator('h1').innerText()).trim();
  }, qa);
  await step('hold: lift by a second QA user', async () => {
    const p = ql.page;
    await p.goto(BASE + '/quality/holds');
    await p.getByRole('link', { name: qa.holdNumber }).first().click();
    await p.waitForURL(/\/quality\/holds\/[0-9a-f-]{36}/);
    await p.fill('#lift-reason', 'Repro: supplier confirmed, contents unaffected');
    await p.getByRole('button', { name: 'Lift hold' }).click();
    // The lift form leaves with the active state; the status and the resolution show the change.
    await fresh(ql, p.getByText('Closed', { exact: true }).first(), 'lift refresh (status)');
    await fresh(ql, p.getByText('Repro: supplier confirmed, contents unaffected').first(), 'lift refresh (resolution shown)');
  }, ql);

  // 6. Admin: change a setting that needs no approval.
  await step('admin: change setting', async () => {
    const p = ad.page;
    await p.goto(BASE + '/admin');
    await p.goto(BASE + '/admin/settings');
    const key = 'settings.ux.undo_window_seconds';
    const card = p.locator('div, section, li').filter({ has: p.getByText(key, { exact: false }) }).filter({ has: p.locator('summary') }).last();
    await card.locator('summary', { hasText: 'Change' }).click();
    await p.locator(`[id="${key}-value"]`).fill('61');
    await p.locator(`[id="${key}-reason"]`).fill('Repro: one more second');
    await p.locator(`[id="${key}-password"]`).fill(PW);
    await card.getByRole('button', { name: 'Save change' }).click();
    await fresh(ad, p.getByText(/^Saved\. The change applies from the next request/).first(), 'setting message');
    await fresh(ad, p.getByText(/^Organization: 61\b/).first(), 'setting refresh (value)');
  }, ad);

  // 7. Batch execution: weigh the first ingredient of the in-process batch.
  await step('batch: weigh ingredient 1', async () => {
    const p = op.page;
    await p.goto(BASE + '/production');
    await p.getByRole('link', { name: /B-26-0004/ }).first().click();
    await p.waitForURL(/\/production\/[0-9a-f-]{36}$/);
    const row = p.locator('[data-testid=ingredient-1]');
    await row.locator('summary', { hasText: /^Weigh / }).click();
    const form = row.locator('[data-testid=weigh-form]');
    await form.waitFor();
    // The lot is chosen from a list (owner feedback 2026-10-25); the first option is preselected.
    const lotNo = (await form.locator('select[id^=lotpick-] option:checked').innerText()).split(' · ')[0];
    const label = await form.locator('label', { hasText: 'Net weight (target' }).innerText();
    await form.locator('input[name=qty]').fill(label.match(/target ([\d,.]+) g/)[1].replace(/,/g, ''));
    await form.getByText('Within tolerance').waitFor();
    const box = form.locator('[data-testid=cosign-checker]');
    await box.locator('select[name=checkerId]').selectOption({ label: 'Jun Dela Cruz' });
    await box.locator('input[name=checkerPassword]').fill(PW);
    await form.getByRole('button', { name: 'Confirm weight' }).click();
    await fresh(op, row.getByText('Dispensed', { exact: true }), 'dispensed refresh');
  }, op);

  // 8. Notifications: mark read, acknowledge (header badge and list refresh).
  await step('notifications: mark read and acknowledge', async () => {
    const p = mg.page;
    await p.goto(BASE + '/dashboard');
    await p.getByRole('link', { name: /^Notifications, \d+ unread$/ }).click();
    await p.waitForURL(/\/notifications/);
    const before = await p.getByRole('link', { name: /^Notifications, \d+ unread$/ }).getAttribute('aria-label');
    await p.getByRole('button', { name: 'Mark read' }).first().click();
    await fresh(mg, p.getByRole('link', { name: /^Notifications, \d+ unread$/ }).and(p.locator(`:not([aria-label="${before}"])`)), 'unread count refresh');
    // Wave 3 seeds (action centre rules, W3E/W3F data) give the manager several open items: the
    // acknowledged one leaves the list, the others stay.
    const acks = p.getByRole('button', { name: 'Acknowledge' });
    const n = await acks.count();
    await acks.first().click();
    if (n === 1) await fresh(mg, p.getByText('Nothing needs your attention').first(), 'acknowledge refresh');
    else {
      const ok = await p
        .waitForFunction((m) => [...document.querySelectorAll('main button')].filter((b) => b.textContent.trim() === 'Acknowledge').length === m, n - 1, { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      if (!ok) throw new Error(`STALE: acknowledge refresh on ${p.url()} (still ${n} items to acknowledge)`);
    }
  }, mg);

  // 9. Work order: create (redirect), plan, release (manager), cancel: all in place.
  await step('work order: plan', async () => {
    const p = pl.page;
    await p.goto(BASE + '/production/work-orders');
    await p.getByRole('link', { name: /New work order/ }).first().click();
    await p.waitForURL(/\/production\/work-orders\/new/);
    const prodOpt = await p.locator('#productId option', { hasText: 'ACS-135' }).first().innerText();
    await p.selectOption('#productId', { label: prodOpt });
    await p.fill('#batchSizeKg', '17.6');
    await p.fill('#batchCount', '1');
    await p.fill('#plannedStart', manilaDate(0));
    await p.fill('#plannedEnd', manilaDate(2));
    await p.getByRole('button', { name: 'Create work order' }).click();
    await p.waitForURL(/\/production\/work-orders\/[0-9a-f-]{36}/, { timeout: 30000 });
    await p.getByRole('button', { name: 'Plan (resolve revisions)' }).click();
    await fresh(pl, p.getByText('Planned with').first(), 'plan message');
    await fresh(pl, p.getByText('Planned', { exact: true }).first(), 'plan refresh (status)');
  }, pl);
  await step('work order: release and cancel', async () => {
    const p = mg.page;
    await p.goto(BASE + '/production/work-orders');
    const num = (await pl.page.locator('h1').innerText()).trim();
    await p.getByRole('link', { name: num }).first().click();
    await p.waitForURL(/\/production\/work-orders\/[0-9a-f-]{36}/);
    await p.getByRole('button', { name: 'Release and reserve materials' }).click();
    await fresh(mg, p.getByText('Released.').first(), 'release message');
    await fresh(mg, p.getByRole('button', { name: /Create batch 1 of 1/ }), 'release refresh');
    await p.fill('#reason', 'Repro cleanup');
    await p.getByRole('button', { name: 'Cancel work order' }).click();
    await fresh(mg, p.getByText('Repro cleanup').first(), 'cancel refresh');
  }, mg);

  const failed = results.filter((r) => r[1] !== 'ok');
  console.log(`\nREPRO ${failed.length ? 'FAILED' : 'PASSED'}: ${results.length - failed.length}/${results.length} steps`);
  for (const f of failed) console.log('  ', f[0], '-', f[3]);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
