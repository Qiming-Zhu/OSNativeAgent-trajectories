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
    for (const image of await page.locator('main img').all()) await image.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('main img')].every(image => image.complete && image.naturalWidth > 0));
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'project-desktop.png'), fullPage: true });
    const results = await (await page.request.get(`${base}/data/dynamicworld-results.json`)).json();
    for (const model of ['GPT-5.4-mini', 'GPT-5.4']) {
      await page.getByRole('tab', { name: model, exact: true }).click();
      const expected = results.models[model];
      assert.equal(await page.locator('#challenge-rows .overall .score-number').first().textContent(), expected['OS-native'].success.toFixed(1));
      assert.equal(await page.locator('#result-rows tr').count(), 3);
      assert.equal(await page.locator('#success-gain').textContent(), `+${(expected['OS-native'].success - expected.MobileClaw.success).toFixed(1)} percentage points`);
      for (const name of ['OS-native', 'MobileClaw', 'MobileWorld']) {
        const row = page.locator(`#challenge-rows [data-system="${name}"]`);
        const scores = [expected[name].success, ...expected[name].challenge_success];
        assert.deepEqual(await row.locator('.score-number').allTextContents(), scores.map(value => value.toFixed(1)));
        assert.deepEqual(await row.locator('.score-track i').evaluateAll(bars => bars.map(bar => bar.style.width)), scores.map(value => `${value}%`));
      }
      // Table 4 is explicitly GPT-5.4 only; Table 5 always shows both models.
      assert.deepEqual(await page.locator('.event-table tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent))),
        results.event_success.groups.map(row => [row.events, String(row.tasks), ...['OS-native', 'MobileClaw', 'MobileWorld'].map(system => row[system].toFixed(1))]));
      assert.deepEqual(await page.locator('.continuation-table tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent))),
        ['OS-native', 'MobileClaw', 'MobileWorld'].map(system => [system, ...['GPT-5.4', 'GPT-5.4-mini'].flatMap(model => ['initial', 'full'].map(phase => String(results.continuation_success.models[model][system][phase])))]));
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
    await page.setViewportSize({width:1440,height:1000});
    const stories = await (await page.request.get(`${base}/data/stories.json`)).json();
    assert.equal(stories.stories.length, 4);
    const deepLinks = [];
    for (const story of stories.stories) {
      await page.getByRole('tab', {name:story.title,exact:true}).click();
      for (const [i, moment] of story.moments.entries()) {
        await page.locator('.story-moment').nth(i).click();
        assert.equal(await page.locator('#story-showcase').getAttribute('data-step'), String(moment.step));
        assert.equal(await page.locator('.story-mode').textContent(), moment.mode === 'gui' ? 'GUI action' : 'Native interface');
        if (moment.mode === 'gui') {
          assert(moment.image && moment.image_sha256);
          await page.waitForFunction(() => [...document.querySelectorAll('.story-evidence img')].every(img => img.complete && img.naturalWidth > 0));
          assert.match(await page.locator('.story-capture').textContent(), /replaying saved actions/);
        } else {
          assert.equal(await page.locator('.story-record').count(), 1);
          assert.equal(await page.locator('.story-phone').count(), 0);
          assert.match(await page.locator('.story-capture').textContent(), /Original tool return/);
        }
        deepLinks.push({href:await page.locator('.story-open').getAttribute('href'),scene:story.id,native:moment.step});
      }
    }
    await page.getByRole('tab', {name:'Home repair',exact:true}).focus();
    await page.keyboard.press('End');
    assert.equal(await page.locator('#story-tab-cross_district_course').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#story-tab-home_repair').getAttribute('aria-selected'), 'true');
    for (const link of deepLinks) {
      await page.goto(`${base}/${link.href}`);
      await page.waitForFunction(link => state.data?.id === link.scene && filtered('native')[state.positions.native]?.index === link.native, link);
      assert.equal(await page.evaluate(() => filtered('native')[state.positions.native].index), link.native);
      assert.match(await page.locator('#native .lane-model').textContent(), /gpt-5.4/);
    }
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
    console.log('PASS: paper Tables 3–5, model tabs and score bars, all four scenarios and twelve source-bound moments, keyboard navigation, citation copy, 320/390px layouts, arXiv placeholder and old deep links.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
