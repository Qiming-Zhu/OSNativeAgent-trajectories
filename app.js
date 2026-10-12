/* Read-only static viewer. Trace content is always rendered as text, never HTML. */
"use strict";
const $ = (selector, root = document) => root.querySelector(selector);
const state = {catalog: [], guides: {}, data: null, stage: null, task: "all", positions: {native: 0, claw: 0}, filter: "all", timer: null, loading: 0};
const kinds = {native: "NATIVE STEP", planner: "PLANNER", result: "TOOL RESULT", gui: "GUI ACTION", input: "INPUT", reply: "REPLY", question: "ASK USER", status: "STATUS"};
const prefetched = new Set();
function preloadFrames(lane, index) {
  for (const step of lane.steps.filter(s => s.index > index && s.image).slice(0, 3)) {
    if (prefetched.has(step.image)) continue;
    prefetched.add(step.image);
    const image = new Image(); image.src = step.image;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function pretty(value) { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }
function details(title, value, className = "trace-details") {
  const node = el("details", className);
  node.append(el("summary", "", title), el("pre", "", pretty(value)));
  return node;
}
function button(text, className, fn, label) {
  const node = el("button", className, text);
  node.type = "button";
  if (label) node.setAttribute("aria-label", label);
  node.addEventListener("click", fn);
  return node;
}
async function fetchJSON(path) {
  const result = await fetch(path);
  if (!result.ok) throw new Error(`${path}: HTTP ${result.status}`);
  return result.json();
}
function matchesTask(step) {
  if (state.task === "all") return true;
  const a = step.task_attribution || {};
  return (a.task_ids?.length ? a.task_ids : a.context_task_ids || []).includes(state.task);
}
function groupOpeningEvents(data) {
  for (const group of data.stage_groups || []) {
    const members = group.members.map(id => data.stages.find(s => s.id === id));
    if (members.some(s => !s) || !group.members.includes(group.id)) throw new Error("无效的事件展示分组");
    // This grouping adds background to an existing action stage. It must not
    // silently move recorded actions to another stage or change task ownership.
    if (Object.values(data.lanes).some(l => l.steps.some(s => s.stage !== group.id && group.members.includes(s.stage)))) throw new Error("背景事件已有动作，不能隐式合并步骤");
    const target = members.find(s => s.id === group.id);
    const merged = {...target, display_title: group.title, source_events: members,
      display_time: `${members[0].at.slice(11, 16)}–${members.at(-1).at.slice(11, 16)}`};
    const first = data.stages.findIndex(s => s.id === group.members[0]);
    data.stages = data.stages.filter(s => !group.members.includes(s.id));
    data.stages.splice(first, 0, merged);
  }
}
function visibleStages() {
  return state.data.stages.filter(node => state.task === "all" || Object.values(state.data.lanes).some(lane => lane.steps.some(s => s.stage === node.id && matchesTask(s))));
}
function selectTask(id) {
  stop(); state.task = id; state.filter = "all"; $("#filter").value = "all";
  state.stage = visibleStages()[0]?.id || state.data.stages[0].id;
  state.positions = {native: 0, claw: 0};
  renderStages(); renderLane("native"); renderLane("claw"); syncHash();
}
function renderTasks() {
  const tasks = state.data.tasks || [], root = $("#tasks"); root.replaceChildren();
  $("#task-count").textContent = `1 个场景 · ${tasks.length} 个任务`;
  for (const task of [{task_id:"all",title:"完整场景"}, ...tasks]) {
    const b = button(task.task_id === "all" ? task.title : `${task.task_id.replace("v4_", "").toUpperCase()} · ${task.title}`, `task-tab${state.task === task.task_id ? " active" : ""}`, () => selectTask(task.task_id));
    b.setAttribute("aria-pressed", String(state.task === task.task_id)); b.dataset.task = task.task_id;
    root.append(b);
  }
  const selected = tasks.find(t => t.task_id === state.task);
  $("#task-request").hidden = !selected;
  $("#task-request").textContent = selected ? selected.request : "选择任务，沿时间线查看它的委托、后续变化与相关步骤；也可查看完整场景。";
}
function taskBadges(step) {
  const root = el("div", "task-badges"), a = step.task_attribution || {};
  const exact = a.task_ids || [], ids = exact.length ? exact : a.context_task_ids || [];
  for (const id of ids) {
    const task = state.data.tasks?.find(t => t.task_id === id);
    const label = `${id.replace("v4_", "").toUpperCase()} · ${task?.title || id}${exact.length ? "" : " · 相关上下文"}`;
    const b = button(label, `task-badge${exact.length ? "" : " contextual"}`, () => selectTask(id));
    b.title = exact.length ? (a.basis === "query_session" ? "原始委托与 session_id 对应" : "原始用户委托文本精确对应") : "场景事件声明的关联，不作为动作独占归属";
    root.append(b);
  }
  return root;
}
function filtered(key) {
  return state.data.lanes[key].steps.filter(step => step.stage === state.stage && matchesTask(step) &&
    (state.filter === "all" || (state.filter === "actions" ? ["native", "planner", "gui"].includes(step.kind) :
      ["input", "reply", "question"].includes(step.kind) || (step.kind === "native" && step.message))));
}
function syncHash() {
  const params = new URLSearchParams({scene: state.data.id, stage: state.stage, filter: state.filter,
    n: String(state.positions.native), c: String(state.positions.claw)});
  if (state.task !== "all") params.set("task", state.task);
  history.replaceState(null, "", `${location.pathname}${location.search}#${params}`);
}
function stageLabel(node) {
  if (node.display_title) return node.display_title;
  const highlight = state.data.highlights.find(h => h.stage === node.id);
  if (highlight) return highlight.title;
  if (state.data.stage_titles?.[node.id]) return state.data.stage_titles[node.id];
  if (node.message) return node.message.slice(0, 21) + (node.message.length > 21 ? "…" : "");
  const parameters = node.inject?.[0]?.parameters;
  if (parameters) {
    const content = parameters.content || parameters.body;
    if (content) return content.slice(0, 23) + (content.length > 23 ? "…" : "");
  }
  return node.label;
}
function nodeContext(node) {
  if (node.source_events) return node.source_events.map(event => `${event.at.slice(11,16)} · ${event.kind === "user_turn" ? "用户委托" : "短信背景"}\n${nodeContext(event)}`).join("\n\n");
  if (node.message) return node.message;
  if (state.data.stage_contexts?.[node.id]) return state.data.stage_contexts[node.id];
  return (node.inject || []).map(item => {
    const p = item.parameters;
    if (p.content || p.body) return `${p.sender_name ? `${p.sender_name}：` : ""}${p.content || p.body}`;
    return `${item.template}\n${pretty(p)}`;
  }).join("\n\n") || "场景时间推进。";
}
function renderStages() {
  renderTasks();
  const root = $("#stages"); root.replaceChildren();
  $("#stage-count").textContent = `${visibleStages().length} EVENTS`;
  visibleStages().forEach(node => {
    const active = node.id === state.stage;
    const b = button("", `stage${active ? " active" : ""}${state.data.highlights.some(h => h.stage === node.id) ? " highlighted" : ""}`, () => selectStage(node.id));
    b.dataset.stage = node.id;
    b.setAttribute("aria-current", active ? "step" : "false");
    b.title = node.id;
    b.append(el("span", "time", node.source_events ? node.source_events[0].at.slice(11, 16) : node.at.slice(11, 16)), el("span", "stage-label", stageLabel(node)));
    root.append(b);
  });
  const node = state.data.stages.find(n => n.id === state.stage);
  $("#stage-tag").textContent = `${node.display_time || node.at.slice(11, 16)} · ${node.source_events ? "消息与用户委托" : node.kind === "user_turn" ? "用户委托" : "环境事件"}`;
  $("#stage-title").textContent = stageLabel(node);
  $("#stage-context").textContent = nodeContext(node);
  $("#stage-context").classList.toggle("combined-context", Boolean(node.source_events));
  $("#stage-raw").textContent = pretty(node.source_events || {id: node.id, at: node.at, kind: node.kind, ...(node.message ? {message: node.message} : {inject: node.inject})});
  const highlightRoot = $("#highlights"); highlightRoot.replaceChildren();
  if (state.guides[state.data.id]) {
    for (const {title: label, native: index, claw: clawIndex} of state.guides[state.data.id]) {
      const target = state.data.lanes.native.steps.find(s => s.index === index);
      highlightRoot.append(button(label, "highlight replay-jump", () => {
        state.filter = "all"; state.task = 'all'; $("#filter").value = "all";
        selectStage(target.stage);
        state.positions.native = filtered("native").findIndex(s => s.index === index);
        const candidates = filtered("claw");
        const imageIndex = candidates.findIndex(s => s.index === clawIndex);
        state.positions.claw = Math.max(0, imageIndex);
        renderLane("native"); renderLane("claw"); syncHash();
      }));
    }
  }

  state.data.highlights.forEach((h, i) => {
    const b = button(`${String(i + 1).padStart(2, "0")}  ${h.title}`, `highlight${h.stage === state.stage ? " active" : ""}`, () => selectStage(h.stage));
    b.title = h.note;
    highlightRoot.append(b);
  });
}
function openImage(path) {
  $("#full-image").src = path;
  $("#image-dialog").showModal();
}
function renderImage(step) {
  const figure = el("figure", "screen-figure");
  if (!step.image) {
    figure.append(el("div", "no-image", "该动作的截图未保留或未能关联。"));
    return figure;
  }
  const wrap = el("div", "screen-wrap");
  const image = el("img"); image.src = step.image; image.alt = `${step.title} · ${step.image_role}`;
  image.addEventListener("error", () => wrap.replaceChildren(el("div", "image-failed", "截图加载失败，请检查 assets 文件。")));
  wrap.tabIndex = 0; wrap.setAttribute("role", "button"); wrap.setAttribute("aria-label", "放大截图");
  wrap.addEventListener("click", () => openImage(step.image));
  wrap.addEventListener("keydown", event => { if (event.key === "Enter") openImage(step.image); });
  wrap.append(image);
  if (step.point && step.image_capture_kind !== "continuous_action_replay") {
    const dot = el("span", "tap"); dot.style.left = `${step.point[0] * 100}%`; dot.style.top = `${step.point[1] * 100}%`; wrap.append(dot);
  }
  figure.append(wrap);
  return figure;
}
function renderVisual(key, step) {
  const all = state.data.lanes[key].steps;
  preloadFrames(state.data.lanes[key], step?.index || 0);
  const stageIndex = state.data.stages.findIndex(s => s.id === state.stage);
  const past = step ? all.filter(s => s.index <= step.index) : all.filter(s => state.data.stages.findIndex(n => n.id === s.stage) < stageIndex);
  const lane = state.data.lanes[key];
  const outsideCapture = lane.capture_available_through_step !== undefined &&
    (step?.index || past.at(-1)?.index || 0) > lane.capture_available_through_step;
  const lastImage = outsideCapture ? null : past.findLast(s => s.image) || lane.initial_image;
  const visual = el("section", "visual-stage");
  const mode = Observations.mode(step);
  visual.append(el('p', 'capture-label', key === 'native' && mode !== 'gui' ? '前台画面 · 原生操作无需切换页面' : '手机画面'));
  if (lastImage) {
    const retained = lastImage !== step;
    const shown = retained ? {...lastImage, point: null} : lastImage;
    visual.append(renderImage(shown));
    visual.dataset.imageStep = String(lastImage.index);
    visual.dataset.captureKind = lastImage.image_capture_kind || "archived";
    visual.dataset.retained = String(retained);
    const captureNames = {continuous_action_replay: '保存动作回放采集', archived_after_action: '原运行 · 动作后截图', archived_observation: '原运行 · 最近观察', verified_prefix_replay: '保存动作回放补采', verified_action_replay: '保存动作回放采集'};
    visual.append(el('p', 'capture-source', `${captureNames[lastImage.image_capture_kind] || '保存的手机截图'} · Step ${lastImage.index}${retained ? ' · 沿用最近画面' : ''}`));
  } else {
    visual.append(el("p", "capture-pending", outsideCapture ? "此步骤没有核对通过的补采截图。下方为原运行记录的界面文字。" : "此步骤没有手机截图；动作与状态以原运行记录为准。"));
    if (mode === 'gui') {
      const texts = new Set();
      for (const action of step?.actions || []) {
        if (!action.name.startsWith('gui_')) continue;
        let result; try { result = JSON.parse(step.results?.find(r => r.call_id === action.call_id)?.text); } catch { continue; }
        for (const item of result?.data?.nodes || []) if (item.text) texts.add(item.text);
      }
      if (texts.size) {
        const transcript = el('div', 'screen-transcript');
        transcript.append(el('h5', '', '原运行界面文字'));
        for (const text of texts) transcript.append(el('p', '', text));
        visual.append(transcript);
      } else if (outsideCapture) visual.lastChild.textContent = '此步骤没有核对通过的补采截图；原运行的动作与返回仍可查看。';
    }
    if (key === 'native' && mode !== 'gui') visual.hidden = true;
  }

  const evidence = Observations.collect(past);
  const panel = el("div", "state-panel");
  const explanation = step && Observations.explain(step);
  if (explanation) panel.append(el("p", "query-explanation", explanation));
  if (step?.replay?.state && Object.keys(step.replay.state).length) {
    const card = el("div", "replay-state");
    card.append(el("b", "", "当前 App 状态"));
    for (const [k,v] of Object.entries(step.replay.state).filter(([k]) => ["power","brightness","locked","target_c","mode"].includes(k))) {
      const label = {power:"电源",brightness:"亮度",locked:"门锁",target_c:"温度",mode:"模式"}[k];
      card.append(el("div", "state-value", `${label}：${({on:"开启",off:"关闭",true:"已锁",false:"未锁"})[v] || v}${k === "brightness" ? "%" : ""}`));
    }
    panel.append(card);
  }
  const selectedIds = new Set((step?.actions || []).map(a => a.arguments?.device_id).filter(Boolean));
  const currentSession = step?.session || step?.details?.session_id;
  const devices = evidence.devices.filter(d => selectedIds.size ? selectedIds.has(d.id) : !currentSession || d.session === currentSession).sort((a,b) => b.index-a.index).slice(0,2);
  for (const device of devices) {
    const card = el("div", "state-device"); card.append(el("strong", "", device.name));
    if (typeof device.value.brightness === "number" && ["on", "off"].includes(device.value.power)) {
      const lamp = el("div", `lamp-state ${device.value.power}`);
      const bulb = el("span", "lamp-bulb", "●"); bulb.setAttribute("aria-hidden", "true");
      bulb.style.setProperty("--brightness", String(Math.max(0, Math.min(100, device.value.brightness)) / 100));
      lamp.append(bulb, el("span", "", device.value.power === "on" ? `${device.value.brightness}%` : "已关闭"));
      card.append(lamp);
    }
    const labels = {power:"电源", brightness:"亮度", locked:"门锁", battery:"电量", temperature:"温度", mode:"模式",target_c:"目标温度"};
    const format = (k,v) => ({on:"开启",off:"关闭",locked:"已锁",unlocked:"未锁"})[v] || `${v}${k === "brightness" ? "%" : ""}`;
    for (const [key,value] of Object.entries(device.value).filter(([k]) => labels[k]).slice(0,3)) {
      const old = device.previous?.[key];
      card.append(el("div", old !== undefined && old !== value ? "state-value changed" : "state-value", `${labels[key]}  ${old !== undefined && old !== value ? format(key,old) + " → " : ""}${format(key,value)}`));
    }
    card.append(el("small", "", `状态读回 · Step ${device.index}`)); panel.append(card);
  }
  const monitors = evidence.monitors.filter(m => m.session === currentSession).slice(-3);
  if (monitors.length) {
    panel.append(el("b", "monitor-heading", "监听"));
    for (const m of monitors) panel.append(el("p", "monitor-state", `${m.name.replace("com.dynamicworld.", "")} · ${m.state} · Step ${m.index}`));
  }
  const group = el("div", `visual-and-results ${key === 'native' && mode !== 'gui' ? 'background-action' : 'screen-action'}`); group.dataset.mode = mode;
  group.append(visual, panel); return group;
}
function renderReadback(step) {
  const records = Observations.records(step);
  if (!records.length) return null;
  const root = el('section', 'recorded-readback');
  root.append(el('h5', '', '原运行工具读回'));
  for (const record of records) {
    const block = el('div', 'recorded-record');
    block.append(el('code', 'readback-name', record.name));
    const data = record.data;
    if (record.name === 'search_calendar_event' && data.events) {
      const events = Array.isArray(data.events) ? data.events : [data.events];
      for (const event of events) {
        const card = el('div', 'calendar-readback');
        card.append(el('strong', '', event.title));
        const format = stamp => new Intl.DateTimeFormat('zh-CN', {timeZone: event.time_zone || 'Asia/Shanghai', month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(stamp));
        const location = typeof event.location === 'object' ? event.location?.location : event.location;
        for (const [label,value] of [['开始',format(event.start_time)],['结束',format(event.end_time)],['地点',location],['状态',event.status],['版本',event.resource_version]]) {
          const row = el('div', 'calendar-field'); row.append(el('span','',label),el('b','',String(value))); card.append(row);
        }
        card.append(el('small', 'calendar-record-id', event.event_id)); block.append(card);
      }
      root.append(block); continue;
    }
    const entries = data && !Array.isArray(data) && typeof data === 'object' ? Object.entries(data) : [['result', data]];
    for (const [key, value] of entries) {
      if (value === '' || (Array.isArray(value) && !value.length)) continue;
      const row = el('div', 'readback-row');
      row.append(el('span', 'readback-key', key), el('pre', 'readback-value', pretty(value)));
      block.append(row);
    }
    root.append(block);
  }
  return root;
}
function actionCard(action, results) {
  const card = el("div", "action-card");
  card.append(el("div", "action-name", Observations.title({actions: [action]})), details("工具名与参数", {name: action.name, arguments: action.arguments}, ""));
  const result = results?.find(r => r.call_id === action.call_id);
  if (result) {
    const text = result.text;
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    const d = details("工具返回", parsed, "");
    // Long skill instructions stay collapsed; short business results are immediately visible.
    // Raw returns stay collapsed below the visual evidence.
    card.append(d);
  } else card.append(el("p", "small muted", "未关联到该调用的返回记录。"));
  return card;
}
function visibleToolCall(action, results) {
  const call = Observations.toolCall(action, results), card = el('section', 'tool-call');
  const name = el('code', 'tool-name', call.name.replace(/_[a-f0-9]{8}$/, '')); name.title = call.name;
  card.append(name);
  const labels = {device_id:'设备',action:'操作',parameters_json:'参数',package_name:'应用',source:'来源',event_type:'事件',filter:'条件',status:'状态',title:'委托',query:'查询',device_type:'类型',room:'房间',question:'问题'};
  for (const [key,value] of call.parameters) {
    if (['task_id','monitor_id','session_id'].includes(key)) continue;
    const text = pretty(value);
    card.append(el('div','tool-argument',`${labels[key] || key}：${text.length > 240 ? text.slice(0,240) + '…' : text}`));
  }
  card.append(el('div','tool-outcome',call.outcome));
  return card;
}
function renderLane(key) {
  const root = $(`#${key}`), lane = state.data.lanes[key], steps = filtered(key);
  state.positions[key] = Math.max(0, Math.min(state.positions[key], steps.length - 1));
  const position = state.positions[key], step = steps[position];
  root.replaceChildren();
  const header = el("header", "lane-head"), names = el("div");
  names.append(el("div", "lane-name", lane.name), el("p", "lane-model", lane.model));
  header.append(names, el("span", "score-pill", `${lane.passed}/${lane.scores.length} 完成`)); root.append(header);
  const controls = el("div", "lane-controls");
  const prev = button("‹", "", () => move(key, -1), `${lane.name} 上一步`); prev.disabled = !steps.length || position === 0;
  const next = button("›", "", () => move(key, 1), `${lane.name} 下一步`); next.disabled = !steps.length || position >= steps.length - 1;
  const range = el("input"); range.type = "range"; range.min = "0"; range.max = String(Math.max(0, steps.length - 1)); range.value = String(position);
  range.disabled = !steps.length; range.setAttribute("aria-label", `${lane.name} 步骤`);
  range.addEventListener("input", () => { stop(); state.positions[key] = Number(range.value); renderLane(key); syncHash(); });
  controls.append(prev, next, range, el("span", "step-count", steps.length ? `${position + 1} / ${steps.length}` : "0 / 0")); root.append(controls);
  const strip = el("div", "step-strip"); strip.setAttribute("aria-label", `${lane.name} Step 时间线`);
  steps.forEach((s, i) => {
    const b = button(String(s.index).padStart(2, "0"), `step-chip${i === position ? " active" : ""}`, () => { stop(); state.positions[key] = i; renderLane(key); syncHash(); }, `Step ${s.index}: ${s.title}`);
    b.title = `${kinds[s.kind]} · ${s.title}`; b.setAttribute("aria-current", i === position ? "step" : "false"); strip.append(b);
  }); root.append(strip);
  const content = el("div", "lane-content");
  const visual = renderVisual(key, step);
  content.append(visual); root.append(content);
  if (!step) {
    const empty = el("div", "empty"), copy = el("div");
    copy.append(el("b", "", "此事件无执行记录"));
    empty.append(copy); content.prepend(empty); return;
  }
  const body = el("div", "step-body"), meta = el("div", "step-meta");
  meta.append(el("span", "kind", `STEP ${step.index}`), el('span', 'execution-mode', ({gui: 'GUI 操作', native: '原生接口', context: '事件与任务上下文'})[Observations.mode(step)]));
  body.append(meta, el("h4", "step-title", Observations.title(step)));
  body.append(taskBadges(step));
  const rationale = step.kind === "gui" ? step.model_output?.split(/```|\nAction:/)[0]?.replace(/^Thought:\s*/, "").trim() : "";
  const stored = (step.actions || []).map(a => a.arguments?.summary || a.arguments?.question).filter(Boolean).join("\n");
  if (rationale || stored) body.append(el("p", "rationale", rationale || stored));
  const raw = el("details", "trace-details raw-step"); raw.append(el("summary", "", "动作与来源"));
  if (step.kind === "gui") {
    const grid = el("div", "gui-layout"), info = el("div");
    info.append(el("div", "action-card"));
    info.firstChild.append(el("div", "action-name", "Executed action"), el("pre", "", pretty(step.details.action)));
    info.append(details("控制器回执", step.details.receipt));
    grid.append(info); raw.append(grid);
  } else {
    if (step.message) (["planner", "result", "status"].includes(step.kind) ? raw : body).append(el("p", "step-message", pretty(step.message)));
    for (const action of step.actions || []) {
      body.append(visibleToolCall(action, step.results));
      raw.append(actionCard(action, step.results));
    }
    if (step.details) raw.append(details("事件记录", step.details));
  }
  if (step.model_output) raw.append(details("模型原始输出", step.model_output));
  raw.append(details("来源与原始步骤", {capture_stage: step.capture_stage, original_step: step.original_step,
    recorded_time: step.time, clock: step.clock, session: step.session, activation: step.activation,
    source: step.source, image_role: step.image_role, image_capture_kind: step.image_capture_kind,
    image_observation_source: step.image_observation_source, task_attribution: step.task_attribution, replay: step.replay, ...(step.image_sha256 ? {image_sha256: step.image_sha256} : {})}));
  const execution = el("div", "execution-panel");
  execution.append(body, visual.querySelector(".state-panel"));
  const readback = renderReadback(step); if (readback) execution.append(readback);
  execution.append(raw); visual.append(execution);
  const active = $(".step-chip.active", strip);
  if (active) strip.scrollLeft = active.offsetLeft - strip.offsetLeft - strip.clientWidth / 2;
}
function move(key, delta) {
  stop(); state.positions[key] += delta; renderLane(key); syncHash();
}
function advance(delta) {
  let changed = false;
  for (const key of ["native", "claw"]) {
    const n = filtered(key).length;
    const position = Math.max(0, Math.min(n - 1, state.positions[key] + delta));
    changed ||= position !== state.positions[key]; state.positions[key] = position;
    renderLane(key);
  }
  if (!changed) {
    const stages = visibleStages();
    const index = stages.findIndex(s => s.id === state.stage) + delta;
    if (index >= 0 && index < stages.length) {
      state.stage = stages[index].id;
      state.positions = {native: 0, claw: 0};
      if (delta < 0) for (const key of ["native", "claw"]) state.positions[key] = Math.max(0, filtered(key).length - 1);
      renderStages(); renderLane("native"); renderLane("claw");
      changed = true;
    }
  }
  syncHash(); return changed;
}
function stop() {
  clearInterval(state.timer); state.timer = null;
  $("#play").textContent = "▶ 播放"; $("#play").setAttribute("aria-label", "播放两侧步骤");
}
function play() {
  if (!state.data) return;
  if (state.timer) { stop(); return; }
  $("#play").textContent = "Ⅱ 暂停"; $("#play").setAttribute("aria-label", "暂停播放");
  state.timer = setInterval(() => { if (!advance(1)) stop(); }, Number($("#speed").value));
}
function selectStage(id) {
  if (!visibleStages().some(s => s.id === id)) state.task = "all";
  stop(); state.stage = id; state.positions = {native: 0, claw: 0};
  renderStages(); renderLane("native"); renderLane("claw"); syncHash();
}
function renderAbout() {
  const root = $("#about"); root.replaceChildren();
  root.append(el("p", "", "任务标签：实线表示原始委托或会话可确认的归属；虚线表示相关事件上下文，不代表独占归属。AppFunction 可改变 App 状态而不切换前台，结果以读回记录为准。"));
  root.append(el("p", "", "两侧使用 GPT-5.4 的保存轨迹，按场景事件对齐。截图来源标在画面旁；回放补采使用保存的动作，结果沿用原运行。展示步数与播放速度不用于比较执行效率。"));
  for (const note of state.data.notes || []) root.append(el("p", "", note));
  const columns = el("div", "provenance");
  for (const key of ["native", "claw"]) {
    const lane = state.data.lanes[key], column = el("div");
    column.append(el("b", "", lane.name));
    if (lane.replay_note) column.append(el("p", "", lane.replay_note));
    columns.append(column);
  }
  root.append(columns);
  const link = el("a", "", "下载当前案例数据 ↗"); link.href = `data/${state.data.id}.json`; link.download = `${state.data.id}.json`; root.append(link);
}
function renderScores() {
  const root = $("#score-table"); root.replaceChildren();
  const table = el("table"), head = el("tr");
  ["任务", "OS-native", "MobileClaw"].forEach(t => head.append(el("th", "", t))); const thead = el("thead"); thead.append(head); table.append(thead);
  const body = el("tbody");
  state.data.lanes.native.scores.forEach(score => {
    const row = el("tr"), task = el("td");
    const jump = button(score.task_id, "task-jump", () => selectTask(score.task_id)); jump.title = score.request;
    task.append(jump, el("div", "task-description", score.request.slice(0, 40) + (score.request.length > 40 ? "…" : "")));
    row.append(task);
    for (const key of ["native", "claw"]) {
      const s = state.data.lanes[key].scores.find(s => s.task_id === score.task_id);
      const cell = el("td", s?.score === 1 ? "pass" : "fail", s?.score === 1 ? "✓ 完成" : s?.score === 0 ? "未完成" : "未评分");
      cell.title = s ? `${s.source}\nSHA256 ${s.sha256}` : "未收录"; row.append(cell);
    }
    body.append(row);
  }); table.append(body); root.append(table);
}
async function loadCase(id, params = null) {
  stop(); const request = ++state.loading; $("#error").hidden = true;
  try {
    const data = await fetchJSON(`data/${id}.json`);
    if (request !== state.loading) return;
    groupOpeningEvents(data);
    state.data = data;
    state.task = data.tasks?.some(t => t.task_id === params?.get("task")) ? params.get("task") : "all";
    const firstRecordedStage = data.stages.find(s => Object.values(data.lanes).some(lane => lane.steps.some(step => step.stage === s.id)));
    const requestedStage = params?.get("stage");
    state.stage = data.stages.find(s => s.id === requestedStage || s.source_events?.some(e => e.id === requestedStage))?.id || (firstRecordedStage || data.stages[0]).id;
    if (!visibleStages().some(s => s.id === state.stage)) state.stage = visibleStages()[0]?.id || data.stages[0].id;
    state.filter = ["all", "actions", "conversation"].includes(params?.get("filter")) ? params.get("filter") : "all";
    $("#filter").value = state.filter;
    const safePosition = v => /^\d+$/.test(v || "") ? Math.min(Number(v), 1000000) : 0;
    state.positions = {native: safePosition(params?.get("n")), claw: safePosition(params?.get("c"))};
    $("#case-title").textContent = data.title;
    $('#case-description').textContent = data.description;
    $('.outcomes > summary').textContent = `查看 ${data.tasks.length} 项任务的原运行结果`;
    document.title = `${data.title} · OS-native Agents Demo`;
    document.querySelectorAll(".case-button").forEach(b => { b.classList.toggle("active", b.dataset.id === id); b.setAttribute("aria-pressed", String(b.dataset.id === id)); });
    $("#workspace").hidden = false;
    renderStages(); renderLane("native"); renderLane("claw"); renderAbout(); renderScores(); syncHash();
  } catch (error) {
    if (request !== state.loading) return;
    $("#error").textContent = `轨迹暂时无法载入，请刷新页面重试。\n${error.message}`;
    $("#error").hidden = false;
  }
}
$("#about-toggle").addEventListener("click", () => { $("#about").hidden = !$("#about").hidden; $("#about-toggle").setAttribute("aria-expanded", String(!$("#about").hidden)); });
$("#filter").addEventListener("change", () => { stop(); state.filter = $("#filter").value; state.positions = {native: 0, claw: 0}; renderLane("native"); renderLane("claw"); syncHash(); });
$("#play").addEventListener("click", play);
$("#back").addEventListener("click", () => { stop(); advance(-1); });
$("#forward").addEventListener("click", () => { stop(); advance(1); });
$("#speed").addEventListener("change", () => { if (state.timer) { stop(); play(); } });
$("#close-image").addEventListener("click", () => $("#image-dialog").close());
document.addEventListener("keydown", event => {
  if (!state.data || /INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A/.test(event.target.tagName) || $("#image-dialog").open) return;
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); stop(); advance(event.key === "ArrowRight" ? 1 : -1); }
  if (event.code === "Space") { event.preventDefault(); play(); }
});
window.addEventListener("hashchange", () => {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get("scene"); if (state.catalog.some(c => c.id === id)) loadCase(id, params);
});
(async () => {
  try {
    state.catalog = await fetchJSON("data/catalog.json");
    try { state.guides = await fetchJSON('data/viewer-guides.json'); } catch { state.guides = {}; }
    for (const [i, item] of state.catalog.entries()) {
      const b = button("", "case-button", () => loadCase(item.id)); b.dataset.id = item.id;
      const text = el("span"); text.append(el("b", "", item.title), el("small", "", item.subtitle));
      b.append(el("span", "case-number", `0${i + 1}`), text, el("span", "case-arrow", "↗")); $("#cases").append(b);
    }
    const params = new URLSearchParams(location.hash.slice(1));
    const id = state.catalog.some(c => c.id === params.get("scene")) ? params.get("scene") : state.catalog[0].id;
    await loadCase(id, params);
  } catch (error) { $("#error").hidden = false; $("#error").textContent = `轨迹暂时无法载入，请刷新页面重试。\n${error.message}`; }
})();
