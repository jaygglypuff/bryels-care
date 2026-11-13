/* Type with a keyboard (ADR-135, owner 2026-11-13): the Weigh field takes a physical keyboard or a scale that "types"
 * the number and presses Enter; the big keypad stays the default on touch phones.
 *
 * Demo profile: FULL (batch B-26-0004 is at its weighing step for operator.nfd). Run against a production build on a
 * fresh full demo (DEMO_PROFILE=full pnpm db:demo reset; pnpm build && pnpm start):
 *   BASE_URL=http://localhost:3612 DATABASE_URL=… NODE_PATH=$(npm root -g) node tests/e2e/keyboard-entry.cjs
 * Checks:
 *   1. 1366 × 768, mouse (Automatic = typing): no keypad; after the lot label is scanned the cursor is in the weight;
 *      typing "12.5" fills it (letters are dropped, Escape clears); Enter with a weight outside the range saves
 *      nothing; the target typed + Enter saves ("Saved: …").
 *   2. 390 × 844, touch: the big keypad shows and the field never opens the phone keyboard (inputmode none);
 *      "Use my keyboard" hides the keypad (inputmode decimal), is remembered after a reload, and "Use the big keypad"
 *      brings it back.
 * Exits 1 on the first failure.
 */
const path = require('path');
const { chromium } = require('playwright');
const postgres = require(path.join(__dirname, '../../node_modules/postgres'));

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/bryels', { max: 2, onnotice: () => {} });
const PW = 'demo1234';
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

async function signIn(page, email) {
  await page.goto(BASE + '/sign-in');
  await page.fill('#email', email);
  await page.fill('#password', PW);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
}

/** A handheld scanner: a fast key burst ending in Enter with nothing focused (ScanOrPick). */
async function scanBurst(page, text) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.type(text, { delay: 4 });
  await page.keyboard.press('Enter');
}

(async () => {
  const [wo] = await sql`select b.work_order_id as id from batches b where b.batch_number = 'B-26-0004'`;
  assert(wo && wo.id, 'batch B-26-0004 not found (load the FULL demo)');
  const weighUrl = `${BASE}/production/orders/${wo.id}/weigh`;
  const browser = await chromium.launch();
  let failed = false;
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('ok  ', name);
    } catch (e) {
      failed = true;
      console.log('FAIL', name, '—', e.message.split('\n')[0]);
    }
  };

  // ---------------------------------------------------------------- 1. desktop keyboard
  const desk = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  const d = await desk.newPage();
  const errors = [];
  d.on('pageerror', (e) => errors.push(e.message));
  await signIn(d, 'operator.nfd@bryels-care.test');
  await d.goto(weighUrl);
  const card = d.getByTestId('weigh-card').first();
  const field = card.getByTestId('keypad-field');

  await step('1366 px: typing mode, no keypad on screen', async () => {
    await card.waitFor({ timeout: 30000 });
    // After hydration the field follows the device (server render = keypad).
    await card.locator('[data-testid=keypad-field][data-mode=keyboard]').waitFor({ timeout: 15000 });
    assert((await field.getAttribute('inputmode')) === 'decimal', 'inputmode ' + (await field.getAttribute('inputmode')));
    assert((await card.getByTestId('keypad').count()) === 0, 'keypad is shown');
    await card.getByRole('button', { name: 'Use the big keypad' }).waitFor();
  });

  let target = null;
  await step('1366 px: scan the lot, then the cursor is in the weight; "12.5" fills it', async () => {
    const lot = (await card.getByTestId('weigh-lot').innerText()).match(/Full number (\S+)/)[1];
    target = (await card.getByTestId('weigh-target').innerText()).replace(/,/g, '').match(/([\d.]+)\s*(kg|g)\b/)[1];
    await scanBurst(d, `BC:LOT:${lot}`);
    await card.getByTestId('lot-confirmed').waitFor();
    await d.waitForFunction(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'keypad-field', null, { timeout: 5000 });
    await d.keyboard.type('12.5');
    assert((await field.inputValue()) === '12.5', 'field shows ' + (await field.inputValue()));
    await d.keyboard.type('x');
    assert((await field.inputValue()) === '12.5', 'a letter was accepted: ' + (await field.inputValue()));
    await d.keyboard.press('Escape');
    assert((await field.inputValue()) === '', 'Escape did not clear: ' + (await field.inputValue()));
  });

  await step('1366 px: Enter with a weight outside the range saves nothing', async () => {
    const tooMuch = String(Number(target) * 3 + 1);
    await d.keyboard.type(tooMuch);
    await d.keyboard.press('Enter');
    await d.waitForTimeout(800);
    assert((await d.getByTestId('weigh-saved').count()) === 0, 'saved a weight outside the range');
    await card.getByText(/Too much by/).waitFor();
    await d.keyboard.press('Escape');
  });

  await step('1366 px: the target typed + Enter saves (the ✓ action)', async () => {
    await field.focus();
    await d.keyboard.type(target);
    assert((await field.inputValue()) === target, 'field shows ' + (await field.inputValue()));
    await card.getByText('OK', { exact: true }).first().waitFor();
    await d.keyboard.press('Enter');
    await d.getByTestId('weigh-saved').waitFor({ timeout: 15000 });
    assert(!errors.length, 'page errors: ' + errors.join('; '));
  });
  await desk.close();

  // ---------------------------------------------------------------- 2. phone, touch
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  const p = await phone.newPage();
  await signIn(p, 'operator.nfd@bryels-care.test');
  await p.goto(weighUrl);
  const pcard = p.getByTestId('weigh-card').first();
  const pfield = pcard.getByTestId('keypad-field');

  await step('390 px touch: the big keypad shows; the field never opens the phone keyboard', async () => {
    await pcard.waitFor({ timeout: 30000 });
    await pcard.getByTestId('keypad').waitFor();
    assert((await pfield.getAttribute('inputmode')) === 'none', 'inputmode ' + (await pfield.getAttribute('inputmode')));
    assert((await pfield.getAttribute('readonly')) !== null, 'field is not read-only in keypad mode');
    await pcard.getByRole('button', { name: 'Key 1', exact: true }).tap();
    await pcard.getByRole('button', { name: 'Key 2', exact: true }).tap();
    assert((await pfield.inputValue()) === '12', 'keypad typed ' + (await pfield.inputValue()));
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert(!sideways, 'the page scrolls sideways at 390 px');
  });

  await step('390 px touch: "Use my keyboard" hides the keypad and is remembered; "Use the big keypad" brings it back', async () => {
    await pcard.getByRole('button', { name: 'Use my keyboard' }).tap();
    await pcard.getByTestId('keypad').waitFor({ state: 'detached' });
    assert((await pfield.getAttribute('inputmode')) === 'decimal', 'inputmode ' + (await pfield.getAttribute('inputmode')));
    await p.reload();
    await pcard.waitFor();
    await pcard.getByTestId('keypad').waitFor({ state: 'detached', timeout: 15000 }); // remembered on this device
    await pcard.getByRole('button', { name: 'Use the big keypad' }).tap();
    await pcard.getByTestId('keypad').waitFor();
  });
  await phone.close();

  await browser.close();
  await sql.end();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  process.exit(1);
});
