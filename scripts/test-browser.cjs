/* Run against an exported bundle; never touches a phone, model or source trace. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SHOWCASE_URL || 'http://127.0.0.1:8765';
const output = path.join(__dirname, '..', 'preview');
const assetBase = new URL('../', base.replace(/\/$/, '') + '/').href.replace(/\/$/, '');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  try {
    await page.goto(base);
    await page.locator('#native .step-title').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const catalog = await (await page.request.get(`${assetBase}/data/catalog.json`)).json();
    assert.equal(await page.locator('.case-button').count(), catalog.length);
    assert.equal(await page.locator('#score-table tbody tr').count(), 6);
    assert.equal(await page.locator('#stages [data-stage="maya_ambiguous_lamp"]').count(), 0);
    assert.equal(await page.locator('.empty').count(), 0);
    assert.match(await page.locator('#stage-tag').innerText(), /16:01–16:02/);
    assert.match(await page.locator('#stage-context').innerText(), /短信背景[\s\S]*床头灯一直闪[\s\S]*用户委托[\s\S]*亮度恢复到修之前/);
    await page.getByRole('button', { name: '阅读方式与来源' }).click();
    assert(await page.locator('#about').isVisible());
    assert.match(await page.locator('#about').textContent(), /这是精选案例，不代表完整基准/);
    await page.getByRole('button', { name: '阅读方式与来源' }).click();

    // Independent controls must not advance the other agent.
    const nativeBefore = await page.locator('#native .step-count').innerText();
    await page.getByRole('button', { name: 'MobileClaw 下一步', exact: true }).click();
    assert.equal(await page.locator('#native .step-count').innerText(), nativeBefore);
    assert.match(await page.locator('#claw .step-count').innerText(), /^2 /);

    // Go directly to a source-bound GUI step; verify both native result and real image.
    const data = await (await page.request.get(`${assetBase}/data/home_repair.json`)).json();
    assert.equal(data.tasks.length, 6);
    assert.match(await page.locator('#task-count').innerText(), /1 个场景 · 6 个任务/);
    await page.locator('[data-task="v4_t031"]').click();
    assert(page.url().includes('task=v4_t031'));
    assert.match(await page.locator('#task-request').innerText(), /亮度恢复到修之前/);
    assert(await page.locator('#stages [data-stage="maya_repair_complete"]').count());
    assert.equal(await page.locator('#stages [data-stage="helper_finished"]').count(), 0);
    await page.locator('#stages [data-stage="maya_repair_complete"]').click();
    assert(await page.locator('#native .task-badge:not(.contextual)').count());
    assert(await page.locator('#claw .task-badge.contextual').count());
    await page.reload();
    await page.locator('#native .step-title').waitFor();
    assert.equal(await page.locator('[data-task="v4_t031"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-task="all"]').click();
    const repaired = data.lanes.claw.steps.find(s => s.index === 9);
    assert.equal(repaired.image_capture_kind, 'verified_prefix_replay');
    assert.notEqual(repaired.image_sha256, repaired.archived_image.image_sha256);
    assert.equal(repaired.archived_image.image_observation_source.seq, 52);
    const stage = 'maya_repair_complete';
    const native = data.lanes.native.steps.filter(s => s.stage === stage);
    const claw = data.lanes.claw.steps.filter(s => s.stage === stage);
    const n = native.findIndex(s => s.index === 105);
    const c = claw.findIndex(s => s.index === 237);
    assert(n >= 0 && c >= 0);
    await page.goto(`${base}/#scene=home_repair&stage=${stage}&n=${n}&c=${c}&filter=all`);
    await page.locator('#claw .screen-wrap img').waitFor();
    await page.waitForFunction(() => document.querySelector('#claw .screen-wrap img')?.naturalWidth > 0);
    await page.evaluate(() => document.fonts.ready);
    const left = await page.locator('#native').boundingBox();
    const right = await page.locator('#claw').boundingBox();
    assert(Math.abs(left.y - right.y) < 2 && right.x >= left.x + left.width, 'Agents must be side by side');
    const leftPhone = await page.locator('#native .screen-wrap').boundingBox();
    const rightPhone = await page.locator('#claw .screen-wrap').boundingBox();
    assert(Math.abs(leftPhone.y - rightPhone.y) < 2, 'Phone screens must align');
    await page.screenshot({ path: path.join(output, 'comparison-desktop.png'), fullPage: true });
    assert.equal(await page.locator('.visual-stage').count(), 2);
    assert.match(await page.locator('#native .state-panel').innerText(), /35%/);
    assert(await page.locator('#native .tool-call').isVisible());
    assert.match(await page.locator('#native .tool-name').innerText(), /app_smarthome_get_device_details/);
    assert.match(await page.locator('#native .tool-call').innerText(), /guest_bedside_lamp[\s\S]*返回 1 条记录/);
    assert(data.lanes.native.steps.every(s => s.image && s.image_capture_kind === 'continuous_action_replay'));
    assert(data.lanes.claw.steps.every(s => s.image));
    assert(data.lanes.claw.steps.filter(s => s.kind === 'gui').every(s => s.image_capture_kind === (s.index === 9 ? 'verified_prefix_replay' : 'archived_after_action')));
    assert.equal(await page.locator('#native .visual-stage').getAttribute('data-capture-kind'), 'continuous_action_replay');
    assert.equal(await page.locator('#claw .visual-stage').getAttribute('data-capture-kind'), 'archived_after_action');
    assert.equal(await page.locator('#native .screen-wrap img').count(), 1);
    assert.equal(await page.locator('#native .evidence-caption').count(), 0);
    assert.equal(await page.locator('#native .replay-note').count(), 0);
    const screen = await page.locator('#claw .screen-wrap img').getAttribute('src');
    const retained = await page.evaluate(() => {
      const list = filtered('claw');
      const target = list.findIndex((s,i) => i > state.positions.claw && !s.image);
      if (target >= 0) { state.positions.claw = target; renderLane('claw'); }
      return target >= 0;
    });
    assert.equal(await page.locator('#claw .visual-stage').getAttribute('data-retained'), String(retained));
    assert.equal(await page.locator('#claw .tap').count(), 0);
    await page.goto(`${base}/#scene=home_repair&stage=${stage}&n=${n}&c=${c}&filter=all`);
    await page.locator('#claw .screen-wrap img').waitFor();
    const deepLink = page.url();
    await page.reload();
    await page.locator('#claw .screen-wrap img').waitFor();
    const hashParams = url => [...new URLSearchParams(new URL(url).hash.slice(1))].sort();
    assert.deepEqual(hashParams(page.url()), hashParams(deepLink));
    await page.locator('#claw').getByRole('button', { name: '放大截图' }).click();
    assert(await page.locator('#image-dialog').isVisible());
    await page.keyboard.press('Escape');
    assert(!(await page.locator('#image-dialog').isVisible()));

    // Hostile trace strings must stay text (no script/HTML execution).
    await page.evaluate(() => {
      const step = state.data.lanes.native.steps.find(s => s.stage === state.stage);
      step.message = '<img src=x onerror="window.traceExecuted=true">';
      state.positions.native = 0;
      renderLane('native');
    });
    assert.equal(await page.locator('#native .step-message img').count(), 0);
    assert.equal(await page.evaluate(() => window.traceExecuted), undefined);
    await page.reload();
    await page.locator('#claw .screen-wrap img').waitFor();

    // Filtering resets cursors; changing the case resets the stage and scores.
    await page.locator('#filter').selectOption('actions');
    assert.match(await page.locator('#native .kind').innerText(), /^STEP \d+$/);
    for (const {id} of catalog) {
      if (catalog.length > 1) await page.locator(`.case-button[data-id="${id}"]`).click();
      else await page.goto(base);
      await page.waitForFunction(id => state.data?.id === id, id);
      assert.equal(await page.locator('#score-table tbody tr').count(), 6);
      assert.equal(await page.locator('#filter').inputValue(), 'all');
    }
    await page.locator('#speed').selectOption('500');
    await page.getByRole('button', { name: '播放两侧步骤', exact: true }).click();
    await page.waitForFunction(() => state.positions.claw > 0);
    await page.getByRole('button', { name: '暂停播放', exact: true }).click();

    // Continue into the next event, preserving each lane's own action sequence.
    const nextStage = await page.evaluate(() => {
      state.positions.native = filtered('native').length - 1;
      state.positions.claw = filtered('claw').length - 1;
      renderLane('native'); renderLane('claw');
      return state.data.stages[state.data.stages.findIndex(s => s.id === state.stage) + 1].id;
    });
    await page.getByRole('button', { name: '播放两侧步骤', exact: true }).click();
    await page.waitForFunction(id => state.stage === id, nextStage);
    assert(await page.evaluate(() => state.timer !== null));
    await page.getByRole('button', { name: '暂停播放', exact: true }).click();
    // Stop at the scene's real end, including an event with no subject steps.
    await page.evaluate(() => {
      selectStage(state.data.stages.at(-1).id);
      for (const key of ['native','claw']) state.positions[key] = Math.max(0, filtered(key).length - 1);
    });
    await page.getByRole('button', { name: '播放两侧步骤', exact: true }).click();
    await page.waitForFunction(() => state.timer === null);

    await page.goto(`${base}/#scene=home_repair&stage=maya_ambiguous_lamp&n=0&c=0`);
    await page.waitForFunction(() => state.stage === 'establish_c25');
    assert.equal(await page.locator('.empty').count(), 0);
    assert.match(await page.locator('#stage-raw').textContent(), /maya_ambiguous_lamp[\s\S]*establish_c25/);
    await page.goto(deepLink);
    await page.locator('#claw .screen-wrap img').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, 'comparison-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('.lanes .lane').count(), 2);
    assert.deepEqual(errors, []);
    assert(requests.every(url => url.startsWith('data:') || new URL(url).origin === new URL(base).origin), 'No runtime CDN or external requests');
    const result = { passed: true, cases: catalog.length, desktop: '1600 × 1100', mobile: '390 × 844',
      checks: ['six task selectors', 'task-scoped timeline', 'exact vs context badges', 'task deep-link reload',
        'verified Step 9 repair with preserved original', 'source screenshot', 'independent step navigation', 'deep-link reload', 'image dialog',
        'untrusted trace rendered as text', 'case switching', 'filters', 'play/pause/end', 'merged opening and legacy link',
        'no horizontal overflow', 'zero browser errors', 'no external requests'] };
    fs.writeFileSync(path.join(output, 'browser-validation.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
