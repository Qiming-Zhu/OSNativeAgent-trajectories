const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const observations = require('../observations.js');
const root = path.join(__dirname, '..');
const missing = '没有关联的返回记录';
let checked = 0, skills = 0;

for (const {id} of JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json')))) {
  const lane = JSON.parse(fs.readFileSync(path.join(root, 'data', id + '.json'))).lanes.native;
  for (const step of lane.steps) for (const action of step.actions || []) {
    const record = step.results?.find(result => result.call_id === action.call_id);
    const call = observations.toolCall(action, step.results);
    if (record) assert.notEqual(call.outcome, missing, `${id} / step ${step.index} / ${action.name}`);
    else assert.equal(call.outcome, missing);
    if (action.name === 'skill' && record?.text.startsWith('<skill_content ')) {
      assert.equal(call.outcome, '操作说明已加载');
      skills++;
    }
    checked++;
  }
}

const action = {name:'test_tool', arguments:{}, call_id:'expected'};
for (const text of ['ordinary text', '0', 'false', 'null', '""']) {
  assert.notEqual(observations.toolCall(action, [{call_id:'expected', text}]).outcome, missing);
}
assert.equal(observations.toolCall(action, []).outcome, missing);
assert.equal(observations.toolCall(action, [{call_id:'different',text:'text'}]).outcome, missing);
assert.equal(observations.toolCall(action, [{call_id:'expected',text:''}]).outcome, '返回内容为空');
assert.equal(observations.toolCall(action, [{call_id:'expected',text:'{"status":"error"}'}]).outcome, '返回：error');
const skill = {...action,name:'skill',arguments:{name:'smart-home'}};
assert.notEqual(observations.toolCall(skill, [{call_id:'expected',text:'Skill not found'}]).outcome, '操作说明已加载');
console.log(`PASS: ${checked} recorded calls, including ${skills} skill returns; missing, empty, text, scalar and error responses remain distinct.`);
