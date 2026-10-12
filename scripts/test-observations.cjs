const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const observations = require('../observations.js');
const root = path.join(__dirname, '..');
const missing = '没有关联的返回记录';
let checked = 0, skills = 0, ticketQueries = 0, nested = 0, noNotes = 0, failures = 0;

for (const {id} of JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json')))) {
  const lane = JSON.parse(fs.readFileSync(path.join(root, 'data', id + '.json'))).lanes.native;
  for (const step of lane.steps) for (const action of step.actions || []) {
    const record = step.results?.find(result => result.call_id === action.call_id);
    const call = observations.toolCall(action, step.results);
    let result; try { result = JSON.parse(record?.text); } catch {}
    if (record) assert.notEqual(call.outcome, missing, `${id} / step ${step.index} / ${action.name}`);
    else assert.equal(call.outcome, missing);
    if (action.name === 'skill' && record?.text.startsWith('<skill_content ')) {
      assert.equal(call.outcome, '操作说明已加载');
      skills++;
    }
    if (action.name.startsWith('app_ticketbooking_') && result?.data?.code?.[0] === 200) {
      assert.match(call.outcome, /^返回 \d+ 条记录$/);
      assert.equal(call.tone, 'success'); ticketQueries++;
    }
    if (result?.data?.result_json) {
      const records = observations.records({...step,actions:[action]});
      assert.equal(records.length, 1, `${id} / step ${step.index}: nested return is visible`);
      assert(records[0].data !== undefined); nested++;
    }
    if (action.arguments?.toolName === 'search_notes' && result?.data?.details?.retErrCode === '-101') {
      assert.equal(call.outcome, '未找到匹配的笔记'); noNotes++;
    }
    if (['denied','stale_observation'].includes(result?.status)) {
      assert.equal(call.tone, 'error');
      assert(call.outcome.includes(result.error.message)); failures++;
    }
    if (action.name.startsWith('app_smarthome_get_devices_info_') && action.arguments.room === null) {
      assert.deepEqual(call.parameters, []);
      assert.equal(call.description, '查询全部设备');
      assert.equal(call.outcome, '返回 13 台设备');
      assert.equal(action.arguments.room, null, 'Original parameters remain intact');
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
assert.equal(observations.toolCall(action, [{call_id:'expected',text:'{"status":"error"}'}]).outcome, '工具返回错误');
const skill = {...action,name:'skill',arguments:{name:'smart-home'}};
assert.notEqual(observations.toolCall(skill, [{call_id:'expected',text:'Skill not found'}]).outcome, '操作说明已加载');
assert.equal(ticketQueries, 22); assert.equal(nested, 14); assert.equal(noNotes, 3); assert.equal(failures, 5);
const summarize = (name, result) => observations.toolCall({...action,name}, [{call_id:'expected',text:JSON.stringify(result)}]);
assert.match(summarize('app_ticketbooking_flight_test', {status:'success',data:{code:[500],message:['unavailable']}}).outcome, /错误 500.*unavailable/);
assert.equal(summarize('app_smarthome_control_device_test', {status:'success',data:{code:[0],data:[{success:[false],reason:['offline']}]}}).tone, 'error');
assert.equal(summarize('os_monitor_remove', {status:'success',data:{removed:false}}).outcome, '返回成功，未确认撤销');
assert.equal(summarize('test', {status:'denied',error:{message:'blocked'},data:{details:{result:{status:'succeeded'}}}}).tone, 'error');
assert.equal(summarize('call_device_tool', {status:'success',data:{details:{retErrCode:'-101',errMsg:'invalid arguments'}}}).tone, 'error');
console.log(`PASS: ${checked} recorded calls; ${skills} skills, ${ticketQueries} TicketBooking successes, ${nested} nested returns, ${noNotes} empty note queries, ${failures} failed actions; null filters and original parameters checked.`);
