/* Desktop top bar fit (ADR-123; ADR-121 left the owner's menu row 74 px short at 1280 px).
 *
 * Run against a server loaded with the FULL demo (DEMO_PROFILE=full: the owner, QA, sales and warehouse.rvs have two
 * sites, so the site selector is in the bar):
 *   BASE=http://localhost:3561 node tests/e2e/top-bar-fit.cjs
 * Options: USERS=owner,sales (demo accounts, without @bryels-care.test), WIDTHS=1280,1440, SHOTS_DIR (top-bar crops
 * at 1280 px and of every failure; default <tmp>/top-bar-fit).
 * Playwright is taken from the project, else from the global npm root (no NODE_PATH needed).
 *
 * For every role, width (1280, 1366, 1440, 1536, 1920) and destination it checks, from 1280 px (where the menu row
 * shows):
 *   - the destinations row ("Modules") does not scroll: scrollWidth <= clientWidth, and every entry's box lies
 *     inside the row (nothing cut);
 *   - the site selector (people with more than one site) and the master search button (or, with the setting
 *     ui.wide_screen_top_bar = "scan", the Scan button in its place; ADR-126) are visible;
 *   - the page has no sideways scroll;
 *   - the destination's tab row is one line and ends inside the window.
 * Exits 1 when any check fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

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
const USERS = (process.env.USERS || 'owner,manager.nfd,finance,sales,qa.nfd,warehouse.rvs,warehouse.nfd,operator.nfd').split(',');
const WIDTHS = (process.env.WIDTHS || '1280,1366,1440,1536,1920').split(',').map(Number);
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'top-bar-fit');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  let failures = 0;
  for (const u of USERS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/sign-in');
    await page.fill('#email', `${u}@bryels-care.test`);
    await page.fill('#password', 'demo1234');
    await page.click('button[type=submit]');
    await page.waitForURL('**/dashboard', { timeout: 120000 });
    const dests = await page.$$eval('nav[aria-label=Modules] a', (as) => as.map((a) => a.getAttribute('href')));
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const href of ['/dashboard', ...dests.filter((d) => d !== '/dashboard')]) {
        await page.goto(BASE + href, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        const m = await page.evaluate(() => {
          const ul = document.querySelector('nav[aria-label=Modules] ul');
          const ur = ul.getBoundingClientRect();
          const items = [...ul.querySelectorAll(':scope > li')].map((li) => ({ t: li.innerText.trim(), b: li.getBoundingClientRect() }));
          const cut = items.filter((i) => i.b.left < ur.left - 1 || i.b.right > ur.right + 1).map((i) => i.t);
          const shown = (sel) => {
            const e = document.querySelector(sel);
            if (!e) return 'absent';
            const b = e.getBoundingClientRect();
            return b.width > 0 && getComputedStyle(e).display !== 'none' && b.right <= innerWidth ? 'ok' : 'hidden';
          };
          const row = document.querySelector('[data-testid=desktop-tab-row]');
          const rowItems = row ? [...row.querySelectorAll(':scope > li')].filter((li) => li.getBoundingClientRect().width > 0) : [];
          const lines = new Set(rowItems.map((li) => { const b = li.getBoundingClientRect(); return Math.round((b.top + b.height / 2) / 12); })).size;
          const rowRight = rowItems.length ? Math.max(...rowItems.map((li) => li.getBoundingClientRect().right)) : 0;
          return { over: ul.scrollWidth - ul.clientWidth, spare: Math.round(document.querySelector('nav[aria-label=Modules]').getBoundingClientRect().width - ul.scrollWidth), cut, site: shown('[data-testid=site-switch]'), search: shown('[data-testid=master-search-open]'), scan: shown('[data-testid=top-bar-scan]'), page: document.documentElement.scrollWidth - innerWidth, lines, rowOut: Math.round(rowRight - innerWidth) };
        });
        const bad = [];
        if (m.over > 0) bad.push(`menu row ${m.over} px too long`);
        if (m.cut.length) bad.push(`cut: ${m.cut.join(', ')}`);
        if (m.site === 'hidden') bad.push('site selector hidden');
        // ADR-126: with ui.wide_screen_top_bar = "scan" the Scan button takes the search button's place from 1280 px.
        if (m.search !== 'ok' && m.scan !== 'ok') bad.push(`search button ${m.search}, scan button ${m.scan}`);
        if (m.page > 0) bad.push(`page scrolls sideways ${m.page} px`);
        if (m.lines > 1) bad.push(`tab row has ${m.lines} lines`);
        if (m.rowOut > 0) bad.push(`tab row ends ${m.rowOut} px outside`);
        console.log(`${bad.length ? 'FAIL' : 'ok  '} ${u} ${w} ${href} spare=${m.spare}px site=${m.site}${bad.length ? ' — ' + bad.join('; ') : ''}`);
        if (bad.length) failures++;
        if (href === '/dashboard' && (w === 1280 || bad.length)) await page.screenshot({ path: path.join(OUT, `${u}-${w}.png`), clip: { x: 0, y: 0, width: w, height: 160 } });
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `${failures} failures` : 'All widths fit.');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
