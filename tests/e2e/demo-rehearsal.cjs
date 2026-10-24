/* Full client-demo rehearsal against the running production build.
 * Run: NODE_PATH=$(npm root -g) node rehearsal.cjs
 * Requires a fresh seed. Fails loudly on assertion errors, error pages, console errors and failed requests.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = __dirname;
const PW = 'demo1234';
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const problems = [];
let shotNo = 0;
const facts = {};

function manilaDate(offsetDays = 0) {
  const t = new Date(Date.now() + offsetDays * 86400000);
  return t.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}
function log(...a) {
  console.log('[rehearsal]', ...a);
}

let browser;
async function asUser(email, viewport = DESK, extra = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-PH', timezoneId: 'Asia/Manila', ...extra });
  const page = await context.newPage();
  const tag = email.split('@')[0];
  const watch = (p) => {
    p.on('console', (m) => {
      // "Failed to load resource" carries no URL; the response listener below reports those with the URL.
      if (m.type() === 'error' && !/favicon/i.test(m.text()) && !/^Failed to load resource/.test(m.text())) problems.push(`[${tag}] console error on ${p.url()}: ${m.text()}`);
    });
    p.on('pageerror', (e) => problems.push(`[${tag}] page error on ${p.url()}: ${e.message}`));
    p.on('requestfailed', (r) => {
      const f = r.failure()?.errorText ?? '';
      if (/favicon/i.test(r.url())) return;
      // Next.js cancels in-flight RSC prefetches on navigation; those are not failures of the app.
      // Likewise for prefetched route chunks (/_next/static/) when a navigation starts first.
      if (f.includes('ERR_ABORTED') && (r.url().includes('_rsc=') || r.url().includes('/_next/static/') || r.resourceType() === 'fetch' || r.resourceType() === 'document')) return;
      problems.push(`[${tag}] request failed ${r.method()} ${r.url()}: ${f}`);
    });
    p.on('response', (r) => {
      if (r.status() >= 400 && !/favicon/i.test(r.url())) problems.push(`[${tag}] HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    });
  };
  watch(page);
  context.on('page', watch);
  await page.goto(BASE + '/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 30000 });
  await noErrorPage(page);
  return { context, page };
}

async function noErrorPage(page) {
  const body = await page.locator('body').innerText();
  for (const bad of ['Application error', 'Internal Server Error', 'This page could not be found', 'could not be loaded', 'Something went wrong', 'Unhandled Runtime Error']) {
    assert(!body.includes(bad), `error page on ${page.url()}: "${bad}"`);
  }
  if (problems.length) throw new Error('Problems detected:\n' + problems.join('\n'));
}

async function shot(page, name, opts = {}) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await noErrorPage(page);
  if (opts.top) await page.evaluate(() => window.scrollTo(0, 0));
  shotNo += 1;
  const file = path.join(OUT, `${String(shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: !!opts.full });
  log('screenshot', path.basename(file));
  return file;
}

async function expectText(page, text, timeout = 15000) {
  await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
}

async function kpiValue(page, caption) {
  const card = page.locator(`a[aria-label^="${caption}:"]`);
  const txt = await card.locator('div.tabular').first().innerText();
  return Number(txt.replace(/[^0-9.]/g, '').replace(/\.$/, '')) || 0;
}

(async () => {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  // ---------------- a. Owner overview ----------------
  {
    const { context, page } = await asUser('owner@bryels-care.test');
    await expectText(page, 'Owner overview');
    for (const t of ['Orders this week', 'Production output', 'Stock at FEFO risk', 'QA queue', 'Batch journey', 'Near-expiry lots', 'Order fulfilment', 'Recent activity']) await expectText(page, t);
    facts.ordersBefore = await kpiValue(page, 'Orders this week');
    facts.outputBefore = await kpiValue(page, 'Production output');
    log('owner KPIs before: orders', facts.ordersBefore, 'output units', facts.outputBefore);
    assert(await page.locator('svg[aria-label^="Orders created in the last 30 days"], [aria-label^="Orders created in the last 30 days"]').count() > 0, 'donut present');
    await shot(page, 'owner-overview');
    await shot(page, 'owner-overview-full', { full: true });
    await context.close();
  }

  // ---------------- b. Warehouse receives coconut oil ----------------
  const wh = await asUser('warehouse.nfd@bryels-care.test');
  {
    const page = wh.page;
    await page.goto(BASE + '/inventory/receive');
    await expectText(page, 'Receive materials');
    await page.fill('#supplierName', 'Laguna Oleo Supply');
    await page.fill('#supplierDocumentNumber', 'DR-88213');
    await page.fill('#notes', 'Seals intact, drums clean and dry.');
    await page.selectOption('#line-1-material', { label: 'MAT-0012 · Coconut Oil' });
    await page.fill('#line-1-qty', '25000');
    await page.fill('#line-1-slot', 'LOS-25190');
    facts.coconutExpiry = manilaDate(365);
    await page.fill('#line-1-exp', facts.coconutExpiry);
    const locLabel = await page.locator('#line-1-loc option:checked').innerText();
    assert(/QUA-01/.test(locLabel), 'default receiving location is quarantine, got ' + locLabel);
    await shot(page, 'receive-form');
    await page.getByRole('button', { name: 'Post receipt' }).click();
    await page.waitForURL(/\/inventory\/receive\/[0-9a-f-]{36}\?posted=1/, { timeout: 30000 });
    await expectText(page, 'posted');
    facts.receiptNumber = (await page.locator('h1').innerText()).trim();
    facts.coconutLot = (await page.locator('[data-testid=created-lot]').first().innerText()).trim();
    assert(/^GR-\d{2}-\d{5}$/.test(facts.receiptNumber), 'receipt number ' + facts.receiptNumber);
    assert(/^L-\d{4}-\d{5}$/.test(facts.coconutLot), 'lot number ' + facts.coconutLot);
    await expectText(page, '25.00 kg');
    await expectText(page, 'Quarantined');
    log('received', facts.receiptNumber, 'lot', facts.coconutLot);
    await shot(page, 'receipt-posted');

    // Labels go through label jobs (US-2-12): send the receipt's jobs to the station, print one, confirm it.
    const [labels] = await Promise.all([wh.context.waitForEvent('page'), page.getByRole('link', { name: /Print labels/ }).click()]);
    await labels.waitForLoadState('networkidle');
    await labels.setViewportSize(DESK);
    await labels.getByText(facts.coconutLot).first().waitFor();
    await labels.getByRole('button', { name: /Send 1 label job/ }).click();
    await labels.getByText(/label job\(s\) sent to the print station/).waitFor({ timeout: 20000 });
    await labels.goto(BASE + '/labels');
    const job = labels.locator('[data-testid=station-job]').filter({ hasText: facts.coconutLot }).first();
    await job.waitFor();
    await shot(labels, 'label-station-queue');
    const [printTab] = await Promise.all([wh.context.waitForEvent('page'), job.getByRole('link', { name: 'Print' }).click()]);
    await printTab.waitForLoadState('networkidle');
    await printTab.setViewportSize(DESK);
    await printTab.getByText(facts.coconutLot).first().waitFor();
    assert((await printTab.locator('.print-label svg, [data-testid=label-page] svg, main svg').count()) > 0, 'QR svg on label');
    await shot(printTab, 'lot-label-qr');
    await printTab.getByRole('button', { name: 'Printed OK' }).click();
    await printTab.getByText('Recorded as printed').waitFor({ timeout: 20000 });
    log('label printed for', facts.coconutLot);
    await printTab.close();
    await labels.close();

    // ---------------- c. Scan the new lot ----------------
    // The scan page answers with a result card (US-2-13), then "Open lot" goes to the lot page.
    await page.goto(BASE + '/inventory/scan');
    await page.locator('#scan-input').focus();
    await page.keyboard.type(`BC:LOT:${facts.coconutLot}`, { delay: 10 }); // keyboard-wedge scanner
    await page.keyboard.press('Enter');
    const card = page.locator('[data-testid=scan-result][data-entity=lot]');
    await card.waitFor({ timeout: 20000 });
    await card.getByText('Quarantined: not usable yet').waitFor();
    assert((await card.innerText()).includes(facts.coconutLot), 'scan card shows the lot');
    await shot(page, 'scan-lot-quarantined');
    await card.getByRole('link', { name: 'Open lot' }).click();
    await page.waitForURL(/\/inventory\/[0-9a-f-]{36}$/, { timeout: 20000 });
    facts.coconutLotId = page.url().split('/').pop();
    assert((await page.locator('h1').innerText()).includes(facts.coconutLot), 'scanned lot page');
  }

  // ---------------- d. QA releases the new lot; expired lot cannot be released ----------------
  const qa = await asUser('qa.nfd@bryels-care.test');
  {
    const page = qa.page;
    await page.goto(BASE + '/quality');
    await expectText(page, 'QA queue');
    await page.getByRole('link', { name: facts.coconutLot }).first().waitFor();
    await shot(page, 'qa-queue');
    await page.getByRole('link', { name: facts.coconutLot }).first().click();
    await page.waitForURL(/\/quality\/lots\//);
    await expectText(page, 'Quarantined: awaiting QA decision');
    await page.check('input[name=decision][value=release]');
    await page.fill('#reason', 'CoA LOS-25190 reviewed; appearance, colour and odour conform.');
    await page.getByRole('button', { name: /^Release/ }).click();
    await expectText(page, 'This lot may be used and shipped');
    await page.locator('table').getByText('CoA LOS-25190 reviewed').first().waitFor();
    await shot(page, 'qa-lot-released', { top: true });

    // Expired Acapulco Extract (supplier lot LB-6620)
    await page.goto(BASE + '/inventory?q=LB-6620');
    const expiredLink = page.locator('a[href^="/inventory/"]').filter({ hasText: /^L-\d{4}-\d{5}$/ }).first();
    await expiredLink.waitFor();
    facts.expiredLot = (await expiredLink.innerText()).trim();
    await expiredLink.click();
    await page.waitForURL(/\/inventory\/[0-9a-f-]{36}$/);
    await expectText(page, 'not usable');
    await page.getByRole('link', { name: 'Open QA decision' }).click();
    await page.waitForURL(/\/quality\/lots\//);
    await expectText(page, 'cannot be released');
    const rel = page.locator('input[name=decision][value=release]');
    if (await rel.count()) assert(await rel.isDisabled(), 'release radio disabled for expired lot');
    await shot(page, 'qa-expired-blocked');
    log('expired lot', facts.expiredLot, 'release blocked');
  }

  // ---------------- d2. Warehouse puts the released lot away to the oils rack ----------------
  {
    const page = wh.page;
    await page.goto(BASE + '/inventory/' + facts.coconutLotId);
    await expectText(page, 'Released');
    // Scan-to-move (US-2-14): the lot is preloaded from the lot page; scan the rack label, confirm.
    await page.getByRole('link', { name: 'Move stock' }).click();
    await page.waitForURL(/\/inventory\/move\?lot=/);
    await page.locator('#dst').waitFor();
    await page.locator('#dst').fill('BC:LOC:A-01');
    await page.locator('#dst').press('Enter');
    await page.getByRole('button', { name: 'Confirm move' }).waitFor({ timeout: 20000 });
    await page.getByRole('textbox', { name: 'Reason (optional)' }).fill('Put-away after QA release');
    await shot(page, 'move-to-rack');
    await page.getByRole('button', { name: 'Confirm move' }).click();
    await page.getByText(/^Posted TR-\d{2}-\d{6}$/).waitFor({ timeout: 20000 });
    await expectText(page, 'to A-01');
    assert(await page.getByRole('button', { name: /^Undo \(\d+s\)$/ }).count() === 1, 'undo offered for own move');
    await shot(page, 'move-posted-undo');
    await page.goto(BASE + '/inventory/' + facts.coconutLotId);
    await expectText(page, 'A-01');
    log('coconut lot moved to A-01');
  }

  // ---------------- e. Manager plans a batch ----------------
  {
    const { context, page } = await asUser('manager.nfd@bryels-care.test');
    await page.goto(BASE + '/production/new');
    await page.selectOption('#productId', { label: 'Acapulco Soap 135 g (ACS-135)' });
    await page.fill('#plannedSizeKg', '17.6');
    await expectText(page, 'Theoretical yield 16.72 kg');
    await shot(page, 'new-batch-form');
    await page.getByRole('button', { name: 'Create batch' }).click();
    await page.waitForURL(/\/production\/[0-9a-f-]{36}$/, { timeout: 30000 });
    facts.batchId = page.url().split('/').pop();
    facts.batchNumber = (await page.locator('h1').innerText()).trim();
    assert(/^B-\d{2}-\d{4}$/.test(facts.batchNumber), 'batch number ' + facts.batchNumber);
    await expectText(page, 'Planned, not started');
    log('batch', facts.batchNumber);
    await shot(page, 'batch-planned');
    await context.close();
  }

  // ---------------- f. Operator executes the batch (W2B operator mode: one step at a time) ----------------
  {
    const { context, page } = await asUser('operator.nfd@bryels-care.test');
    const CHECKER = 'Jun Dela Cruz';
    // The checker signs on the operator's device with their own password (never the operator's session).
    const coSign = async (scope) => {
      const box = scope.locator('[data-testid=cosign-checker]');
      await box.locator('select[name=checkerId]').selectOption({ label: CHECKER });
      await box.locator('input[name=checkerPassword]').fill(PW);
    };
    const panel = (n) => page.locator(`[data-testid=step-panel-${n}]`);
    const stepDone = async (n) => page.locator(`[data-testid=stepper-${n}]`).getByText('Done', { exact: true }).waitFor({ timeout: 20000 });
    const signClearance = async (n) => {
      const form = panel(n).locator('[data-testid=checklist-form]');
      await form.waitFor({ timeout: 20000 });
      const items = form.locator('[data-testid^=check-item-]');
      for (let i = 0; i < (await items.count()); i++) await items.nth(i).getByText('Yes', { exact: true }).click();
      await coSign(form);
      await form.getByRole('button', { name: `Sign clearance (step ${n})` }).click();
      await stepDone(n);
    };
    const completeWithChecker = async (n) => {
      const form = panel(n).locator('[data-testid=complete-step-form]');
      await coSign(form);
      await form.getByRole('button', { name: `Complete step ${n}` }).click();
      await stepDone(n);
    };

    await page.goto(BASE + '/production/' + facts.batchId);
    await page.getByRole('button', { name: 'Start batch' }).click();
    await expectText(page, 'In process');

    // Step 1: weighing-area line clearance, conductor + checker.
    await signClearance(1);
    log('step 1 clearance signed');

    // Step 2: weighing. Scan each lot (FEFO recommendation shown), scale, weight, checker signs on device.
    await panel(2).waitFor({ timeout: 20000 });
    for (let n = 1; n <= 5; n++) {
      const row = page.locator(`[data-testid=ingredient-${n}]`);
      await row.locator('summary', { hasText: /^Weigh / }).click();
      const form = row.locator('[data-testid=weigh-form]');
      await form.waitFor();
      const hint = await form.getByText(/^Recommended \(FEFO\): /).innerText();
      const lotNo = hint.replace(/^Recommended \(FEFO\): /, '').split(' at ')[0].trim();
      if (n === 1) assert(lotNo === facts.coconutLot && hint.includes('A-01'), `coconut oil FEFO suggests the newly released lot ${facts.coconutLot}, got ${hint}`);
      await form.locator('input[name=lotRef]').fill('BC:LOT:' + lotNo);
      const label = await form.locator('label', { hasText: 'Net weight (target' }).innerText();
      const theo = label.match(/target ([\d,.]+) g/)[1].replace(/,/g, '');
      await form.locator('input[name=qty]').fill(theo);
      await form.getByText('Within tolerance').waitFor();
      await coSign(form);
      if (n === 1) await shot(page, 'weigh-coconut-within-tolerance');
      await form.getByRole('button', { name: 'Confirm weight' }).click();
      await row.getByText('Dispensed', { exact: true }).waitFor({ timeout: 20000 });
      log(`weighed ingredient ${n}: ${theo} g from ${lotNo}`);
    }
    await completeWithChecker(2);

    // Step 3: production-area clearance.
    await signClearance(3);

    // Step 4: mixing and cutting: mixer from the equipment register, readings against the frozen routing.
    {
      const p = panel(4);
      const eq = p.locator('[data-testid=equipment-form]');
      await eq.locator('select[name=equipmentRef]').selectOption('MIX-01');
      await eq.getByRole('button', { name: 'Record equipment' }).click();
      await p.getByText(/Equipment: MIX-01/).waitFor({ timeout: 20000 });
      for (const [code, v] of [['oil_temp', '48'], ['trace_time', '22'], ['mould_id', 'MLD-01 frame 3']]) {
        const f = p.locator(`[data-testid=param-${code}]`);
        await f.locator('input[name=value]').fill(v);
        await f.getByRole('button', { name: 'Record' }).click();
        await f.getByText(`Recorded ${v}`).waitFor({ timeout: 20000 });
      }
      await completeWithChecker(4);
    }

    // Step 5: packaging-area clearance.
    await signClearance(5);

    // Step 6: packaging and labelling: issue wrappers by scan, reconcile issued − used − damaged − returned.
    {
      const p = panel(6);
      const issue = p.locator('[data-testid=packaging-issue-form]');
      const hint = await issue.getByText(/^Released: /).innerText();
      const wrapperLot = hint.replace(/^Released: /, '').split(' ')[0];
      await issue.locator('input[name=lotRef]').fill('BC:LOT:' + wrapperLot);
      await issue.locator('input[name=qty]').fill('130');
      await issue.getByRole('button', { name: 'Issue to packaging' }).click();
      const count = p.locator(`[data-testid=packaging-count-${wrapperLot}]`);
      await count.waitFor({ timeout: 20000 });
      await count.locator('input[name=used]').fill('124');
      await count.locator('input[name=damaged]').fill('2');
      await count.locator('input[name=returned]').fill('4');
      await count.getByRole('button', { name: 'Save count' }).click();
      await p.getByText('Reconciled', { exact: true }).waitFor({ timeout: 20000 });
      for (const [code, v] of [['wrappers_used', '124'], ['wrappers_destroyed', '2']]) {
        const f = p.locator(`[data-testid=param-${code}]`);
        await f.locator('input[name=value]').fill(v);
        await f.getByRole('button', { name: 'Record' }).click();
        await f.getByText(`Recorded ${v}`).waitFor({ timeout: 20000 });
      }
      await completeWithChecker(6);
    }
    await expectText(page, 'Step 7 of 7');

    // Yield (W05-16) and transfer to quarantine (W05-17): one posting with the checker.
    const yt = page.locator('[data-testid=yield-transfer]');
    await yt.locator('#actualUnits').fill('124');
    await expectText(page, 'Yield: 100.12 %');
    await yt.getByRole('button', { name: 'Record yield' }).click();
    const transfer = yt.locator('[data-testid=transfer-form]');
    await transfer.waitFor({ timeout: 20000 });
    await transfer.locator('input[name=locationRef]').fill('BC:LOC:QUA-01');
    await coSign(transfer);
    await transfer.getByText('This posts consumption and output').click();
    await shot(page, 'batch-weighed-and-checklist', { full: true });
    await transfer.getByRole('button', { name: 'Post to quarantine and send to QA' }).click();
    await expectText(page, 'Awaiting QA decision', 30000);
    facts.fgLot = (await yt.locator('span.font-mono').first().innerText()).trim();
    assert(/^L-\d{4}-\d{5}$/.test(facts.fgLot), 'output lot ' + facts.fgLot);
    log('batch posted to quarantine, output lot', facts.fgLot);
    await shot(page, 'batch-awaiting-qc', { top: true });
    await context.close();
  }

  // ---------------- g. QA tests and releases the batch ----------------
  {
    const page = qa.page;
    await page.goto(BASE + '/quality');
    await page.getByRole('link', { name: facts.batchNumber }).first().click();
    await page.waitForURL(/\/quality\/batches\//);
    await expectText(page, 'Batch status: awaiting QC');
    const tests = [
      ['pH (10% solution)', '9.0 – 10.5', '9.7'],
      ['Appearance', 'Smooth green bar, no cracks', 'Conforms'],
      ['Net weight (n=10)', '≥ 135 g each', '136.0 g avg'],
    ];
    for (const [name, spec, res] of tests) {
      await page.fill('#testName', name);
      await page.fill('#specification', spec);
      await page.fill('#result', res);
      await page.selectOption('#passed', 'pass');
      await page.getByRole('button', { name: 'Record test result' }).click();
      await page.locator('table td', { hasText: res }).first().waitFor({ timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector('#testName')?.value, null, { timeout: 10000 }).catch(() => {});
    }
    await expectText(page, '3 passed');
    await page.check('input[name=decision][value=release]');
    await page.fill('#reason', 'All three tests within specification; BMR reviewed, no exceptions.');
    await shot(page, 'qa-batch-tests', { full: true });
    await page.getByRole('button', { name: 'Release batch' }).click();
    await expectText(page, 'Batch status: released', 30000);
    await expectText(page, 'at FG-01');
    await shot(page, 'qa-batch-released', { top: true });

    // ---------------- h. BMR print ----------------
    await page.goto(BASE + '/print/bmr/' + facts.batchId);
    await expectText(page, facts.batchNumber);
    await shot(page, 'bmr-print');
    await shot(page, 'bmr-print-full', { full: true });
    await page.pdf({ path: path.join(OUT, 'bmr.pdf'), printBackground: true, preferCSSPageSize: true });
    log('BMR PDF saved');
  }

  // ---------------- i. Sales creates and confirms the order ----------------
  {
    const { context, page } = await asUser('sales@bryels-care.test');
    await page.goto(BASE + '/sales/new');
    await page.selectOption('#customerId', { label: 'Mabuhay Pharmacy Group (CUS-003)' });
    await expectText(page, 'Min shelf life at dispatch: 270 days');
    await page.fill('#customerPoNumber', 'MPG-PO-7781');
    await page.fill('#requestedDeliveryOn', manilaDate(3));
    const opt = await page.locator('#p-1 option', { hasText: 'ACS-135' }).first().innerText();
    await page.selectOption('#p-1', { label: opt });
    await page.fill('#q-1', '60');
    await page.fill('#u-1', '72.50');
    await expectText(page, '4,350.00');
    await shot(page, 'sales-new-order');
    await page.getByRole('button', { name: 'Create draft order' }).click();
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}$/, { timeout: 30000 });
    facts.orderId = page.url().split('/').pop();
    facts.orderNumber = (await page.locator('h1').innerText()).trim();
    await expectText(page, 'Draft');
    await page.getByRole('button', { name: 'Confirm order' }).click();
    await page.waitForURL(/done=confirmed/, { timeout: 30000 });
    await page.locator('h1 + * , header').getByText('Confirmed').first().waitFor().catch(async () => expectText(page, 'Confirmed'));
    log('order', facts.orderNumber, 'confirmed');
    await shot(page, 'sales-order-confirmed');
    await context.close();
  }

  // ---------------- j. Warehouse allocates (FEFO) and dispatches ----------------
  {
    const page = wh.page;
    await page.goto(BASE + '/sales');
    await shot(page, 'sales-orders-list');
    // Work the queue in order: yesterday's Isla Spa order is allocated first (takes the older finished lot).
    await page.getByRole('link', { name: /SO-\d{2}-00002/ }).first().click();
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}/);
    await expectText(page, 'Isla Spa Supplies');
    await page.getByRole('button', { name: /Allocate stock/ }).click();
    await page.waitForURL(/done=allocated/, { timeout: 30000 });

    await page.goto(BASE + '/sales/' + facts.orderId);
    await page.getByRole('button', { name: /Allocate stock/ }).click();
    await page.waitForURL(/done=allocated/, { timeout: 30000 });
    await expectText(page, facts.fgLot);
    await shot(page, 'order-allocated-fefo', { full: true });
    page.once('dialog', (d) => d.accept());
    await page.fill('#carrier', 'Own truck');
    await page.fill('#driverName', 'Ramon Aquino');
    await page.fill('#vehiclePlate', 'NBC 1234');
    await page.fill('#packageCount', '2');
    await page.getByRole('button', { name: 'Dispatch' }).click();
    await page.waitForURL(/done=dispatched/, { timeout: 30000 });
    await expectText(page, 'Shipped');
    await shot(page, 'order-shipped');
    const drHref = await page.locator('a[href^="/print/delivery-receipt/"]').first().getAttribute('href');
    await page.goto(BASE + drHref);
    await expectText(page, 'Mabuhay Pharmacy Group');
    await expectText(page, 'Ramon Aquino');
    await expectText(page, 'NBC 1234');
    await expectText(page, facts.fgLot);
    await shot(page, 'delivery-receipt');
    await page.pdf({ path: path.join(OUT, 'delivery-receipt.pdf'), printBackground: true, preferCSSPageSize: true });
    log('DR PDF saved');
    await wh.context.close();
  }

  // ---------------- k. QA traces the new finished lot ----------------
  {
    const page = qa.page;
    await page.goto(BASE + '/quality/trace');
    await page.fill('#q', facts.fgLot);
    await page.getByRole('button', { name: 'Trace' }).click();
    await page.waitForURL(/q=/);
    const rev = page.locator('div', { has: page.getByText('Where it came from (reverse)', { exact: true }) }).last();
    await expectText(page, facts.coconutLot);
    await expectText(page, 'Laguna Oleo Supply');
    await expectText(page, 'Mabuhay Pharmacy Group');
    void rev;
    await shot(page, 'trace-finished-lot', { full: true });
    // Recall view: from the supplier lot forward to the customer
    await page.goto(BASE + '/quality/trace?q=' + encodeURIComponent(facts.coconutLot));
    await expectText(page, facts.batchNumber);
    await expectText(page, 'Mabuhay Pharmacy Group');
    await shot(page, 'trace-coconut-forward', { full: true });
    await qa.context.close();
  }

  // ---------------- l. Owner sees the changes ----------------
  {
    const { context, page } = await asUser('owner@bryels-care.test');
    const ordersAfter = await kpiValue(page, 'Orders this week');
    const outputAfter = await kpiValue(page, 'Production output');
    log('owner KPIs after: orders', ordersAfter, 'output units', outputAfter);
    assert(ordersAfter === facts.ordersBefore + 1, `orders KPI ${facts.ordersBefore} -> ${ordersAfter}`);
    assert(outputAfter === facts.outputBefore + 124, `output KPI ${facts.outputBefore} -> ${outputAfter}`);
    await expectText(page, facts.batchNumber);
    await shot(page, 'owner-overview-after');
    await page.goto(BASE + '/admin/audit');
    for (const t of [facts.orderNumber, facts.batchNumber, facts.coconutLot, 'Shipment dispatched', 'Disposition released', 'Goods receipt posted']) await expectText(page, t);
    await shot(page, 'audit-log');
    await context.close();
  }

  // ---------------- m. Phone check ----------------
  {
    const { context, page } = await asUser('operator.nfd@bryels-care.test', PHONE, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await expectText(page, 'Good day');
    const noHScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert(await noHScroll(), 'operator home has no horizontal scroll at 390 px');
    await shot(page, 'phone-operator-home');
    await page.goto(BASE + '/production/' + facts.batchId);
    await expectText(page, facts.batchNumber);
    assert(await noHScroll(), 'batch workspace has no horizontal scroll at 390 px');
    await shot(page, 'phone-batch-workspace');
    // The seeded in-process batch: open a weigh form on the phone (not submitted).
    await page.goto(BASE + '/production');
    await page.getByRole('link', { name: /B-\d{2}-0004/ }).first().click();
    await page.waitForURL(/\/production\/[0-9a-f-]{36}$/);
    const row = page.locator('[data-testid=ingredient-1]');
    await row.locator('summary', { hasText: /^Weigh / }).click();
    await row.locator('[data-testid=weigh-form]').waitFor();
    await row.locator('input[name=qty]').fill('3723.0');
    await row.getByText('Within tolerance').waitFor();
    await row.scrollIntoViewIfNeeded();
    assert(await noHScroll(), 'weigh form has no horizontal scroll at 390 px');
    await page.screenshot({ path: path.join(OUT, `${String(++shotNo).padStart(2, '0')}-phone-weigh-form.png`) });
    await context.close();
  }

  // ---------------- n. Shell: grouped navigation, QA queue badge, no horizontal scroll ----------------
  {
    const noHScroll = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const { context, page } = await asUser('qa.nfd@bryels-care.test');
    const qaLink = page.locator('aside[aria-label="Quick actions"] a[href="/quality"]');
    const qaLabel = await qaLink.getAttribute('aria-label');
    log('QA rail icon:', qaLabel);
    assert(/^QA queue(, \d+ open)?$/.test(qaLabel), 'QA rail icon label ' + qaLabel);
    await context.close();
    const desk = await asUser('manager.nfd@bryels-care.test');
    for (const [url, group, tab] of [['/inventory/counts', 'Warehouse', 'Stock counts'], ['/inventory/containers', 'Inventory', 'Boxes'], ['/labels', 'Warehouse', 'Label print station']]) {
      await desk.page.goto(BASE + url);
      await desk.page.locator('nav[aria-label="Modules"] a[aria-current="page"]', { hasText: group }).waitFor();
      await desk.page.locator('header a[aria-current="page"]', { hasText: tab }).first().waitFor();
      assert(await noHScroll(desk.page), `${url} has no horizontal scroll at 1440 px`);
    }
    await shot(desk.page, 'shell-warehouse-tabs', { top: true });
    await desk.context.close();
    const phone = await asUser('warehouse.nfd@bryels-care.test', PHONE, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    for (const url of ['/inventory/move', '/inventory/counts', '/inventory/containers', '/labels', '/inventory/scan', '/inventory/receive']) {
      await phone.page.goto(BASE + url);
      await noErrorPage(phone.page);
      assert(await noHScroll(phone.page), `${url} has no horizontal scroll at 390 px`);
    }
    await phone.page.getByRole('button', { name: 'Open menu' }).click();
    await phone.page.getByText('Warehouse', { exact: true }).filter({ visible: true }).first().waitFor();
    await shot(phone.page, 'phone-menu-groups');
    await phone.context.close();
    log('shell checked at 1440 and 390 px');
  }

  await browser.close();
  if (problems.length) throw new Error('Problems detected:\n' + problems.join('\n'));
  console.log('\nREHEARSAL PASSED');
  console.log(JSON.stringify(facts, null, 2));
})().catch(async (e) => {
  console.error('\nREHEARSAL FAILED:', e.message);
  if (problems.length) console.error(problems.join('\n'));
  console.error(JSON.stringify(facts, null, 2));
  try {
    for (const c of browser?.contexts() ?? []) for (const p of c.pages()) await p.screenshot({ path: path.join(OUT, `FAIL-${Date.now()}.png`), fullPage: true });
  } catch {}
  await browser?.close();
  process.exit(1);
});
