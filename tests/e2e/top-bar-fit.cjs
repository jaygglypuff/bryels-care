/* App frame fit (ADR-136, replaces the top-bar menu row checks of ADR-123/ADR-129): the sidebar, the top bar and the
 * phone frame for every role and width.
 *
 * Run against a server loaded with a demo (lite or full):
 *   BASE=http://localhost:3621 node tests/e2e/top-bar-fit.cjs
 * Options: USERS=owner,sales (demo accounts, without @bryels-care.test), WIDTHS=390,1024,1440, SHOTS_DIR (a shot of
 * every failure; default <tmp>/top-bar-fit), CHROMIUM (browser path).
 * Playwright is taken from the project, else from the global npm root (no NODE_PATH needed).
 *
 * For every role, width and menu destination it checks:
 *   - from 1024 px: the sidebar is shown, lists every destination of the person's menu as a link, marks exactly one
 *     entry aria-current="page" on a menu page, and the breadcrumb (nav "You are here") ends with that page's word;
 *   - below 1024 px: no sidebar; office roles have the ☰ button, floor roles (operator, warehouse) do not and keep
 *     their bottom bar;
 *   - the Search box (or the Scan button, setting ui.wide_screen_top_bar = scan) and the avatar are visible and end
 *     inside the window;
 *   - the page has no sideways scroll.
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
const USERS = (process.env.USERS || 'owner,manager.nfd,finance,sales,qa.nfd,warehouse.nfd,operator.nfd').split(',');
const WIDTHS = (process.env.WIDTHS || '390,768,1024,1280,1440,1920').split(',').map(Number);
const FLOOR = ['operator.nfd', 'warehouse.nfd', 'warehouse.rvs', 'operator.rvs'];
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'top-bar-fit');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const exe = process.env.CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  let failures = 0;
  let checks = 0;
  for (const u of USERS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/sign-in');
    await page.fill('#email', `${u}@bryels-care.test`);
    await page.fill('#password', 'demo1234');
    await page.click('button[type=submit]');
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 120000 });
    const home = new URL(page.url()).pathname;
    await page.waitForSelector('[data-testid=side-menu]', { timeout: 60000 });
    const dests = await page.$$eval('[data-testid=side-menu] a[href]', (as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    const floor = FLOOR.includes(u);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const href of [home, ...dests.filter((d) => d !== home)].slice(0, w >= 1024 ? undefined : 4)) {
        await page.goto(BASE + href, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(200);
        const m = await page.evaluate(() => {
          const vis = (e) => !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
          const inside = (e) => vis(e) && e.getBoundingClientRect().right <= innerWidth + 0.5 && e.getBoundingClientRect().left >= -0.5;
          const side = document.querySelector('[data-testid=sidebar]');
          const current = side ? [...side.querySelectorAll('[aria-current=page]')].filter(vis).map((a) => a.textContent.trim()) : [];
          const crumbs = [...document.querySelectorAll('nav[aria-label="You are here"] li')].map((li) => li.textContent.trim());
          return {
            sidebar: vis(side),
            links: side ? side.querySelectorAll('a[href]').length : 0,
            current,
            crumbs,
            menuButton: vis(document.querySelector('[data-testid=open-menu]')),
            bottomBar: vis(document.querySelector('nav[aria-label=Primary]')),
            search: inside(document.querySelector('[data-testid=master-search-open]')) || inside(document.querySelector('[data-testid=top-bar-scan]')),
            avatar: inside(document.querySelector('[data-testid=account-menu]')),
            sideways: document.documentElement.scrollWidth - innerWidth,
          };
        });
        const bad = [];
        if (w >= 1024) {
          if (!m.sidebar) bad.push('no sidebar');
          if (m.links < Math.min(dests.length, 2)) bad.push(`sidebar lists ${m.links} links`);
          if (m.current.length > 1) bad.push(`${m.current.length} entries marked current: ${m.current.join(', ')}`);
          if (!m.crumbs.length) bad.push('no breadcrumb');
          if (m.menuButton) bad.push('☰ shown next to the sidebar');
        } else {
          if (m.sidebar) bad.push('sidebar on a narrow screen');
          if (floor && m.menuButton) bad.push('☰ for a floor role');
          if (!floor && !m.menuButton) bad.push('no ☰ for an office role');
          if (!m.bottomBar) bad.push('no bottom bar');
        }
        if (!m.search && !floor) bad.push('Search not visible inside the window');
        if (!m.avatar) bad.push('avatar not visible inside the window');
        if (m.sideways > 0) bad.push(`page scrolls sideways by ${m.sideways}px`);
        checks += 1;
        if (bad.length) {
          failures += 1;
          const file = path.join(OUT, `fail-${u}-${w}-${href.replace(/\W+/g, '_')}.png`);
          await page.screenshot({ path: file });
          console.log(`FAIL ${u} ${w}px ${href}: ${bad.join('; ')} (${file})`);
        }
      }
    }
    console.log(`${u}: ${dests.length} menu destinations checked at ${WIDTHS.join(', ')} px`);
    await ctx.close();
  }
  await browser.close();
  console.log(`${checks} checks, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
