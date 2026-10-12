// Capture the actual homepage observation panel; phone pixels remain source-bound.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.PROJECT_URL || 'http://127.0.0.1:8768').replace(/\/$/, '');
const root = path.join(__dirname, '..');
(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/stories.json')));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#story-showcase[data-ready=true]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '.site-header{position:static}.story-visual{min-height:610px}.story-controls{display:none}' });
    const examples = [];
    for (const story of data.stories) {
      await page.getByRole('tab', { name: story.title, exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.story-visual img')].every(img => img.complete && img.naturalWidth > 0));
      const selected = story.moments[story.default];
      assert.equal(await page.locator('#story-showcase').getAttribute('data-scene'), story.id);
      assert.equal(await page.locator('#story-showcase').getAttribute('data-step'), String(selected.step));
      assert.equal(await page.locator('.story-unavailable').count(), 0);
      const thumbnail = `assets/figures/demo-${story.id}.png`;
      await page.locator('.story-visual').screenshot({ path: path.join(root, thumbnail) });
      const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, thumbnail))).digest('hex');
      examples.push({scene:story.id, title:story.title, description:story.heading, task:story.task,
        native:selected.step, href:selected.href, thumbnail, thumbnail_sha256:digest,
        source_data_sha256:story.data_sha256,
        images: selected.image ? [story.moments.slice(0, story.default).findLast(item => item.image), selected]
          .filter(Boolean).map(item => ({step:item.step,path:item.image,sha256:item.image_sha256,capture_kind:item.capture_kind})) : []});
      console.log(`${story.id}: step ${selected.step}`);
    }
    fs.writeFileSync(path.join(root, 'data/showcase.json'), JSON.stringify({
      description: 'Actual homepage observation panels for four GPT-5.4 scenarios. Screenshots and native readbacks are linked to their saved source steps.', examples,
    }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
