/* Client-demo rehearsal on the SMALL (lite) demo (ADR-111, docs/demo-script.md), end to end in a browser.
 *
 * Run against a dev server or a production build loaded with a fresh lite demo:
 *   DATABASE_URL=… DATABASE_MIGRATION_URL=… DEMO_MODE=true pnpm -s tsx src/db/demo.ts reset
 *   BASE=http://localhost:3547 node tests/e2e/demo-rehearsal.cjs
 * Options: SHOTS_DIR (screenshots, default <tmp>/demo-rehearsal), CHROMIUM (browser path), HEADED=1.
 * Playwright is taken from the project, else from the global npm root (no NODE_PATH needed).
 *
 * The storyline (scenes of docs/demo-script.md, then the lotion order carried to the invoice):
 *   a. Owner Home: "What to do next".
 *   b. QA checks the lotion batch waiting for QA (scene 2).
 *   c. Operator: soap "Pour into moulds" done; the cure waits (scene 3).
 *   d. Warehouse puts the coconut oil away (scene 4).
 *   e. Operator: Get materials for the lotion order (scene 5), then the clean-area start check.
 *   f. Weigh: each lot confirmed by scanning its label payload (BC:LOT:…), the checker confirms on their own session.
 *   g. The making steps with their readings.
 *   h. Packaging: box plan and box labels printed in place, then the last steps.
 *   i. Finish: good pieces and the packaging count.
 *   j. QA: Check quality, OK to use.
 *   k. Sales/warehouse: set aside the Isla Spa order; get it from the shelf by scanning the box labels.
 *   l. Second check of the boxes (another person), send out, proof of delivery.
 *   m. Finance: the invoice from the delivery.
 *   n. Scene 6 (Luntian soap from the shelf), scene 7 (trace), scene 8 (owner Home again).
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
  await page.waitForURL(/\/quality\/check\//);
  await expectText(page, 'Check quality: Aloe Hand Lotion 250 mL');
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
  await page.waitForURL(/\/step\/\d+\?batch=/);
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
  await page.waitForURL(/\/inventory\/receive\/put-away/);
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
  await page.waitForURL(/\/materials\?batch=/);
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
  await page.waitForURL(/\/step\/\d+\?batch=/);
  await ok(page);
  console.log(await describe(page));
  await close();
});

// @@NEXT@@

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
