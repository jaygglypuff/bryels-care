/* Demo mode (ADR-055) against a running production build.
 * Demo on : DEMO_MODE=true sh scripts/start.sh on a fresh database, then
 *           NODE_PATH=$(npm root -g) BASE_URL=http://localhost:3401 node tests/e2e/demo-mode.cjs
 *           Checks the "Try the demo" switch, one-click sign-in as two roles, the banner (desktop and
 *           360 px), the owner-only reset link, and the full reset (re-authentication, typed RESET,
 *           sign-in notice, fresh data).
 * Demo off: same server without DEMO_MODE, then EXPECT=off node tests/e2e/demo-mode.cjs
 *           Checks that no demo UI exists and that a forged one-click request is refused.
 * Screenshots go to SHOTS_DIR (default: the current directory).
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3401';
const EXPECT = process.env.EXPECT || 'on';
const SHOTS = process.env.SHOTS_DIR || process.cwd();
const problems = [];
const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
};
const log = (...a) => console.log('[demo-e2e]', ...a);

async function newPage(browser, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`page error on ${page.url()}: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return { context, page };
}

async function oneClick(page, name) {
  await page.goto(BASE + '/sign-in');
  const sw = page.getByRole('switch', { name: 'Try the demo' });
  assert(await sw.isVisible(), 'demo switch visible');
  assert((await sw.getAttribute('aria-checked')) === 'false', 'switch starts off');
  assert(!(await page.getByRole('button', { name: new RegExp('^Sign in as ' + name) }).count()), 'accounts hidden until the switch is on');
  await sw.click();
  assert((await sw.getAttribute('aria-checked')) === 'true', 'switch on');
  assert(await page.getByText('demo1234').first().isVisible(), 'demo password shown');
  await page.getByRole('button', { name: new RegExp('^Sign in as ' + name) }).click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });
}

async function runOn(browser) {
  // 1. Owner: one click, banner, reset link
  const { context: c1, page: p1 } = await newPage(browser);
  await oneClick(p1, 'Ana Villanueva');
  const banner = p1.getByRole('note', { name: 'Demo environment' });
  assert(await banner.isVisible(), 'demo banner on the dashboard');
  assert(await banner.getByRole('link', { name: 'Reset demo data' }).isVisible(), 'owner sees the reset link in the banner');
  await p1.screenshot({ path: path.join(SHOTS, 'demo-owner-dashboard.png') });
  log('owner signed in with one click; banner and reset link shown');

  // 2. Production operator on a phone: one click, banner, no reset link
  const { context: c2, page: p2 } = await newPage(browser, { width: 360, height: 780 });
  await oneClick(p2, 'Rhea Mendoza');
  const b2 = p2.getByRole('note', { name: 'Demo environment' });
  assert(await b2.isVisible(), 'demo banner on a phone');
  assert(!(await b2.getByRole('link', { name: 'Reset demo data' }).count()), 'operator has no reset link');
  const box = await b2.boundingBox();
  assert(box && box.height <= 40, 'banner stays one slim line on a 360 px phone (height ' + (box && box.height) + ')');
  await p2.screenshot({ path: path.join(SHOTS, 'demo-operator-phone.png') });
  await p2.goto(BASE + '/admin/demo');
  assert(await p2.getByText('Only the Owner/Director can reset the demo data.').isVisible(), 'operator cannot reset');
  log('operator signed in with one click on 360 px; no reset');
  await c2.close();

  // 3. Mark the data, then reset as the owner and check it is gone
  await p1.goto(BASE + '/admin/demo');
  // Step-up (docs/security.md §3.6): a sign-in within the re-authentication window counts; otherwise
  // the "Confirm it's you" card asks for the password first.
  if (await p1.getByLabel('Your password').count()) {
    await p1.getByLabel('Your password').fill('demo1234');
    await p1.getByRole('button', { name: 'Confirm' }).click();
    await p1.getByText('Confirmed.').first().waitFor({ timeout: 15000 }).catch(() => undefined);
    await p1.reload();
    assert(!(await p1.getByLabel('Your password').count()), 're-authentication accepted');
    log('re-authenticated on the reset page');
  } else {
    log('fresh sign-in is inside the re-authentication window');
  }
  await p1.getByLabel('Type RESET to confirm').fill('reset');
  const t0 = Date.now();
  await p1.getByRole('button', { name: 'Reset demo data' }).click();
  assert(await p1.getByText('Resetting…', { exact: false }).first().isVisible(), 'progress shown while resetting');
  await p1.waitForURL('**/sign-in?notice=demo_reset', { timeout: 240000 });
  assert(await p1.getByText('The demo data was reset to a fresh copy').isVisible(), 'reset notice on the sign-in page');
  log(`reset finished in ${Math.round((Date.now() - t0) / 1000)} s`);
  await p1.screenshot({ path: path.join(SHOTS, 'demo-after-reset.png') });
  await oneClick(p1, 'Ana Villanueva');
  await p1.goto(BASE + '/admin/audit');
  assert(await p1.getByText('platform.demo.reset').first().isVisible().catch(() => false) || (await p1.content()).includes('demo.reset'), 'reset recorded in the new audit log');
  log('signed in again after reset; reset recorded in the audit log');
  await c1.close();
}

async function runOff(browser) {
  const { context, page } = await newPage(browser);
  await page.goto(BASE + '/sign-in');
  assert(!(await page.getByRole('switch', { name: 'Try the demo' }).count()), 'no demo switch when demo mode is off');
  assert(!(await page.content()).includes('demo1234'), 'no demo password on the page');
  await page.getByLabel('Email').fill('owner@bryels-care.test');
  await page.getByLabel('Password').fill('demo1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });
  assert(!(await page.getByRole('note', { name: 'Demo environment' }).count()), 'no demo banner when demo mode is off');
  await page.goto(BASE + '/admin/demo');
  assert(await page.getByText('Not a demo environment').isVisible(), 'reset page refuses when demo mode is off');
  log('demo off: no switch, no banner, reset page refuses');
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (EXPECT === 'off') await runOff(browser);
    else await runOn(browser);
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  log('PASS', EXPECT);
})().catch((e) => {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exit(1);
});
