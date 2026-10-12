const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.PROJECT_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');
const output = path.join(__dirname, '..', 'preview');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  // Browser QA uses the supplied local server; external links are never opened.
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  try {
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    assert.match(await page.title(), /OS-native Agents/);
    assert.equal(await page.getByRole('button', { name: 'arXiv paper link coming soon' }).isDisabled(), true);
    assert.equal(await page.locator('a[href*="paper.pdf"]').count(), 0);
    await page.locator('#citation').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('main img')].every(image => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'project-desktop.png'), fullPage: true });
    const results = await (await page.request.get(`${base}/data/dynamicworld-results.json`)).json();
    for (const model of ['GPT-5.4-mini', 'GPT-5.4']) {
      await page.getByRole('tab', { name: model, exact: true }).click();
      const expected = results.models[model];
      assert.equal(await page.locator('.bar-value').first().textContent(), `${expected['OS-native'].success.toFixed(1)}%`);
      assert.equal(await page.locator('#result-rows tr').count(), 3);
      assert.equal(await page.locator('#success-gain').textContent(), `+${(expected['OS-native'].success - expected.MobileClaw.success).toFixed(1)} percentage points`);
    }
    await page.getByRole('tab', { name: 'GPT-5.4', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#tab-mini').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#tab-full').getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: 'Copy BibTeX citation' }).click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /@misc\{zhu2026osnative/);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px page overflow`);
      if (width === 390) await page.screenshot({ path: path.join(output, 'project-mobile.png'), fullPage: true });
    }
    await page.getByRole('link', { name: 'Open the interactive comparison' }).click();
    await page.locator('#native .step-title').waitFor();
    assert(page.url().includes('/demo/'));
    assert.equal(await page.locator('[data-task="v4_t031"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => ['native', 'claw'].map(key => filtered(key)[state.positions[key]].index)), [105, 237]);
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto(`${base}/demo/#scene=home_repair&stage=maya_repair_complete&filter=all`);
    await page.locator('#native .step-title').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'demo-desktop.png'), fullPage: true });
    await page.goto(`${base}/#scene=home_repair&task=v4_t036`);
    await page.waitForURL('**/demo/#scene=home_repair&task=v4_t036');
    await page.locator('#native .step-title').waitFor();
    assert.equal(await page.locator('[data-task="v4_t036"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    console.log('PASS: arXiv placeholder, result tabs, keyboard navigation, citation copy, 320/390px layouts, Demo links and old deep links.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
