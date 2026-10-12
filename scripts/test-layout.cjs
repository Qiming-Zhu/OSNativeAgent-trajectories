const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.PROJECT_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');
const localOnly = route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort();

(async () => {
  const browser = await chromium.launch({headless:true,
    ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    await page.route('**/*', localOnly);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, {waitUntil:'networkidle'});
    await page.locator('#story-showcase[data-ready=true]').waitFor();
    const cases = await page.getByRole('tablist', {name:'Choose a recorded scenario'}).getByRole('tab').allTextContents();
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({width,height:900});
      for (const title of cases) {
        await page.getByRole('tab', {name:title,exact:true}).click();
        for (const moment of await page.locator('.story-moment').all()) {
          await moment.click();
          await page.waitForFunction(() => [...document.querySelectorAll('.story-evidence img')].every(img => img.complete && img.naturalWidth));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px / ${title}`);
          assert.equal(await page.locator('.story-unavailable').count(), 0);
          assert(await page.locator('.story-open').isVisible());
        }
      }
    }
    assert.deepEqual(errors, []);
    // Fetch failures leave a usable recorded example and the static paper tables.
    const failed = await browser.newPage();
    await failed.route('**/*', route => /data\/(stories|dynamicworld-results)\.json$/.test(route.request().url()) ?
      route.fulfill({status:503,body:'unavailable'}) : localOnly(route));
    await failed.goto(base, {waitUntil:'networkidle'});
    assert(await failed.locator('.story-fallback').first().isVisible());
    assert.equal(await failed.locator('.story-fallback a').count(), 4);
    assert.equal(await failed.locator('.story-controls').isVisible(), false);
    assert.equal(await failed.locator('#challenge-rows .overall .score-number').first().textContent(), '76.1');
    assert(await failed.locator('#result-error').isVisible());
    assert(await failed.locator('#tab-mini').isDisabled());
    // JavaScript-free reading still shows source imagery, links and paper results.
    const context = await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    await context.route('**/*', localOnly);
    const staticPage = await context.newPage();
    await staticPage.goto(base, {waitUntil:'networkidle'});
    assert(await staticPage.locator('noscript .story-fallback').isVisible());
    assert(await staticPage.locator('.story-evidence img').isVisible());
    assert.equal(await staticPage.locator('.story-controls').isVisible(), false);
    assert.equal(await staticPage.locator('.model-tabs').isVisible(), false);
    assert.equal(await staticPage.locator('#challenge-rows .overall .score-number').first().textContent(), '76.1');
    console.log('PASS: 60 scenario/moment layouts at 320–1440px; fetch-failure and JavaScript-free fallbacks.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exit(1);});
