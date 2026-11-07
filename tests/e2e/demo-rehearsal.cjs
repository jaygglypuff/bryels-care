/* Client-demo rehearsal on the SMALL (lite) demo (ADR-111, docs/demo-script.md), end to end in a browser.
 *
 * Run against a server (a production build is steadier than `next dev`) loaded with a fresh lite demo, with
 * FILE_STORAGE set (the proof-of-delivery signature is stored as a file):
 *   DATABASE_URL=… DATABASE_MIGRATION_URL=… DEMO_MODE=true pnpm -s tsx src/db/demo.ts reset
 *   BASE=http://localhost:3547 node tests/e2e/demo-rehearsal.cjs
 * Options: SHOTS_DIR (screenshots, default <tmp>/demo-rehearsal), CHROMIUM (browser path), HEADED=1,
 * STEP_TIMEOUT (ms per wait, default 120000 for a dev server's first compile), ONLY=d,e (single sections; each
 * finds its records on the screens), UNTIL=k (stop after a section).
 * Playwright is taken from the project, else from the global npm root (no NODE_PATH needed).
 *
 * The storyline (scenes of docs/demo-script.md, then the lotion order carried to the invoice):
 *   a. Owner Home: "What to do next" (scene 1).
 *   b. QA checks the lotion batch waiting for QA (scene 2).
 *   c. Operator: soap "Pour into moulds" done; the cure waits (scene 3).
 *   d. Warehouse puts the coconut oil away by scanning its lot label (scene 4).
 *   e. Operator: Get materials for the lotion order (scene 5), then the clean-area start check.
 *   f. Weigh (each lot confirmed by scanning its label payload BC:LOT:…; Jun confirms on his own session), the making
 *      steps with their readings, packaging with the box labels and the labels for each bottle printed in place.
 *   i. Finish: good pieces and the packaging count.
 *   j. QA: Check quality of the new batch, OK to use.
 *   k. The Isla Spa order is set aside (use first) and taken off the shelf by scanning the lot label + count.
 *   l. Second check by another person (Dino).  m. Send out.  n. Proof of delivery (signature on the phone).
 *   o. Finance sends the invoice for approval.  p. The owner approves it on To approve.  q. Finance saves it to the books.
 *   r. Scene 6: the Luntian soap taken off the shelf by scanning its two box labels.
 *   s. Scene 7: trace back (soap lot → supplier lots) and forward (lotion lot → Isla Spa).  t. Scene 8: owner Home.
 * Fails loudly on assertion errors, error pages, page errors and failed requests (HTTP >= 400).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const autoConfirm = require('./auto-confirm.cjs');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(root, 'playwright'));
  }
}
const { chromium } = loadPlaywright();

const BASE = (process.env.BASE || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'demo-rehearsal');
fs.mkdirSync(OUT, { recursive: true });
const PW = 'demo1234';
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
// A dev server compiles each screen on first use; a production build answers at once.
const T = Number(process.env.STEP_TIMEOUT || 120000);

const problems = [];
const facts = {};
let shotNo = 0;
let current = null; // the page of the running step, dumped on failure

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}
function log(...a) {
  console.log('[rehearsal]', ...a);
}

let browser;
async function asUser(email, viewport = DESK) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  context.setDefaultTimeout(T);
  context.setDefaultNavigationTimeout(Math.max(T, 300000));
  await context.addInitScript(autoConfirm);
  // The label and BMR pages open the print dialog by themselves; a rehearsal has no printer.
  await context.addInitScript(() => { window.print = () => {}; });
  const page = await context.newPage();
  const tag = email.split('@')[0];
  const watch = (p) => {
    p.on('pageerror', (e) => problems.push(`[${tag}] page error on ${p.url()}: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|^Failed to load resource|Download the React DevTools/i.test(m.text())) problems.push(`[${tag}] console error on ${p.url()}: ${m.text()}`);
    });
    p.on('requestfailed', (r) => {
      const f = r.failure()?.errorText ?? '';
      // Next.js cancels in-flight prefetches and RSC requests on navigation; those are not app failures.
      if (f.includes('ERR_ABORTED')) return;
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
  await page.waitForURL('**/dashboard');
  await ok(page);
  return { context, page, close: () => context.close() };
}
const who = (n) => `${n}@bryels-care.test`;

/** No error page and nothing reported by the listeners so far. */
async function ok(page) {
  current = page;
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const body = await page.locator('body').innerText();
  for (const bad of ['Application error', 'Internal Server Error', 'This page could not be found', 'Something went wrong', 'Unhandled Runtime Error']) {
    assert(!body.includes(bad), `error page on ${page.url()}: "${bad}"`);
  }
  if (problems.length) throw new Error('Problems detected:\n' + problems.join('\n'));
}

/** Waits for an address only (a client-side navigation may never fire "load" again). */
async function waitUrl(page, re) {
  current = page;
  await page.waitForURL(re, { waitUntil: 'commit' });
  await ok(page);
}

async function go(page, url) {
  current = page;
  await page.goto(BASE + url);
  await ok(page);
}

async function shot(page, name, opts = {}) {
  await ok(page);
  shotNo += 1;
  const file = path.join(OUT, `${String(shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: !!opts.full });
  return file;
}

async function expectText(page, text, timeout = T) {
  current = page;
  await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
}

/** A handheld (keyboard-wedge) scanner: a fast key burst ending in Enter with nothing focused (ScanOrPick listens). */
async function scanBurst(page, text) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.type(text, { delay: 4 });
  await page.keyboard.press('Enter');
}

/** The on-page confirmation (ADR-083): press its "Yes" unless auto-confirm already did. */
async function confirmOnPage(page, name) {
  const yes = page.getByRole('button', { name, exact: true });
  await yes.waitFor({ timeout: 5000 }).catch(() => {});
  await yes.click({ timeout: 3000 }).catch(() => {});
  await yes.waitFor({ state: 'detached' });
}

/** Types a number on the on-screen keypad (weighing, counts). */
async function keypad(scope, value) {
  for (const k of String(value)) await scope.getByRole('button', { name: `Key ${k}`, exact: true }).click();
}

/** The page as text plus its controls: printed when a step fails, so the failure can be read without a browser. */
async function describe(page) {
  try {
    const txt = await page.locator('main').first().innerText({ timeout: 5000 });
    const ctrls = await page.evaluate(() => {
      const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      const root = document.querySelector('main') || document.body;
      return [...root.querySelectorAll('button, a[href], input, select, textarea, summary')].filter(vis).map((e) => {
        const t = (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.name ? '[name=' + e.name + ']' : ''}${e.dataset.testid ? '[tid=' + e.dataset.testid + ']' : ''} "${t}"`;
      });
    });
    return `URL ${page.url()}\n${txt.replace(/\n\s*\n/g, '\n').slice(0, 4000)}\n--- controls\n${ctrls.join('\n')}`;
  } catch (e) {
    return `URL ${page.url()} (could not read the page: ${e.message})`;
  }
}

const SECTIONS = [];
const section = (name, fn) => SECTIONS.push({ name, fn });

// ---------------------------------------------------------------- a. Owner Home
section('a. owner Home says what to do next', async () => {
  const { page, close } = await asUser(who('owner'));
  await expectText(page, 'What to do next');
  await expectText(page, 'finished batch waits for the QA check');
  await shot(page, 'owner-home');
  await go(page, '/production/orders');
  for (const t of ['Acapulco Soap 135 g', 'Aloe Hand Lotion 250 mL']) await expectText(page, t);
  await shot(page, 'production-orders');
  await close();
});

// ---------------------------------------------------------------- b. QA checks the lotion
/** Check quality: every test result inside its limits, "I looked at the batch record", OK to use. */
async function passQualityCheck(page) {
  const tests = page.getByTestId('tests-form');
  if (await tests.count()) {
    for (const li of await tests.locator('li[data-testid^="test-"]').all()) {
      const conforms = li.locator('select[id$="-conforms"]');
      if (await conforms.count()) {
        await conforms.selectOption({ label: 'Yes, OK' });
        await li.locator('input[id$="-value"]').fill('Smooth white lotion, no lumps');
        continue;
      }
      const limits = (await li.innerText()).match(/OK:\s*([\d.]+)\s*[–-]\s*([\d.]+)/);
      const v = limits ? ((Number(limits[1]) + Number(limits[2])) / 2).toString() : '1';
      await li.locator('input[id$="-value"]').fill(v);
    }
    await page.getByTestId('save-results').click();
    await page.getByTestId('correct-result').first().waitFor(); // the saved results are listed, each correctable
  }
  await page.locator('input[name=recordReviewed]').check();
  await page.getByTestId('pass-ask').click();
  await page.getByRole('button', { name: 'Yes, OK to use' }).click();
  // The decision form is replaced by the decision and the next step (the customer order, when the batch was made for one).
  await page.getByText(/^OK to use by .*\d{2}:\d{2}\./).waitFor();
}

section('b. QA checks the lotion batch (scene 2)', async () => {
  const { page, close } = await asUser(who('qa.nfd'));
  await go(page, '/quality');
  const row = page.getByTestId('qa-batch-row').filter({ hasText: 'Aloe Hand Lotion 250 mL' }).first();
  await row.locator('a').first().click();
  await waitUrl(page, /\/quality\/check\//);
  await expectText(page, 'Aloe Hand Lotion 250 mL');
  await expectText(page, 'Tests (quality check)');
  await shot(page, 'qa-check-lotion');
  await passQualityCheck(page);
  await shot(page, 'qa-lotion-ok');
  await go(page, '/quality');
  assert((await page.getByTestId('qa-batch-row').count()) === 0, 'no batch waits for QA after the check');
  log('lotion batch passed QA');
  await close();
});

// ---------------------------------------------------------------- c. Operator: pour the soap
/** The operator Home card for a batch: its "Continue" / "Start" link. */
async function homeTask(page, text) {
  await go(page, '/dashboard');
  const card = page.getByTestId('floor-task').filter({ hasText: text }).first();
  await card.waitFor();
  return card;
}

section('c. operator pours the soap; the cure waits (scene 3)', async () => {
  const { page, close } = await asUser(who('operator.nfd'), PHONE);
  const card = await homeTask(page, 'Pour into moulds');
  await shot(page, 'operator-home-phone');
  await card.getByRole('link').first().click();
  await waitUrl(page, /\/step\/\d+\?batch=/);
  await expectText(page, 'Pour into moulds');
  await page.getByRole('button', { name: 'Step done' }).click();
  await expectText(page, 'Cure');
  await shot(page, 'soap-cure-waits');
  await close();
});

// ---------------------------------------------------------------- d. Warehouse puts the coconut oil away
section('d. warehouse puts the coconut oil away (scene 4)', async () => {
  const { page, close } = await asUser(who('warehouse.nfd'));
  await expectText(page, /Next: put away Coconut Oil lot L-\d{4}-\d{5}/);
  await page.getByRole('link', { name: 'Put it away' }).click();
  await waitUrl(page, /\/inventory\/receive\/put-away/);
  const row = page.getByTestId('pick-option').filter({ hasText: 'Coconut Oil' }).first();
  facts.coconutLot = (await row.innerText()).match(/L-\d{4}-\d{5}/)[0];
  // The handheld scanner reads the lot label (ADR-017 payload); the shelf is suggested, the warehouse only confirms.
  await scanBurst(page, `BC:LOT:${facts.coconutLot}`);
  const put = page.getByRole('button', { name: /^Put away to / });
  await put.waitFor();
  assert(/Oils rack|RM-01/.test(await put.innerText()), 'the suggested shelf is the oils rack: ' + (await put.innerText()));
  await shot(page, 'put-away-confirm');
  await put.click();
  await expectText(page, `Done: lot ${facts.coconutLot}`);
  await expectText(page, 'It can be used now.');
  log('coconut oil', facts.coconutLot, 'put away');
  // The glycerin of the same delivery still waits for QA: not on the put-away list.
  assert((await page.getByTestId('pick-option').filter({ hasText: 'Glycerin' }).count()) === 0, 'glycerin waiting for QA is not offered for put-away');
  await close();
});

// ---------------------------------------------------------------- e. Operator: Get materials for the lotion
section('e. operator gets the materials for the lotion order (scene 5)', async () => {
  const { page, close } = await asUser(who('operator.nfd'), PHONE);
  const card = await homeTask(page, 'Aloe Hand Lotion 250 mL');
  await card.getByRole('link').first().click();
  await waitUrl(page, /\/materials\?batch=/);
  const url = new URL(page.url());
  facts.lotionOrderId = url.pathname.split('/')[3];
  facts.lotionBatchId = url.searchParams.get('batch');
  await expectText(page, 'Get materials');
  const total = Number((await page.getByTestId('pick-progress').innerText()).match(/of (\d+) taken/)[1]);
  assert(total >= 5, 'the lotion pick list has its ingredients and packaging: ' + total);
  // The use-first lot of each line, from its shelf: one tap per line ("Taken"), each saved at once.
  for (let i = 1; i <= total; i++) {
    await page.locator('button[aria-pressed=false]', { hasText: 'Taken' }).first().click();
    if (i < total) await page.getByTestId('pick-progress').getByText(`${i} of ${total} taken`).waitFor();
  }
  await expectText(page, 'Every line is taken. Next: Start.');
  await shot(page, 'materials-taken-phone');
  await page.getByRole('link', { name: 'Start', exact: true }).click();
  await waitUrl(page, /\/step\/\d+\?batch=/);
  await expectText(page, 'Check the area is clean');
  log('materials taken for', facts.lotionOrderId);
  await close();
});

// ---------------------------------------------------------------- f.–h. The batch, screen by screen
const continueUrl = () => `/production/orders/${facts.lotionOrderId}/continue?batch=${facts.lotionBatchId}`;
const CHECKER = 'Jun Dela Cruz';

/** When a section runs on its own (ONLY=…): the lotion batch from the operator's Home card. */
async function findLotionBatch(page) {
  if (facts.lotionBatchId) return;
  const card = await homeTask(page, 'Aloe Hand Lotion 250 mL');
  const u = new URL(BASE + (await card.getByRole('link').first().getAttribute('href')));
  const fin = u.pathname.match(/^\/production\/([0-9a-f-]{36})\/finish/);
  if (fin) {
    // At Finish the card opens /production/<batch>/finish; the order is on the batch record's back link.
    facts.lotionBatchId = fin[1];
    await go(page, u.pathname);
    const back = await page.getByRole('link', { name: 'Back to the order' }).getAttribute('href');
    facts.lotionOrderId = back.split('/')[3];
    return;
  }
  facts.lotionOrderId = u.pathname.split('/')[3];
  facts.lotionBatchId = u.searchParams.get('batch');
}

/** The second person confirms on their OWN session (ADR-100): the same screen, "Yes, I checked it". */
async function checkerConfirms(chk, url, what) {
  await go(chk, url);
  const own = chk.getByRole('button', { name: /Yes, I checked it/ }).first();
  await own.waitFor();
  await own.click();
  await own.waitFor({ state: 'detached' });
  log('  checked by Jun on his own phone:', what);
}

/** After Step done: when the step waits for the second person, the checker opens the check on his own session. */
async function secondCheck(op, chk, url, what) {
  if (!(await op.getByText(/Second check needed|Waiting for the second check|waiting for the checker/).count())) return;
  const link = op.getByRole('link', { name: 'Open the check' });
  const target = (await link.count()) ? await link.first().getAttribute('href') : url;
  await checkerConfirms(chk, target, what);
}

/** Reads "OK 65 – 75 °C" style limits and returns the middle (or the one bound). */
function middle(text) {
  const m = text.replace(/,/g, '').match(/OK\s*([\d.]+)\s*[–-]\s*([\d.]+)/);
  if (m) return String(Math.round(((Number(m[1]) + Number(m[2])) / 2) * 10) / 10);
  const one = text.match(/([\d.]+)/);
  return one ? one[1] : '1';
}

/** Weigh: one card at a time; the lot is confirmed by scanning the label payload, the weight on the keypad. */
async function weighAll(op, chk) {
  const weighUrl = op.url().replace(BASE, '');
  for (let guard = 0; guard < 12; guard++) {
    await ok(op);
    const card = op.getByTestId('weigh-card').first();
    if (!(await card.count())) break;
    const name = ((await card.getAttribute('aria-label')) || '').replace(/^Weigh /, '');
    // Get materials told which lot to take; the weigh card proposes it ("from L-…: 17,919 g").
    const proposal = await card.getByTestId('weigh-proposal').innerText();
    const lot = proposal.match(/L-\d{4}-\d{5}/)[0];
    const target = (await card.locator('p.font-display').first().innerText()).replace(/,/g, '').match(/([\d.]+)\s*(kg|g)\b/);
    const grams = String(Math.round(Number(target[1]) * (target[2] === 'kg' ? 1000 : 1) * 10) / 10);
    await scanBurst(op, `BC:LOT:${lot}`);
    await card.getByText(`Label scanned: lot ${lot}`).waitFor();
    await card.getByRole('button', { name: 'Weight' }).click().catch(() => {});
    await keypad(card, grams);
    await card.getByText('OK', { exact: true }).first().waitFor();
    if (guard === 0) await shot(op, 'weigh-card-scanned-phone');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    // The weighing waits for the second person, who confirms on their own phone.
    await op.getByText(/Second check needed|Check .*'s weighing|waits for/).first().waitFor();
    await checkerConfirms(chk, weighUrl, `weighing of ${name} (${grams} g from ${lot})`);
    await go(op, weighUrl);
    (facts.weighed ??= []).push(`${name} ${grams} g ${lot}`);
  }
  // Everything weighed: the summary's Step done closes the weighing step.
  // (When the step was already closed, the summary shows "Next step" instead.)
  const stepDone = op.getByTestId('weigh-summary').getByRole('button', { name: 'Step done' });
  if (await stepDone.count()) await stepDone.click();
  await op.waitForLoadState('networkidle').catch(() => {});
  await op.waitForTimeout(500);
  await secondCheck(op, chk, weighUrl, 'the weighing step');
  log('  step done: Weigh');
}

/** One making step: equipment if asked, readings in the middle of their limits, Step done, the second check. */
async function doStep(op, chk) {
  const url = op.url().replace(BASE, '');
  const title = (await op.locator('h1').first().innerText()).trim();
  // Clean-area / before-packing checks: Yes on every row, then All OK.
  const allOk = op.getByRole('button', { name: 'All OK', exact: true });
  if (await allOk.count()) {
    await allOk.click();
  } else {
    const eq = op.getByTestId('step-equipment');
    if ((await eq.count()) && (await eq.locator('input[name=equipmentRef]:not([disabled])').count())) {
      await eq.locator('input[name=equipmentRef]:not([disabled])').first().check();
      await eq.getByRole('button', { name: 'Use this equipment' }).click();
      await eq.getByText(/^Using /).waitFor();
    }
    await boxLabels(op);
    for (const field of await op.locator('button[id^="f-"]').all()) {
      const hint = await field.locator('xpath=..').innerText();
      await field.click();
      await keypad(op, middle(hint.split('\n').find((l) => /^OK /.test(l)) || hint));
    }
    await op.locator('button[id^="done-"]').first().click();
  }
  await op.waitForLoadState('networkidle').catch(() => {});
  await op.waitForTimeout(500);
  await secondCheck(op, chk, url, title);
  log('  step done:', title);
}

/** After "Yes, they printed": the saved note, or (the page re-read on the server) "Printed by …" on the label page. */
async function printedOk(op) {
  await op.getByTestId('printed-ok').or(op.getByText(/^Printed by .*\d{2}:\d{2}\.$/)).first().waitFor();
}

/** Packaging step: the box plan, "Print N box labels", the print page and "Yes, they printed" (ADR-104 §2, ADR-108). */
async function boxLabels(op) {
  const box = op.getByTestId('box-labels');
  if (!(await box.count())) return;
  const back = op.url();
  const print = box.getByRole('button', { name: /^Print .*box label/ });
  if (await print.count()) {
    facts.boxSplit = (await box.getByTestId('box-split').innerText()).trim();
    await print.click();
    await box.getByTestId('open-box-labels').waitFor();
  }
  const open = box.getByTestId('open-box-labels');
  if ((await open.count()) && !/^See /.test((await open.innerText()).trim())) { // "See the box labels": printed before
    await open.click();
    await waitUrl(op, /\/print\/labels\//);
    await shot(op, 'box-labels-print');
    await op.getByRole('button', { name: /^Yes, (it|they) printed$/ }).click();
    await printedOk(op);
    await op.goto(back);
    await ok(op);
    log('  box labels printed:', facts.boxSplit);
  }
  // Labels on each bottle (the lotion has one label per piece): the batch's label job, printed the same way.
  const pieces = op.getByRole('button', { name: /^Print \d+ labels?$/ });
  if (await pieces.count()) {
    facts.pieceLabels = (await pieces.first().innerText()).trim();
    await pieces.first().click();
    await waitUrl(op, /\/print\/labels\//);
    await shot(op, 'piece-labels-print');
    await op.getByRole('button', { name: /^Yes, (it|they) printed$/ }).click();
    await printedOk(op);
    await op.goto(back);
    await ok(op);
    log('  labels for each bottle printed:', facts.pieceLabels);
  }
}

section('f. weigh by scanning lot labels (Jun checks on his own session), the steps, box and bottle labels', async () => {
  const op = await asUser(who('operator.nfd'), PHONE);
  const chk = await asUser(who('checker.nfd'), PHONE);
  await findLotionBatch(op.page);
  for (let guard = 0; guard < 20; guard++) {
    await go(op.page, continueUrl());
    const u = op.page.url();
    if (/\/finish/.test(u)) break;
    if (/\/weigh(\?|$)/.test(u)) await weighAll(op.page, chk.page);
    else if (/\/step\/\d+/.test(u)) await doStep(op.page, chk.page);
    else throw new Error('unexpected screen on Continue: ' + u);
  }
  assert(/\/finish/.test(op.page.url()), 'every step done: Continue opens Finish, got ' + op.page.url());
  if (!process.env.ONLY) assert((facts.weighed ?? []).length >= 4, 'every ingredient weighed: ' + JSON.stringify(facts.weighed));
  await op.close();
  await chk.close();
});

// ---------------------------------------------------------------- i. Finish
section('i. finish: good pieces and the packaging count', async () => {
  const { page, close } = await asUser(who('operator.nfd'), PHONE);
  await findLotionBatch(page);
  await go(page, continueUrl());
  await waitUrl(page, /\/finish/);
  const checker = page.locator('#checkerId');
  if (await checker.count()) await checker.selectOption({ label: CHECKER });
  const pw = page.locator('#checkerPassword');
  if (await pw.count()) await pw.fill(PW);
  await shot(page, 'finish-phone', { full: true });
  await page.getByTestId('finish-batch').click();
  const yes = page.getByRole('button', { name: 'Yes, finish' });
  await yes.click({ timeout: 5000 }).catch(() => {}); // auto-confirm may have pressed it already
  await waitUrl(page, /\/production\/orders\/[0-9a-f-]{36}\?finished=B-/); // back on the order page, the batch is with QA
  await shot(page, 'finished');
  log('lotion batch finished');
  await close();
});

// ---------------------------------------------------------------- j. QA checks the new lotion batch
section('j. QA: Check quality of the new batch, OK to use', async () => {
  const { page, close } = await asUser(who('qa.nfd'));
  await go(page, '/quality');
  const row = page.getByTestId('qa-batch-row').filter({ hasText: 'Aloe Hand Lotion 250 mL' }).first();
  facts.lotionBatchNumber = (await row.innerText()).match(/B-\d{2}-\d{4}/)[0];
  await row.locator('a').first().click();
  await waitUrl(page, /\/quality\/check\//);
  await passQualityCheck(page);
  facts.lotionLot = (await page.locator('main').innerText()).match(/Lot\s+(L-\d{4}-\d{5})/)[1];
  // The order it was made for is named as the next step.
  await expectText(page, /Isla Spa Supplies\) can now be set aside/);
  facts.islaOrderHref = await page.getByRole('link', { name: /^Open SO-/ }).getAttribute('href');
  await shot(page, 'qa-new-batch-ok');
  log('batch', facts.lotionBatchNumber, 'lot', facts.lotionLot, 'OK to use');
  await close();
});

/**
 * Get from shelf: every line of the list by scanning its label. A box: its box label (BC:BOX:…). Loose pieces:
 * the lot label (BC:LOT:…), then "How many loose pieces of this lot?" (ADR-120: the count is asked after the label).
 */
async function pickEverything(page) {
  for (let guard = 0; guard < 12; guard++) {
    await ok(page);
    const next = page.getByText(/^Next: go to /).first();
    if (!(await next.count())) break;
    const opt = (await page.getByTestId('pick-option').first().innerText()).replace(/\s+/g, ' ');
    const box = opt.match(/\bBX-\d+/);
    const lot = opt.match(/lot (L-\d{4}-\d{5})/);
    const loose = opt.match(/([\d,]+) pcs loose/);
    if (box) {
      await scanBurst(page, `BC:BOX:${box[0]}`);
      await page.getByText(new RegExp(`Scans so far \\(${guard + 1}\\)`)).waitFor().catch(() => {});
      log('  scanned box', box[0]);
    } else if (lot && loose) {
      await scanBurst(page, `BC:LOT:${lot[1]}`);
      const qty = page.locator('#scan-qty');
      await qty.waitFor();
      await qty.fill(loose[1].replace(/,/g, ''));
      await page.getByTestId('loose-qty-send').click();
      await qty.waitFor({ state: 'detached' });
      (facts.pickedLots ??= []).push(lot[1]);
      log('  scanned lot', lot[1], 'and counted', loose[1], 'loose pieces');
    } else throw new Error('cannot read the pick line: ' + opt);
    await page.waitForLoadState('networkidle').catch(() => {});
  }
}

// ---------------------------------------------------------------- k. Set aside and get from the shelf
/** The customer order page of a customer (from the Customer orders list). */
async function openOrder(page, customer) {
  await go(page, '/sales');
  await page.locator('main a[href^="/sales/"]').filter({ hasText: customer }).first().click();
  await waitUrl(page, /\/sales\/[0-9a-f-]{36}$/);
}

section('k. the Isla Spa order is set aside (use first); the warehouse gets it from the shelf by scanning labels', async () => {
  const { page, close } = await asUser(who('warehouse.nfd'));
  if (facts.islaOrderHref) await go(page, facts.islaOrderHref);
  else await openOrder(page, 'Isla Spa Supplies');
  facts.islaOrderHref = page.url().replace(BASE, '');
  const setAside = page.getByRole('button', { name: 'Set aside the stock' });
  if (await setAside.count()) {
    await expectText(page, 'Next: set aside the stock for this order');
    await setAside.click();
    await expectText(page, 'set aside 48 of 48');
    await shot(page, 'isla-set-aside');
  }
  const start = page.getByRole('button', { name: 'Get from shelf' });
  if (await start.count()) await start.first().click();
  else await page.locator('main a[href^="/sales/picking/"]').first().click();
  await waitUrl(page, /\/sales\/picking\/[0-9a-f-]{36}/);
  facts.islaPickUrl = page.url().replace(BASE, '');
  facts.islaLot = ((await page.getByTestId('pick-option').first().innerText()).match(/L-\d{4}-\d{5}/) || [])[0];
  await pickEverything(page);
  await expectText(page, 'Everything is scanned.');
  await shot(page, 'isla-picked');
  await page.getByRole('button', { name: 'Finish getting from shelf' }).click();
  await waitUrl(page, /\/sales\/shipments\/[0-9a-f-]{36}\?done=picked/);
  await expectText(page, 'Next: second check of the box, by someone who did not take the items off the shelf.');
  facts.islaShipmentUrl = page.url().replace(BASE, '').split('?')[0];
  facts.islaShipment = (await page.locator('main').innerText()).match(/SH-\d{2}-\d{5}/)[0];
  log('delivery', facts.islaShipment, 'waits for the second check');
  await close();
});

/** The Isla Spa delivery (from section k, or from the Deliveries list when a section runs on its own). */
async function openIslaDelivery(page) {
  if (!facts.islaShipmentUrl) {
    await go(page, '/sales/shipments');
    await page.locator('main a[href^="/sales/shipments/"]').filter({ hasText: 'Isla Spa Supplies' }).first().click();
    await waitUrl(page, /\/sales\/shipments\/[0-9a-f-]{36}/);
    facts.islaShipmentUrl = page.url().replace(BASE, '').split('?')[0];
  }
  await go(page, facts.islaShipmentUrl);
}

// ---------------------------------------------------------------- l. Second check, send out, proof of delivery
section('l. a second person (Dino, not the picker) checks the delivery', async () => {
  const { page, close } = await asUser(who('manager.nfd'));
  await openIslaDelivery(page);
  await page.getByRole('link', { name: 'Check the box' }).click();
  await waitUrl(page, /\/sales\/packing\/[0-9a-f-]{36}/);
  await expectText(page, 'taken by Lito Pascual');
  // Each box (or the loose pieces of a lot) is scanned again by the second person.
  for (let guard = 0; guard < 12; guard++) {
    await ok(page);
    if (!(await page.getByText(/^Next: scan or type each box label/).count())) break;
    const nextBox = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    const loose = nextBox.match(/NEXT TO CHECK Loose pieces, lot (L-\d{4}-\d{5}).*? ([\d,]+) pieces to check/i);
    const box = nextBox.match(/NEXT TO CHECK.*?\b(BX-\d+)/i);
    if (loose) {
      await scanBurst(page, `BC:LOT:${loose[1]}`);
      const qty = page.locator('#scan-qty');
      await qty.waitFor();
      await qty.fill(loose[2].replace(/,/g, ''));
      await page.getByTestId('loose-qty-send').click();
      await qty.waitFor({ state: 'detached' });
      log('  second check: lot', loose[1], loose[2], 'pieces');
    } else if (box) {
      await scanBurst(page, `BC:BOX:${box[1]}`);
      await page.getByText(new RegExp(`${box[1]}.*(checked|OK)`)).first().waitFor().catch(() => {});
      log('  second check: box', box[1]);
    } else throw new Error('cannot read the next box to check');
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  await shot(page, 'second-check-done');
  await page.getByRole('button', { name: 'Finish the check' }).first().click();
  await waitUrl(page, /\/sales\/shipments\/[0-9a-f-]{36}\?done=packed/);
  await expectText(page, 'Next: send it out.');
  log('second check done by Dino (not the picker)');
  await close();
});

// ---------------------------------------------------------------- m. Send out, proof of delivery
section('m. the warehouse sends it out', async () => {
  const { page, close } = await asUser(who('warehouse.nfd'));
  await openIslaDelivery(page);
  await page.fill('#driverName', 'Ramon Cruz');
  await page.fill('#vehiclePlate', 'NAB 1234');
  await page.getByRole('button', { name: 'Send out now' }).click();
  await confirmOnPage(page, 'Yes, continue');
  await waitUrl(page, /\?done=dispatched/);
  facts.islaDr = (await page.locator('main').innerText()).match(/DR-\d{2}-\d{5}/)[0];
  await expectText(page, 'Next: when the driver is back with the signed delivery receipt, save the proof of delivery.');
  log('sent out with delivery receipt', facts.islaDr);
  await close();
});

section('n. proof of delivery: the customer signs on the phone', async () => {
  const { page, close } = await asUser(who('warehouse.nfd'), PHONE);
  await openIslaDelivery(page);
  await page.fill('#receivedByName', 'Liza Ramos');
  // A finger signature on the canvas.
  const pad = page.locator('main canvas').first();
  await pad.scrollIntoViewIfNeeded();
  const b = await pad.boundingBox();
  await page.mouse.move(b.x + 20, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 20 + i * ((b.width - 40) / 12), b.y + b.height / 2 + (i % 2 ? -15 : 15));
  await page.mouse.up();
  await shot(page, 'proof-of-delivery-phone', { full: true });
  await page.getByRole('button', { name: 'Save proof of delivery' }).click();
  // The invoice draft was made at dispatch (ADR-124: the next step follows the invoice and names who sends it).
  await expectText(page, 'Delivered. Next: finance bills it');
  await expectText(page, /Rosa \(finance\)/);
  log('proof of delivery saved (Liza Ramos)');
  await close();
});

// ---------------------------------------------------------------- o. Invoice
section('o. finance makes and sends the invoice from the delivery', async () => {
  const { page, close } = await asUser(who('finance'));
  await openIslaDelivery(page);
  await expectText(page, 'Delivered. Next: finance bills it');
  await page.getByRole('link', { name: /^Open (the )?invoice/ }).click();
  await waitUrl(page, /\/finance\/invoices\/[0-9a-f-]{36}/);
  facts.invoiceUrl = page.url().replace(BASE, '');
  await expectText(page, 'Isla Spa Supplies');
  await expectText(page, '48 pcs × ₱185.00');
  await shot(page, 'invoice-draft');
  const send = page.getByRole('button', { name: 'Send for approval' });
  if (await send.count()) {
    await send.click();
    await expectText(page, 'This invoice waits for approval.');
  }
  // The small demo has one finance person (Rosa, who sent it), so the owner approves (owner override): the screen
  // must name her, not "Nobody can do it yet".
  await expectText(page, /Next: .*Ana \(owner\)/);
  // ADR-124: the delivery now follows the invoice: no more "finance bills it" / "Open the invoice draft".
  await openIslaDelivery(page);
  await expectText(page, 'Delivered. The invoice is sent for approval.');
  await expectText(page, /Waiting for Ana \(owner\) to approve the invoice/);
  await shot(page, 'delivery-invoice-sent');
  await close();
});

section('p. the owner approves the invoice on To approve (side panel)', async () => {
  const { page, close } = await asUser(who('owner'));
  await go(page, '/approvals');
  await page.locator('li', { hasText: 'Invoice for Isla Spa Supplies' }).first().waitFor();
  const panel = page.getByTestId('approval-detail');
  await panel.getByTestId('approve-button').click();
  await panel.getByRole('button', { name: 'Yes, approve' }).click();
  await page.getByText('Nothing waits for your decision').waitFor(); // the decided item leaves the list
  await shot(page, 'owner-approved-invoice');
  log('invoice approved by the owner');
  await close();
});

section('q. finance saves the invoice to the books', async () => {
  const { page, close } = await asUser(who('finance'));
  if (!facts.invoiceUrl) {
    await go(page, '/finance/invoices');
    await page.locator('main a[href^="/finance/invoices/"]').filter({ hasText: 'Isla Spa Supplies' }).first().click();
    await waitUrl(page, /\/finance\/invoices\/[0-9a-f-]{36}/);
    facts.invoiceUrl = page.url().replace(BASE, '');
  }
  await go(page, facts.invoiceUrl);
  await expectText(page, 'Next: save it to the books.');
  await page.getByRole('button', { name: 'Save to the books' }).click();
  // Money is saved for good: the person types their password (step-up), then saves.
  const pw = page.locator('#invoice-issue-pw');
  await pw.waitFor({ timeout: 5000 }).catch(() => {});
  if (await pw.count()) {
    await pw.fill(PW);
    await page.getByRole('button', { name: 'Save to the books' }).last().click();
  }
  await page.getByText(/INV-\d{4}-\d{6}/).first().waitFor();
  facts.invoice = (await page.locator('main').innerText()).match(/INV-\d{4}-\d{6}/)[0];
  await shot(page, 'invoice-posted');
  log('invoice', facts.invoice, 'saved to the books');
  await close();
});

// ---------------------------------------------------------------- r. Scene 6: the Luntian soap, two boxes
section('r. the warehouse gets the Luntian soap from the shelf by scanning its two box labels (scene 6)', async () => {
  const { page, close } = await asUser(who('warehouse.nfd'), PHONE);
  await openOrder(page, 'Luntian Wellness Stores');
  const start = page.getByRole('button', { name: 'Get from shelf' });
  if (await start.count()) await start.first().click();
  else await page.locator('main a[href^="/sales/picking/"]').first().click();
  await waitUrl(page, /\/sales\/picking\/[0-9a-f-]{36}/);
  const first = (await page.getByTestId('pick-option').first().innerText()).replace(/\s+/g, ' ');
  facts.soapLot = (first.match(/L-\d{4}-\d{5}/) || [])[0];
  await shot(page, 'luntian-pick-phone');
  await pickEverything(page);
  await expectText(page, 'Everything is scanned.');
  await page.getByRole('button', { name: 'Finish getting from shelf' }).click();
  await waitUrl(page, /\/sales\/shipments\/[0-9a-f-]{36}\?done=picked/);
  log('Luntian soap taken off the shelf, lot', facts.soapLot);
  await close();
});

// ---------------------------------------------------------------- s. Scene 7: where did it come from?
section('s. QA traces the soap lot back to its supplier lots and forward to the customer (scene 7)', async () => {
  const { page, close } = await asUser(who('qa.nfd'));
  assert(facts.soapLot && facts.islaLot, 'the soap lot (scene 6) and the lotion lot sent to Isla Spa (section k)');
  // Back: the soap lot to its batch and supplier lots. It is taken off the shelf but not sent yet: no customer.
  await go(page, '/quality/trace?q=' + encodeURIComponent(facts.soapLot));
  for (const t of ['Where it came from', 'Coconut Oil', 'Palm Oil', 'Laguna Oleo Supply', 'No customer has received this']) await expectText(page, t);
  await shot(page, 'trace-soap-lot', { full: true });
  // Forward: the lotion lot sent out today names the customer, the order and the delivery receipt.
  await go(page, '/quality/trace?q=' + encodeURIComponent(facts.islaLot));
  await expectText(page, 'Customers who got it');
  await expectText(page, '48 pcs of Aloe Hand Lotion 250 mL');
  await expectText(page, 'Isla Spa Supplies');
  await shot(page, 'trace-lotion-to-customer', { full: true });
  await close();
});

// ---------------------------------------------------------------- t. Scene 8: the owner sees what happened
section('t. the owner sees what happened (scene 8)', async () => {
  const { page, close } = await asUser(who('owner'));
  await expectText(page, 'What to do next');
  assert(!(await page.getByText('1 finished batch waits for the QA check').count()), 'no batch waits for QA any more');
  await go(page, '/operations/flow');
  await shot(page, 'how-work-flows', { full: true });
  await close();
});


// ---------------------------------------------------------------- runner
// UNTIL=<letter> stops after that section (for working on the script); the full run needs a fresh lite demo.
(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), headless: !process.env.HEADED, args: ['--no-sandbox'] });
  const started = Date.now();
  // ONLY=d,e runs only those sections (each section reads what it needs from the screens, not from earlier ones).
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const s of SECTIONS) {
    if (only && !only.includes(s.name.split('.')[0])) continue;
    const t0 = Date.now();
    log('>', s.name);
    try {
      await s.fn();
    } catch (e) {
      console.error(`\n[rehearsal] FAILED in "${s.name}": ${e.message}`);
      if (current) {
        console.error(await describe(current));
        await current.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {});
        console.error(`[rehearsal] screenshot: ${path.join(OUT, 'failure.png')}`);
      }
      await browser.close();
      process.exit(1);
    }
    log('ok', s.name, `(${Math.round((Date.now() - t0) / 1000)} s)`);
    if (process.env.UNTIL && s.name.startsWith(process.env.UNTIL + '.')) break;
  }
  log(`all done in ${Math.round((Date.now() - started) / 1000)} s; facts`, JSON.stringify(facts));
  log('screenshots in', OUT);
  await browser.close();
})();
