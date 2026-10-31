const autoConfirm = require('./auto-confirm.cjs');
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
  await context.addInitScript(autoConfirm);
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

/**
 * Waits for the page to show the result of an in-place action. There is no reload fallback: the
 * action's response re-renders the page (ADR-043), so a screen that still looks unchanged after a
 * successful action is a failure of the rehearsal.
 */
async function settle(page, locator, label, timeout = 15000) {
  try {
    await locator.waitFor({ timeout });
  } catch {
    throw new Error(`ASSERTION FAILED: the page did not show the result of ${label} (${page.url()}); no reload fallback (ADR-043)`);
  }
}

/** W3A overview: output mass from the "Output vs plan" meter caption ("X kg output of Y kg planned"). */
async function outputKg(page) {
  const txt = await page.locator('a[aria-label^="Output vs plan:"]').getByText(/output of/).first().innerText();
  const m = txt.replace(/,/g, '').match(/([0-9.]+)\s*(kg|g)\s+output/);
  return m ? Number(m[1]) / (m[2] === 'g' ? 1000 : 1) : 0;
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
    for (const t of ['Orders', 'Output vs plan', 'FEFO risk', 'QA holds', 'Batch journey', 'Near-expiry lots', 'Order fulfilment', 'Site comparison', 'Recent activity']) await expectText(page, t);
    facts.ordersBefore = await kpiValue(page, 'Orders confirmed');
    facts.outputBefore = await outputKg(page);
    log('owner KPIs before: orders', facts.ordersBefore, 'output kg', facts.outputBefore);
    assert(await page.locator('section', { hasText: 'Order fulfilment' }).count() > 0, 'fulfilment chart present');
    await shot(page, 'owner-overview');
    await shot(page, 'owner-overview-full', { full: true });
    await context.close();
  }

  // ---------------- b. Warehouse receives coconut oil ----------------
  const wh = await asUser('warehouse.nfd@bryels-care.test');
  {
    const page = wh.page;
    // S6 (ADR-077): step 1 offers the open orders; this delivery has no purchase order.
    await page.goto(BASE + '/inventory/receive?nopo=1');
    await expectText(page, 'Receive a delivery');
    await page.fill('#supplierName', 'Laguna Oleo Supply');
    await page.fill('#supplierDocumentNumber', 'DR-88213');
    await page.getByText('More details').first().click();
    await page.fill('#notes', 'Seals intact, drums clean and dry.');
    await page.selectOption('#line-1-material', { label: 'MAT-0012 · Coconut Oil' });
    // Usability test 2026-10-30: the unit starts at the item's usual buying unit (kg for Coconut Oil).
    await page.fill('#line-1-qty', '25');
    await page.fill('#line-1-slot', 'LOS-25190');
    facts.coconutExpiry = manilaDate(365);
    await page.fill('#line-1-exp', facts.coconutExpiry);
    const locLabel = await page.locator('#line-1-loc option:checked').textContent();
    assert(/QUA-01/.test(locLabel), 'default receiving location is quarantine, got ' + locLabel);
    await shot(page, 'receive-form');
    // Consultant review flow A + usability test 2026-10-30: one button saves and opens the label print preview
    // (or, when the label size or printer must be chosen, the receipt's label page first).
    await page.getByRole('button', { name: 'Save and print labels' }).click();
    await page.waitForURL(/\/print\/(labels|lot-label)\/receipt\/[0-9a-f-]{36}\?/, { timeout: 30000 });
    const receiptId = page.url().split('?')[0].split('/').pop();
    if (/\/print\/lot-label\//.test(page.url())) {
      await page.locator('[data-testid=receipt-label-lot]').first().waitFor();
      await page.getByRole('button', { name: /Print labels for 1 lot/ }).click();
      await page.waitForURL(/\/print\/labels\/receipt\//, { timeout: 30000 });
    }
    await expectText(page, 'saved');
    await page.getByText(/^Labels sent to the printer: \d+\./).waitFor({ timeout: 20000 });
    await page.goto(BASE + '/inventory/receive/' + receiptId);
    facts.receiptNumber = (await page.locator('[data-testid=record-reference]').innerText()).trim(); // R3 record header
    facts.coconutLot = (await page.locator('[data-testid=created-lot]').first().innerText()).trim();
    assert(/^GR-\d{2}-\d{5}$/.test(facts.receiptNumber), 'receipt number ' + facts.receiptNumber);
    assert(/^L-\d{4}-\d{5}$/.test(facts.coconutLot), 'lot number ' + facts.coconutLot);
    await expectText(page, '25.00 kg');
    await expectText(page, 'Waiting for QA');
    log('received', facts.receiptNumber, 'lot', facts.coconutLot);
    await shot(page, 'receipt-posted');

    // Labels go through label jobs (US-2-12): the receipt's job is at the station; print it and confirm.
    const labels = await wh.context.newPage();
    await labels.setViewportSize(DESK);
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
    await card.getByText('Waiting for QA check: not usable yet').waitFor();
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
    await expectText(page, 'Waiting for QA check');
    await page.check('input[name=decision][value=release]');
    await page.fill('#reason', 'CoA LOS-25190 reviewed; appearance, colour and odour conform.');
    await page.getByRole('button', { name: /^OK to use/ }).click();
    await expectText(page, 'This lot may be used and shipped');
    await page.getByText('CoA LOS-25190 reviewed').first().waitFor();
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
    await expectText(page, 'cannot be made OK');
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
    await page.getByText(/^Saved TR-\d{2}-\d{6}$/).waitFor({ timeout: 20000 });
    await expectText(page, 'to A-01');
    assert(await page.getByRole('button', { name: /^Undo \(\d+s\)$/ }).count() === 1, 'undo offered for own move');
    await shot(page, 'move-posted-undo');
    await page.goto(BASE + '/inventory/' + facts.coconutLotId);
    await expectText(page, 'A-01');
    log('coconut lot moved to A-01');
  }

  // ---------------- e. Planner plans a work order; manager releases it; batch from the work order ----------------
  {
    const { context, page } = await asUser('planner.nfd@bryels-care.test');
    await page.goto(BASE + '/production/work-orders/new');
    await expectText(page, 'New production order');
    const prodOpt = await page.locator('#productId option', { hasText: 'ACS-135' }).first().innerText();
    await page.selectOption('#productId', { label: prodOpt });
    await page.fill('#batchSizeKg', '17.6');
    await page.fill('#batchCount', '1');
    await page.fill('#plannedStart', manilaDate(0));
    await page.fill('#plannedEnd', manilaDate(2));
    await shot(page, 'work-order-form');
    await page.getByRole('button', { name: 'Create production order' }).click();
    await page.waitForURL(/\/production\/work-orders\/[0-9a-f-]{36}/, { timeout: 30000 });
    facts.workOrderId = page.url().split('/').pop().split('?')[0];
    await page.getByRole('button', { name: 'Plan (resolve revisions)' }).click();
    await expectText(page, 'Planned with', 30000);
    facts.workOrderNumber = (await page.locator('h1').innerText()).trim();
    assert(/^WO-\d{2}-\d{5}$/.test(facts.workOrderNumber), 'work order number ' + facts.workOrderNumber);
    log('work order', facts.workOrderNumber, 'planned');
    await shot(page, 'work-order-planned');
    await context.close();
  }
  {
    // Separation of duties: the site manager (not the planner) releases; released lots are reserved by FEFO.
    const { context, page } = await asUser('manager.nfd@bryels-care.test');
    await page.goto(BASE + '/production/work-orders/' + facts.workOrderId);
    await page.getByRole('button', { name: 'Release and reserve materials' }).click();
    await expectText(page, 'Released.', 30000);
    await settle(page, page.getByRole('button', { name: 'Create batch 1 of 1' }), 'work order release');
    await shot(page, 'work-order-released');
    await page.getByRole('button', { name: 'Create batch 1 of 1' }).click();
    await page.waitForURL(/\/production\/staging\/[0-9a-f-]{36}/, { timeout: 30000 });
    facts.batchId = page.url().split('/').pop().split('?')[0];
    await page.goto(BASE + '/production/' + facts.batchId);
    facts.batchNumber = (await page.locator('h1').innerText()).trim();
    assert(/^B-\d{2}-\d{4}$/.test(facts.batchNumber), 'batch number ' + facts.batchNumber);
    await expectText(page, 'Planned, not started');
    log('batch', facts.batchNumber, 'from', facts.workOrderNumber);
    await shot(page, 'batch-planned');
    await context.close();
  }

  // ---------------- e2. Warehouse stages the reserved lots by scan ----------------
  facts.staged = {};
  {
    const page = wh.page;
    await page.goto(BASE + '/production/staging/' + facts.batchId);
    // Owner feedback 2026-10-25: one tap per reserved lot ("Bring … to production"), no typing of lot numbers.
    await page.getByRole('button', { name: /^Bring .* to production$/ }).first().waitFor({ timeout: 20000 });
    for (let guard = 0; guard < 12; guard++) {
      const btn = page.getByRole('button', { name: /^Bring .* to production$/ }).first();
      if (!(await btn.count())) break;
      const li = btn.locator('xpath=ancestor::li[1]');
      const lotNo = (await li.locator('span.font-mono').innerText()).trim();
      const lineTitle = (await li.locator('xpath=preceding::p[contains(@class,"font-medium")][1]').innerText()).trim();
      await btn.click();
      // No reload (ADR-043): the action's response re-renders the list without this lot's button.
      try {
        await page.locator('li', { hasText: lotNo }).getByRole('button', { name: /^Bring / }).waitFor({ state: 'detached', timeout: 20000 });
      } catch {
        throw new Error(`ASSERTION FAILED: staging ${lotNo} did not update the page (no reload fallback, ADR-043)`);
      }
      (facts.staged[lineTitle.split('. ')[0]] ??= []).push(lotNo);
      log('staged', lineTitle, 'lot', lotNo);
    }
    await expectText(page, 'All ingredients staged');
    assert(Object.keys(facts.staged).length >= 5, 'every ingredient staged: ' + JSON.stringify(facts.staged));
    await shot(page, 'staging-complete');
  }

  // ---------------- f. Operator executes the batch (W2B operator mode: one step at a time) ----------------
  {
    const { context, page } = await asUser('operator.nfd@bryels-care.test');
    const CHECKER = 'Jun Dela Cruz';
    // The checker signs on the operator's device by picking their name; the password field appears only when
    // the setting production.sign_off.require_password is on (ADR-078).
    const coSign = async (scope) => {
      const box = scope.locator('[data-testid=cosign-checker]');
      await box.locator('select[name=checkerId]').selectOption({ label: CHECKER });
      const pw = box.locator('input[name=checkerPassword]');
      if (await pw.count()) await pw.fill(PW);
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
    await expectText(page, 'Materials ready');

    // Step 1: weighing-area line clearance, conductor + checker: signing it starts the batch (in process).
    await signClearance(1);
    await expectText(page, 'Being made');
    log('step 1 clearance signed; batch in process');

    // Step 2: weighing. Scan each lot (FEFO recommendation shown), scale, weight, checker signs on device.
    await panel(2).waitFor({ timeout: 20000 });
    for (let n = 1; n <= 5; n++) {
      const row = page.locator(`[data-testid=ingredient-${n}]`);
      await row.locator('summary', { hasText: /Weigh / }).click();
      const form = row.locator('[data-testid=weigh-form]');
      await form.waitFor();
      // The lot list preselects the lot staged for this line (oldest expiry first among staged lots).
      const picked = (await form.locator('select[id^=lotpick-] option:checked').innerText()).trim();
      const lotNo = picked.split(' · ')[0].trim();
      assert((facts.staged[String(n)] ?? []).includes(lotNo), `line ${n}: a lot staged for it (${facts.staged[String(n)]}) preselected, got ${picked}`);
      const label = await form.locator('label', { hasText: 'Net weight (target' }).innerText();
      const theo = label.match(/target ([\d,.]+) g/)[1].replace(/,/g, '');
      await form.locator('input[name=qty]').fill(theo);
      await form.getByText('Within tolerance').waitFor();
      await coSign(form);
      if (n === 1) await shot(page, 'weigh-coconut-within-tolerance');
      await form.getByRole('button', { name: 'Confirm weight' }).click();
      await row.getByText('Weighed', { exact: true }).waitFor({ timeout: 20000 });
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
    await transfer.getByRole('button', { name: 'Move to hold area and send to quality' }).click();
    await expectText(page, 'Waiting for quality approval', 30000);
    facts.fgLot = (await yt.locator('span.font-mono').first().innerText()).trim();
    assert(/^L-\d{4}-\d{5}$/.test(facts.fgLot), 'output lot ' + facts.fgLot);
    log('batch posted to quarantine, output lot', facts.fgLot);
    await shot(page, 'batch-awaiting-qc', { top: true });
    await context.close();
  }

  // ---------------- g. QA: inspection against the frozen plan, review by a second QA user, release ----------------
  {
    const page = qa.page;
    await page.goto(BASE + '/quality');
    // The QA queue row opens the one-page check; the full QA review page has every detail (grade-5 pass, ADR-088).
    await page.getByRole('link', { name: facts.batchNumber }).first().waitFor();
    await page.goto(BASE + '/quality/batches/' + facts.batchId);
    await expectText(page, 'Batch: Waiting for QA check');
    // The finished-product inspection was created when the batch was posted to quarantine.
    await page.getByRole('link', { name: /INS-\d{2}-\d{5}/ }).first().click();
    await page.waitForURL(/\/quality\/inspections\/[0-9a-f-]{36}/);
    facts.inspectionId = page.url().split('/').pop();
    const results = [
      ['pH (10% solution)', { value: '9.7' }],
      ['Appearance', { value: 'Smooth green bar, no cracks', conforms: 'yes' }],
      ['Net weight (n=10)', { value: '136.0' }],
    ];
    for (const [name, r] of results) {
      const li = page.locator('li', { hasText: name }).filter({ has: page.getByRole('button', { name: 'Save result' }) }).first();
      await li.locator('input[name=value]').fill(r.value);
      if (r.conforms) await li.locator('select[name=conforms]').selectOption(r.conforms);
      await li.getByRole('button', { name: 'Save result' }).click();
      await settle(page, page.locator('li', { hasText: name }).getByText('OK', { exact: true }).first(), 'result ' + name);
    }
    await expectText(page, 'Waiting for a second QA person');
    await shot(page, 'qa-inspection-results', { full: true });
  }
  const qaLead = await asUser('qa.lead@bryels-care.test');
  {
    // Review and decision by a second QA user (reviewer ≠ tester; decider ≠ result entry).
    const page = qaLead.page;
    await page.goto(BASE + '/quality/inspections/' + facts.inspectionId);
    await page.waitForLoadState('networkidle'); // hydrated before the first click
    await page.selectOption('#decision', 'approve');
    await page.getByRole('button', { name: 'Save the check' }).click();
    await settle(page, page.getByText('Checked · OK').first(), 'inspection review');
    await page.goto(BASE + '/quality/batches/' + facts.batchId);
    await expectText(page, 'Batch: Waiting for QA check');
    await page.check('input[name=decision][value=release]');
    await page.fill('#reason', 'Inspection approved, all three tests within specification; BMR reviewed, no exceptions.');
    await shot(page, 'qa-batch-tests', { full: true });
    await page.getByRole('button', { name: 'OK to use' }).click();
    await expectText(page, 'Batch: OK to use', 30000);
    await expectText(page, 'at FG-01');
    await shot(page, 'qa-batch-released', { top: true });
    await qaLead.context.close();
  }
  {
    const page = qa.page;
    // ---------------- h. BMR print ----------------
    await page.goto(BASE + '/print/bmr/' + facts.batchId);
    await expectText(page, facts.batchNumber);
    await shot(page, 'bmr-print');
    await shot(page, 'bmr-print-full', { full: true });
    await page.pdf({ path: path.join(OUT, 'bmr.pdf'), printBackground: true, preferCSSPageSize: true });
    log('BMR PDF saved');
  }

  // ---------------- i. Sales quotes, converts the quotation to an order and submits it; finance approves (W3D) ----------------
  {
    const { context, page } = await asUser('sales@bryels-care.test');
    await page.goto(BASE + '/sales/quotations/new');
    await page.selectOption('#q-customer', { label: 'Sari Glow Online (CUS-005)' });
    await page.fill('#q-valid', manilaDate(14));
    const opt = await page.locator('#qp-1 option', { hasText: 'ACS-135' }).first().innerText();
    await page.selectOption('#qp-1', { label: opt });
    await page.fill('#qq-1', '60');
    await page.fill('#qu-1', '72.50');
    await expectText(page, '4,350.00');
    await shot(page, 'sales-new-quotation');
    await page.getByRole('button', { name: 'Save draft quotation' }).click();
    await page.waitForURL(/\/sales\/quotations\/[0-9a-f-]{36}\?saved=1/, { timeout: 30000 });
    facts.quoteNumber = (await page.locator('h1').innerText()).trim();
    assert(/^QT-\d{2}-\d{5}$/.test(facts.quoteNumber), 'quotation number ' + facts.quoteNumber);
    await page.getByRole('button', { name: 'Submit quotation' }).click();
    // A 3.3 % discount on the PHP 75.00 list price is within the 10 % rule: the quotation is sent.
    await settle(page, page.getByRole('button', { name: 'Convert to sales order' }), 'quotation submit');
    await page.fill('#cv-date', manilaDate(3));
    await page.fill('#cv-po', 'SGO-PO-2231');
    await shot(page, 'quotation-sent');
    await page.getByRole('button', { name: 'Convert to sales order' }).click();
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}(\?|$)/, { timeout: 30000 });
    facts.orderId = page.url().split('/').pop().split('?')[0];
    facts.orderNumber = (await page.locator('[data-testid=record-reference]').innerText()).trim(); // R3 record header
    await expectText(page, facts.quoteNumber);
    // Sari Glow's open orders plus this one exceed its credit limit: the order waits for finance.
    await page.getByRole('button', { name: 'Submit and confirm order' }).click();
    await page.waitForURL(/done=pending_approval/, { timeout: 30000 });
    await expectText(page, 'Needs approval');
    log('quotation', facts.quoteNumber, '-> order', facts.orderNumber, 'pending approval');
    await shot(page, 'sales-order-pending-approval');
    await context.close();
  }
  {
    const { context, page } = await asUser('finance@bryels-care.test');
    await page.goto(BASE + '/action-centre?tab=approvals');
    await page.getByText(`Order ${facts.orderNumber} waits for approval`).first().waitFor({ timeout: 20000 });
    await shot(page, 'finance-action-centre');
    await page.goto(BASE + '/sales/' + facts.orderId);
    await expectText(page, 'over credit limit');
    await page.fill('#approve-note', 'Customer paid the September invoice (fictional).');
    await page.getByRole('button', { name: 'Approve and confirm' }).click();
    // The approval form leaves the page with the new state (ADR-043): the history shows the transition.
    await settle(page, page.getByText('Approved and confirmed').first(), 'order approval');
    log('order', facts.orderNumber, 'approved by finance');
    await shot(page, 'sales-order-confirmed');
    await context.close();
  }

  // ---------------- j. Warehouse allocates (FEFO), picks; the site manager verifies; warehouse dispatches (W3E) ----------------
  {
    const page = wh.page;
    await page.goto(BASE + '/sales');
    await shot(page, 'sales-orders-list');
    // Work the queue in order: yesterday's Isla Spa order is allocated first (takes the older finished lot).
    await page.getByRole('link', { name: /SO-\d{2}-00002/ }).first().click();
    await page.waitForURL(/\/sales\/[0-9a-f-]{36}/);
    await expectText(page, 'Isla Spa Supplies');
    await page.getByRole('button', { name: /Reserve stock/ }).click();
    await page.waitForURL(/done=allocated/, { timeout: 30000 });

    await page.goto(BASE + '/sales/' + facts.orderId);
    await page.getByRole('button', { name: /Reserve stock/ }).click();
    await page.waitForURL(/done=allocated/, { timeout: 30000 });
    await expectText(page, facts.fgLot);
    await shot(page, 'order-allocated-fefo', { full: true });
    // Pick: the finished lot is loose (not boxed), so the lot label is scanned with the counted quantity.
    await page.getByRole('button', { name: 'Start pick list' }).click();
    await page.waitForURL(/\/sales\/picking\/[0-9a-f-]{36}/, { timeout: 30000 });
    // FEFO may split the order over the older lot and the new finished lot: scan every row of the list.
    await expectText(page, facts.fgLot);
    const rows = await page.getByTestId('pick-row').evaluateAll((els) => els.map((e) => ({ lot: e.dataset.lot, box: e.dataset.box, qty: e.dataset.qty })));
    for (const r of rows) {
      if (r.box) {
        await page.fill('#scan-input', 'BC:BOX:' + r.box);
      } else {
        await page.fill('#scan-qty', r.qty);
        await page.fill('#scan-input', 'BC:LOT:' + r.lot);
      }
      await page.press('#scan-input', 'Enter');
      await page.getByTestId('scan-result').getByText(new RegExp('Picked .*' + (r.box || r.lot))).waitFor({ timeout: 30000 });
    }
    await shot(page, 'pick-scanned');
    await page.getByRole('button', { name: 'Complete pick' }).click();
    await page.waitForURL(/\/sales\/shipments\/[0-9a-f-]{36}\?done=picked/, { timeout: 30000 });
    facts.shipmentId = page.url().split('/').pop().split('?')[0];
    log('picked', facts.orderNumber);
  }
  {
    // Pack verification by someone who did not pick (checker ≠ packer).
    const { context, page } = await asUser('manager.nfd@bryels-care.test');
    await page.goto(BASE + '/sales/packing/' + facts.shipmentId);
    const picked = await page.getByTestId('picked-row').evaluateAll((els) => els.map((e) => ({ lot: e.dataset.lot, box: e.dataset.box, qty: e.dataset.qty })));
    for (const r of picked) {
      if (r.box) {
        await page.fill('#scan-input', 'BC:BOX:' + r.box);
      } else {
        await page.fill('#scan-qty', r.qty);
        await page.fill('#scan-input', 'BC:LOT:' + r.lot);
      }
      await page.press('#scan-input', 'Enter');
      await page.getByTestId('scan-result').getByText(r.box ? new RegExp('Box ' + r.box + ' verified') : new RegExp('Verified .*' + r.lot)).waitFor({ timeout: 30000 });
    }
    await shot(page, 'pack-verified');
    await page.getByRole('button', { name: 'Complete packing' }).click();
    await page.waitForURL(/done=packed/, { timeout: 30000 });
    await context.close();
  }
  {
    const page = wh.page;
    await page.goto(BASE + '/sales/shipments/' + facts.shipmentId);
    page.once('dialog', (d) => d.accept());
    await page.fill('#driverName', 'Ramon Aquino');
    await page.fill('#vehiclePlate', 'NBC 1234');
    await page.getByRole('button', { name: 'Dispatch shipment' }).click();
    await page.waitForURL(/done=dispatched/, { timeout: 30000 });
    await expectText(page, 'Dispatched');
    await shot(page, 'order-shipped');
    const drHref = await page.locator('a[href^="/print/delivery-receipt/"]').first().getAttribute('href');
    await page.goto(BASE + drHref);
    await expectText(page, 'Sari Glow Online');
    await expectText(page, 'Ramon Aquino');
    await expectText(page, 'NBC 1234');
    await expectText(page, facts.fgLot);
    await shot(page, 'delivery-receipt');
    await page.pdf({ path: path.join(OUT, 'delivery-receipt.pdf'), printBackground: true, preferCSSPageSize: true });
    log('DR PDF saved');
    // The driver brings back the signed copy: the warehouse records the acknowledgment (W3E, US-4-13).
    await page.goto(BASE + '/sales/shipments/' + facts.shipmentId);
    await page.fill('#receivedByName', 'Liza Manalo');
    await page.fill('#receivedByPosition', 'Store supervisor');
    await page.selectOption('#kind', 'name_only');
    await page.fill('#remarks', 'All boxes received in good order.');
    await page.getByRole('button', { name: 'Save acknowledgment' }).click();
    await settle(page, page.getByText('Liza Manalo · Store supervisor').first(), 'DR acknowledgment', 30000);
    facts.drNumber = (await page.locator('a[href^="/print/delivery-receipt/"]').first().innerText().catch(() => '')).trim();
    await shot(page, 'dr-acknowledged');
    log('DR acknowledged for', facts.orderNumber);
    await wh.context.close();
  }

  // ---------------- k0. Sales logs a complaint on the shipped lot; opens a return into quarantine (W3F) ----------------
  {
    const { context, page } = await asUser('sales@bryels-care.test');
    await page.goto(BASE + '/quality/complaints/new');
    await page.selectOption('#customerId', { label: 'Sari Glow Online (CUS-005)' });
    await page.fill('#code', 'BC:LOT:' + facts.fgLot);
    await page.selectOption('#category', 'packaging');
    await page.fill('#description', 'Two bars arrived with torn wrappers.');
    await page.getByText('More details (you can skip this)').click();
    await page.fill('#qtyAffected', '2');
    await page.fill('#internalNotes', 'Check the packing line wrapper tension (fictional).');
    await page.getByRole('button', { name: 'Save the complaint' }).click();
    await page.waitForURL(/\/quality\/complaints\/[0-9a-f-]{36}/, { timeout: 30000 });
    facts.complaintNumber = (await page.getByTestId('record-number').first().innerText()).trim();
    assert(/^CMP-\d{2}-\d{4}$/.test(facts.complaintNumber), 'complaint number ' + facts.complaintNumber);
    await expectText(page, facts.fgLot);
    await shot(page, 'complaint-logged');
    log('complaint', facts.complaintNumber, 'on', facts.fgLot);

    await page.goto(BASE + '/sales/returns/new');
    const ship = await page.locator('#shipmentId option', { hasText: facts.orderNumber }).first().getAttribute('value');
    await page.selectOption('#shipmentId', ship);
    await page.selectOption('#reasonCode', { index: 4 });
    const reasonLabel = await page.locator('#reasonCode option:checked').innerText();
    if (/explain/i.test(reasonLabel)) await page.fill('#reasonNote', 'Torn wrappers (complaint ' + facts.complaintNumber + ')');
    await page.getByRole('button', { name: 'Open return' }).click();
    await page.waitForURL(/\/sales\/returns\/[0-9a-f-]{36}/, { timeout: 30000 });
    facts.returnId = page.url().split('/').pop().split('?')[0];
    facts.returnNumber = (await page.locator('h1').innerText()).trim();
    await page.fill('#code', 'BC:LOT:' + facts.fgLot);
    await page.fill('#qty', '2');
    await page.selectOption('#condition', 'damaged');
    await page.getByRole('button', { name: 'Add line' }).click();
    await settle(page, page.getByRole('button', { name: 'Submit for approval' }), 'return line');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await settle(page, page.getByText('Waiting for approval').first(), 'return submit');
    await shot(page, 'return-submitted');
    await context.close();
  }
  {
    // The site manager (not the person who opened it) approves and receives the goods into quarantine.
    const { context, page } = await asUser('manager.nfd@bryels-care.test');
    await page.goto(BASE + '/sales/returns/' + facts.returnId);
    await page.getByRole('button', { name: 'Approve return' }).click();
    await settle(page, page.getByRole('button', { name: 'Receive into quarantine' }), 'return approval');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Receive into quarantine' }).click();
    await settle(page, page.getByText('Received in quarantine').first(), 'return posting', 30000);
    facts.returnLot = (await page.locator('a[href^="/inventory/"]').filter({ hasText: /^L-/ }).last().innerText().catch(() => '')).trim();
    await shot(page, 'return-in-quarantine');
    log('return', facts.returnNumber, 'received into quarantine', facts.returnLot);
    await context.close();
  }

  // ---------------- k. QA traces the new finished lot ----------------
  {
    const page = qa.page;
    await page.goto(BASE + '/quality/trace');
    await page.goto(BASE + '/quality/trace?q=' + encodeURIComponent(facts.fgLot));
    await page.waitForURL(/q=/);
    const rev = page.locator('div', { has: page.getByText('Where it came from', { exact: true }) }).last();
    await expectText(page, facts.coconutLot);
    await expectText(page, 'Laguna Oleo Supply');
    await expectText(page, 'Sari Glow Online');
    void rev;
    await shot(page, 'trace-finished-lot', { full: true });
    // Recall view: from the supplier lot forward to the customer
    await page.goto(BASE + '/quality/trace?q=' + encodeURIComponent(facts.coconutLot));
    await expectText(page, facts.batchNumber);
    await expectText(page, 'Sari Glow Online');
    await shot(page, 'trace-coconut-forward', { full: true });
    // Recall explorer (W3F): from the complaint forward to every customer, shipment and box.
    await page.goto(BASE + '/quality/recall');
    await page.goto(BASE + '/quality/recall?code=' + encodeURIComponent(facts.complaintNumber));
    await page.waitForURL(/code=/, { timeout: 30000 });
    await expectText(page, 'Sari Glow Online');
    await expectText(page, facts.fgLot);
    await shot(page, 'recall-explorer', { full: true });
    // The returned goods wait for QA in the action centre.
    await page.goto(BASE + '/action-centre?tab=exceptions');
    await page.getByText(`Returned goods of ${facts.returnNumber} wait for a QA decision`).first().waitFor({ timeout: 20000 });
    await shot(page, 'qa-action-centre');
    await qa.context.close();
  }

  // ---------------- k2. Site manager exports the shipments report (W3B) ----------------
  {
    const { context, page } = await asUser('manager.nfd@bryels-care.test');
    await page.goto(BASE + '/reports/RPT-SAL-SHIPMENTS?period=today');
    await expectText(page, 'Shipments and delivery receipts');
    await expectText(page, facts.orderNumber);
    const href = await page.getByRole('link', { name: 'CSV' }).getAttribute('href');
    const res = await page.request.get(BASE + href);
    assert(res.ok(), 'report export HTTP ' + res.status());
    const csv = await res.text();
    assert(csv.includes(facts.orderNumber), 'exported CSV lists the order');
    assert(!/unit price|amount/i.test(csv.split('\n')[0] ?? ''), 'shipments report carries no money columns');
    await shot(page, 'report-shipments');
    log('report exported', csv.split('\n').length, 'lines');
    await context.close();
  }

  // ---------------- k3. System administrator dry-runs a customer import (W3C) ----------------
  {
    const { context, page } = await asUser('admin@bryels-care.test');
    await page.goto(BASE + '/admin/imports');
    await page.selectOption('#imp-kind', { label: 'Customers' });
    const csv = [
      'code,name,status,ship_to_line1,ship_to_city,ship_to_province,contact_name,phone,email,min_shelf_life_days,payment_terms_days,credit_limit_amount,currency,tax_identifier,legacy_number',
      'CUS-9201,Kalayaan Beauty Corner (fictional),active,8 Bonifacio St.,Calamba,Laguna,Nora Santos,+63 900 222 3333,orders@kalayaan.test,180,,,PHP,,C-201',
      'CUS-9202,Dollar Buyer (fictional),active,4 Luna St.,Calamba,,,,,,,,USD,,',
    ].join('\n');
    await page.setInputFiles('#imp-file', { name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: 'Upload and map columns' }).click();
    await page.waitForURL(/\/admin\/imports\/[0-9a-f-]{36}/, { timeout: 30000 });
    facts.importNumber = (await page.locator('h1').innerText()).trim();
    await page.getByRole('button', { name: 'Validate the file' }).click();
    await settle(page, page.getByText('Validated').first(), 'import validation (dry run)', 30000);
    await expectText(page, 'Currency USD is not supported');
    await shot(page, 'import-dry-run', { full: true });
    log('import', facts.importNumber, 'validated (dry run, nothing posted)');
    await context.close();
  }

  // ---------------- l. Owner sees the changes ----------------
  {
    const { context, page } = await asUser('owner@bryels-care.test');
    const ordersAfter = await kpiValue(page, 'Orders confirmed');
    const outputAfter = await outputKg(page);
    log('owner KPIs after: orders', ordersAfter, 'output kg', outputAfter);
    assert(ordersAfter === facts.ordersBefore + 1, `orders KPI ${facts.ordersBefore} -> ${ordersAfter}`);
    // 124 units × 135 g posted as output this week (KPI-OPS-01 numerator, shown to 0.1 kg).
    assert(Math.abs(outputAfter - facts.outputBefore - 16.74) < 0.15, `output KPI ${facts.outputBefore} kg -> ${outputAfter} kg`);
    await expectText(page, facts.batchNumber);
    await shot(page, 'owner-overview-after');
    // Wave 2 flows write many more events; look each document up by number (the audit filter).
    for (const [q, events] of [
      [facts.orderNumber, []],
      [facts.batchNumber, ['Disposition released']],
      [facts.receiptNumber, ['Goods receipt posted']],
      [facts.workOrderNumber, []],
    ]) {
      await page.goto(BASE + '/admin/audit?q=' + encodeURIComponent(q));
      await expectText(page, q);
      for (const t of events) await expectText(page, t);
    }
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
    await row.locator('summary', { hasText: /Weigh / }).click();
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
    // ADR-081: the quick-action rail is gone; the QA badge sits on the "Quality check" tab of Operations.
    await page.goto(BASE + '/operations');
    const qaLink = page.locator('header a[href="/quality"]').first();
    const qaLabel = (await qaLink.getAttribute('aria-label')) ?? (await qaLink.innerText()).trim();
    log('QA tab:', qaLabel);
    assert(/^Quality check(, \d+ open)?/.test(qaLabel), 'QA tab label ' + qaLabel);
    await context.close();
    const desk = await asUser('manager.nfd@bryels-care.test');
    // [url, destination, main tab or section menu that is highlighted]
    for (const [url, group, tab] of [['/inventory/counts', 'Inventory', 'Stock tasks'], ['/inventory/containers', 'Inventory', 'Stock views'], ['/labels', 'Inventory', 'Stock tasks'], ['/inventory/scan', 'Inventory', 'Scan'], ['/operations', 'Operations', 'Operations Center']]) {
      await desk.page.goto(BASE + url);
      await desk.page.locator('nav[aria-label="Modules"] a[aria-current="page"]', { hasText: group }).waitFor();
      await desk.page.locator('header a[aria-current="page"], header summary.bg-cta', { hasText: tab }).first().waitFor();
      assert(await noHScroll(desk.page), `${url} has no horizontal scroll at 1440 px`);
    }
    await shot(desk.page, 'shell-warehouse-tabs', { top: true });
    await desk.context.close();
    const phone = await asUser('warehouse.nfd@bryels-care.test', PHONE, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    for (const url of ['/inventory/move', '/inventory/counts', '/inventory/containers', '/labels', '/inventory/scan', '/inventory/receive', '/sales/picking', '/sales/shipments', '/sales/shipments/' + facts.shipmentId, '/sales/returns', '/sales/returns/' + facts.returnId, '/warehouse/packs', '/action-centre', '/reports', '/operations', '/inventory/wip']) {
      await phone.page.goto(BASE + url);
      await noErrorPage(phone.page);
      assert(await noHScroll(phone.page), `${url} has no horizontal scroll at 390 px`);
    }
    for (const [email, urls] of [
      ['sales@bryels-care.test', ['/sales/quotations', '/sales/board', '/sales/' + facts.orderId, '/sales/price-lists', '/quality/complaints', '/sales/customers']],
      ['qa.nfd@bryels-care.test', ['/quality/recall?code=' + encodeURIComponent(facts.complaintNumber), '/quality/complaints', '/analytics']],
      ['admin@bryels-care.test', ['/admin/imports', '/admin/notification-rules', '/admin/diagnostics']],
    ]) {
      const other = await asUser(email, PHONE, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      for (const url of urls) {
        await other.page.goto(BASE + url);
        await noErrorPage(other.page);
        assert(await noHScroll(other.page), `${url} has no horizontal scroll at 390 px (${email})`);
      }
      await other.context.close();
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
