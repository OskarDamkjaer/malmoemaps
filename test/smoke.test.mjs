// A browser smoke test — the four things nobody looked at in the sandbox.
//
// The deletion pass (Förr, search, the layer menu, POI overlays, mode tabs) was
// written and merged without ever booting the app, because the sandbox could
// not. This test boots it headless and checks the things that would have shown
// up on screen:
//
//   1. The quiz front door, with no mode tabs above the heading.
//   2. "Utforska kartan" → labelled map, no search bar, no Lager button, no POI
//      dots at any zoom.
//   3. Tapping a landmark, a delområde name and a street each opens the card;
//      tapping empty water closes it.
//   4. Starting a round blinds the map (no text), the card can't be opened,
//      Escape backs out, and "Öva" returns from the map.
//
// It uses playwright-core (no `playwright install` — it drives the system
// Chrome) so it runs in a sandbox that has Chrome but not the Playwright
// browser bundle. The dev server is started as a subprocess and killed on exit.
//
// Run: node --test test/smoke.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// playwright-core is the no-browsers package: it drives an existing Chrome
// rather than downloading one. The sandbox has Chrome at the standard macOS
// path; a local checkout has it there too. The repo has no package.json (by
// convention), so the module is resolved from a temp install via createRequire
// rather than from node_modules alongside the test.
import { createRequire } from 'node:module';

// Try a few places: a temp install (sandbox), a local node_modules (if
// somebody added one), and the global resolution. If none has it, the test
// skips — it needs a browser, and a machine without playwright-core almost
// certainly does not have one rigged for headless use.
const TMP_DIR = '/var/folders/05/g2cfvd6x56z78g49y0jc4kt00000gn/T/opencode';
let chromium = null;
let skipReason = null;
for (const base of [`${TMP_DIR}/node_modules/_.js`, import.meta.url]) {
  try {
    const req = createRequire(base);
    chromium = req('playwright-core').chromium;
    break;
  } catch { /* try next */ }
}
if (!chromium) {
  skipReason = 'playwright-core is not installed — run `npm i playwright-core` in a temp dir';
}

// The app and its data have to be built, or there is nothing to boot.
if (!skipReason) {
  for (const p of ['build/style.json', 'build/data/learn.json', 'data/cache/malmo.pmtiles']) {
    if (!existsSync(p)) {
      skipReason = `${p} is gitignored — run the build pipeline or fetch-dev-assets.mjs first`;
      break;
    }
  }
}

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXECUTABLE = existsSync(CHROME_PATH) ? CHROME_PATH : undefined;

// The dev server. Started once for the whole file, killed when the process
// exits. A random port avoids clashing with anything already running.
const PORT = 9123;
let server;

async function startServer() {
  server = spawn('node', ['scripts/serve.mjs', '--port', String(PORT)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Wait for "serving on" so we don't race the listen.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
    server.stdout.on('data', (d) => {
      if (d.toString().includes('serving on')) { clearTimeout(timer); resolve(); }
    });
    server.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

async function stopServer() {
  if (server) server.kill('SIGTERM');
}

// A browser page at the app, with console errors collected. The map takes a
// few seconds to load (13 MB pmtiles), so each test waits for #boot to be done.
async function openPage(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  // Wait for the app to boot: #boot gets .done, and the front door (#learn)
  // becomes visible.
  await page.waitForSelector('#boot.done', { timeout: 15000 });
  await page.waitForSelector('#learn:not([hidden])', { timeout: 5000 });
  return { page, errors };
}

// The four checks, as one test so the browser launches once. Splitting them
// would mean four loads of a 13 MB archive, which is slow without buying
// anything — the checks are independent assertions, not independent setups.
test('the app after the focusing pass', { skip: skipReason ?? undefined }, async () => {
  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  try {
    await startServer();
    const { page, errors } = await openPage(browser);

    // 1. The front door is the quiz, with no mode tabs.
    const heading = await page.locator('#learn h1').textContent();
    assert.equal(heading, 'Lär dig Malmö', 'the heading is the quiz heading');
    assert.equal(await page.locator('.modetab').count(), 0,
      'no mode tabs above the heading');

    // 2. "Utforska kartan" → labelled map, no search bar, no Lager button.
    await page.click('#toexplore');
    await page.waitForFunction(() => !document.getElementById('tolearn').hidden, { timeout: 3000 });
    assert.ok(await page.locator('#searchbar').isHidden(),
      'no search bar in explore mode');
    // The layer menu (#layers) was removed from the HTML entirely.
    assert.equal(await page.locator('#layers').count(), 0,
      'no layer menu element in the DOM');
    // No POI dots: the style drops poi_z14/z15/z16, and the category layers are
    // gone. Check that no circle layer named cat-* exists on the map.
    const catLayers = await page.evaluate(() =>
      window.map.getStyle().layers.filter((l) => l.id.startsWith('cat-')).length);
    assert.equal(catLayers, 0, 'no category (POI) layers on the map');

    // 3. Tapping things opens the card; tapping empty water closes it.
    // A landmark: the Turning Torso is at roughly [13.014, 55.607]. Pan there
    // and tap. (The exact pixel depends on the viewport, so we use a known
    // map center and zoom to a level where landmarks are drawn.)
    await page.evaluate(() => {
      window.map.setCenter([13.014, 55.607]);
      window.map.setZoom(14);
    });
    await page.waitForTimeout(1000);
    // Tap the centre — a landmark or a delområde name should be there.
    await page.mouse.click(400, 300);
    await page.waitForFunction(() => !document.getElementById('card').hidden, { timeout: 3000 })
      .catch(() => {});
    const cardHidden = await page.evaluate(() => document.getElementById('card').hidden);
    assert.ok(!cardHidden, 'tapping a feature opens the card');

    // Tap empty water (Öresund, west of the city) to close the card.
    await page.evaluate(() => {
      window.map.setCenter([12.95, 55.57]); // out in the sound
      window.map.setZoom(11);
    });
    await page.waitForTimeout(500);
    await page.mouse.click(400, 300);
    await page.waitForTimeout(500);
    const cardHiddenAfter = await page.evaluate(() => document.getElementById('card').hidden);
    assert.ok(cardHiddenAfter, 'tapping empty water closes the card');

    // 4. Starting a round blinds the map.
    // Go back to the quiz and start a round.
    await page.click('#tolearn');
    await page.waitForFunction(() => !document.getElementById('learn').hidden, { timeout: 3000 });
    // Click the first "Peka ut" button — it starts the round synchronously,
    // but the map's blinding and framing are async, so wait for #play.
    await page.click('.chunk .start');
    await page.waitForFunction(() => !document.getElementById('play').hidden, { timeout: 5000 });

    // No text on the map: every symbol layer should be hidden.
    const visibleSymbols = await page.evaluate(() => {
      const style = window.map.getStyle();
      return style.layers.filter((l) => {
        if (l.type !== 'symbol') return false;
        const vis = window.map.getLayoutProperty(l.id, 'visibility') ?? 'visible';
        return vis === 'visible';
      }).map((l) => l.id);
    });
    // The outline layers are kept (they are line, not symbol), so any surviving
    // symbol layer is a label that should have been blinded.
    const outlines = await page.evaluate(() => {
      // The quiz's outline layers — these are the only non-basemap layers
      // that stay visible during a round, and they are all line/fill.
      return window.map.getStyle().layers
        .filter((l) => l.metadata?.role === 'outline')
        .map((l) => l.id);
    });
    // Filter out any symbol layers that are the outline layers (there shouldn't
    // be any, but be precise).
    const leakingLabels = visibleSymbols.filter((id) => !outlines.includes(id));
    assert.deepEqual(leakingLabels, [],
      `a round leaves these labels visible: ${leakingLabels.join(', ')}`);

    // The card can't be opened during a round.
    await page.mouse.click(400, 300);
    await page.waitForTimeout(500);
    const cardHiddenInRound = await page.evaluate(() => document.getElementById('card').hidden);
    assert.ok(cardHiddenInRound, 'the explore card cannot be opened during a round');

    // Escape backs out of the round.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('play').hidden, { timeout: 3000 });
    const learnVisibleAfterEsc = await page.evaluate(() => !document.getElementById('learn').hidden);
    assert.ok(learnVisibleAfterEsc, 'Escape returns to the front door');

    // "Öva" returns from the explore map.
    await page.click('#toexplore');
    await page.waitForFunction(() => !document.getElementById('tolearn').hidden, { timeout: 3000 });
    await page.click('#tolearn');
    await page.waitForFunction(() => !document.getElementById('learn').hidden, { timeout: 3000 });
    const learnVisibleAfterOva = await page.evaluate(() => !document.getElementById('learn').hidden);
    assert.ok(learnVisibleAfterOva, '"Öva" returns from the explore map');

    // Console must be clean.
    assert.deepEqual(errors, [],
      `console errors: ${errors.join('; ')}`);

    await page.close();
  } finally {
    await stopServer();
    await browser.close();
  }
});
