// Capture actual viewer panels; original phone images and trace data are unchanged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = (process.env.PROJECT_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');
const root = path.join(__dirname, '..');
const examples = [
  { task: 'v4_t031', title: 'Lamp repair', description: 'Restore the original brightness after repair.', native: 105, claw: 237 },
  { task: 'v4_t032', title: 'Thermostat reconnection', description: 'Resume the task when the device comes back online.', native: 119, claw: 253 },
  { task: 'v4_t033', title: 'Repair verification', description: 'Check the technician’s claim against device state.', native: 88, claw: 208 },
  { task: 'v4_t034', title: 'Deferred lighting', description: 'Finish offline work without undoing later manual changes.', native: 131, claw: 281 },
  { task: 'v4_t035', title: 'Partial cancellation', description: 'Stop one part of a delegation while preserving the rest.', native: 95, claw: 220 },
  { task: 'v4_t036', title: 'Temporary access', description: 'Revoke the helper’s access when the work is finished.', native: 138, claw: 322 },
];
(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await page.goto(`${base}/demo/#scene=home_repair`, { waitUntil: 'networkidle' });
    await page.locator('#native .step-title').waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Give exported panels a common canvas without cropping their contents.
    await page.addStyleTag({ content: '.lanes { min-height: 820px; }' });
    for (const example of examples) {
      const source = await page.evaluate(example => {
        selectTask(example.task);
        const step = state.data.lanes.native.steps.find(step => step.index === example.native);
        selectStage(step.stage);
        for (const key of ['native', 'claw']) {
          state.positions[key] = filtered(key).findIndex(step => step.index === example[key]);
          if (state.positions[key] < 0) throw new Error(`${key} step does not match task and event`);
          renderLane(key);
        }
        syncHash();
        return { href: `demo/${location.hash}`, stage: state.stage,
          images: Object.fromEntries(['native', 'claw'].map(key => {
            const step = filtered(key)[state.positions[key]];
            return [key, { path: step.image, sha256: step.image_sha256, capture_kind: step.image_capture_kind }];
          })) };
      }, example);
      await page.waitForFunction(() => [...document.querySelectorAll('.lanes img')].every(img => img.complete && img.naturalWidth > 0));
      example.thumbnail = `assets/figures/demo-${example.task.replace('v4_', '')}.png`;
      await page.locator('.lanes').screenshot({ path: path.join(root, example.thumbnail) });
      Object.assign(example, source);
      example.thumbnail_sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, example.thumbnail))).digest('hex');
      assert(example.href.includes(`task=${example.task}`));
      console.log(`${example.task}: native ${example.native}, MobileClaw ${example.claw}`);
    }
    fs.writeFileSync(path.join(root, 'data/showcase.json'), JSON.stringify({
      description: 'Screenshots of the local trajectory viewer, showing selected steps from saved runs. Capture kinds and source image hashes are retained below.',
      examples,
    }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
