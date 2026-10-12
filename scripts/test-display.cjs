const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
const base = (process.env.SHOWCASE_URL || 'http://127.0.0.1:8768/demo').replace(/\/$/, '');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0,12);

for (const file of ['index.html','demo/index.html']) {
  const text = fs.readFileSync(path.join(root,file),'utf8');
  for (const [,asset,version] of text.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))(?:\?v=([^" ]+))?"/g)) {
    assert.equal(version,sha(asset), `${file}: ${asset} must use its current content version`);
  }
}

(async () => {
  const browser = await chromium.launch({headless:true,
    ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const errors = [], httpErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', res => {if (res.status() >= 400) httpErrors.push(`${res.status()} ${res.url()}`);});
    await page.goto(`${base}/#scene=home_repair&stage=establish_c25&filter=all&n=1&c=1`);
    await page.waitForFunction(() => state.data?.id === 'home_repair' && state.positions.native === 1);
    assert.deepEqual(await page.locator('#native .tool-outcome').allTextContents(), Array(3).fill('操作说明已加载'));
    assert.equal(await page.locator('#native .step-title').textContent(),'读取 3 份操作说明');
    assert.match(await page.locator('#native .tool-call').first().textContent(), /智能家居（smart-home）/);
    assert.equal(await page.locator('#claw .screen-wrap img').count(),0,'Do not show the first future observation at the opening input');
    await page.locator('#native .raw-step > summary').click();
    await page.locator('#native .action-card').first().getByText('工具返回',{exact:true}).click();
    assert.match(await page.locator('#native .action-card').first().textContent(), /<skill_content name="smart-home">/);

    const checks = await page.evaluate(async () => {
      let steps = 0, calls = 0, skills = 0, tasks = 0, guides = 0;
      const problems = [];
      for (const {id} of state.catalog) {
        await loadCase(id);
        if (state.data.id !== id) throw new Error(`Failed to load ${id}`);
        for (const stage of state.data.stages) {
          selectStage(stage.id);
          for (const key of ['native','claw']) {
            const list = filtered(key);
            for (let i = 0; i < list.length; i++) {
              state.positions[key] = i;
              try { renderLane(key); } catch (error) { problems.push(`${id}/${key}/${list[i].index}: ${error.message}`); continue; }
              const lane = document.querySelector(`#${key}`);
              for (const node of lane.querySelectorAll('.tool-outcome,.calendar-field')) {
                if (/没有关联的返回记录|错误 200|undefined|Invalid Date|NaN/.test(node.textContent)) problems.push(`${id}/${key}/${list[i].index}: ${node.textContent}`);
              }
              for (const node of lane.querySelectorAll('.tool-argument')) if (/^(房间|类型)：null$/.test(node.textContent)) problems.push(node.textContent);
              if (key === 'native') {
                calls += lane.querySelectorAll('.tool-call').length;
                skills += [...lane.querySelectorAll('.tool-outcome')].filter(n => n.textContent === '操作说明已加载').length;
              }
              for (const record of lane.querySelectorAll('.recorded-record')) if (record.children.length < 2) problems.push(`${id}/${key}/${list[i].index}: empty readback`);
              steps++;
            }
          }
          await new Promise(requestAnimationFrame);
        }
        for (const task of state.data.tasks) {
          selectTask(task.task_id);
          if (!visibleStages().length || !document.querySelector(`[data-task="${task.task_id}"][aria-pressed="true"]`)) problems.push(`${id}: inaccessible task ${task.task_id}`);
          tasks++;
        }
        selectTask('all');
        for (const guide of state.guides[id] || []) {
          [...document.querySelectorAll('.replay-jump')].find(b => b.textContent === guide.title).click();
          if (filtered('native')[state.positions.native]?.index !== guide.native || (guide.claw !== null && filtered('claw')[state.positions.claw]?.index !== guide.claw)) problems.push(`${id}: misplaced guide ${guide.title}`);
          guides++;
        }
      }
      return {steps,calls,skills,tasks,guides,problems};
    });
    assert.deepEqual(checks.problems,[]);
    assert.equal(checks.steps,1521); assert.equal(checks.calls,418); assert.equal(checks.skills,51);
    assert.equal(checks.tasks,21); assert.equal(checks.guides,14);

    async function show(id, index) {
      await page.evaluate(async ({id,index}) => {
        await loadCase(id);
        const target = state.data.lanes.native.steps.find(s => s.index === index);
        selectStage(target.stage);
        state.positions.native = filtered('native').findIndex(s => s.index === index);
        renderLane('native'); syncHash();
      },{id,index});
    }
    await show('home_repair',4);
    const query = await page.evaluate(() => state.data.lanes.native.steps.find(s => s.actions?.some(a => a.arguments?.room === null)).index);
    await show('home_repair',query);
    assert.match(await page.locator('#native .tool-call').textContent(), /查询全部设备[\s\S]*返回 13 台设备/);
    assert.doesNotMatch(await page.locator('#native .tool-call').textContent(), /null/);
    await show('airport_coordination',5);
    assert.match(await page.locator('#native .recorded-readback').textContent(), /未找到匹配的日历事件/);
    await show('evening_errands',29);
    assert.equal(await page.locator('#native .recorded-record').count(),2);
    assert.equal(await page.locator('#native .readback-value').filter({hasText:'无记录（0 条）'}).count(),2);
    await show('evening_errands',31);
    assert.match(await page.locator('#native .recorded-readback').textContent(), /TravelCore/);
    await show('cross_district_course',4);
    assert.match(await page.locator('#native .recorded-readback').textContent(), /40分钟/);
    await show('evening_errands',98);
    assert.match(await page.locator('#native .tool-outcome').textContent(), /界面已变化，操作未执行/);
    assert.match(await page.locator('#native .screen-transcript').textContent(), /操作失败后重新观察的界面文字[\s\S]*Wallet/);
    const output = process.env.QA_OUTPUT || '/tmp/osnative-web-qa/display-audit';
    fs.mkdirSync(output,{recursive:true});
    for (const width of [320,390,1440]) {
      await page.setViewportSize({width,height:1000});
      for (const [id,index] of [['home_repair',2],['home_repair',query],['airport_coordination',5],['evening_errands',29],['evening_errands',98]]) {
        await show(id,index);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}/${id}/${index}`);
        if (width === 1440 || (width === 390 && index === 2)) await page.screenshot({path:path.join(output,`${id}-${index}-${width}.png`),fullPage:true});
      }
    }
    assert.deepEqual(errors,[]); assert.deepEqual(httpErrors,[]);
    console.log(JSON.stringify({passed:true,...checks,viewportChecks:15,browserErrors:errors,httpErrors},null,2));
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
