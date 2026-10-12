/* Presentation-only evidence projection. Never predicts state from a requested action. */
"use strict";
const Observations = (() => {
  const one = value => Array.isArray(value) && value.length === 1 ? value[0] : value;
  const parse = value => { try { return JSON.parse(value); } catch { return null; } };
  function collect(steps) {
    const devices = new Map(), monitors = new Map();
    for (const step of steps) {
      for (const action of step.actions || []) {
        const result = parse(step.results?.find(r => r.call_id === action.call_id)?.text);
        if (result?.status !== "success") continue;
        if (/^app_smarthome_(get_device_details|get_devices_info)_/.test(action.name) && one(result.data?.code) === 0) {
          for (const group of result.data.data || []) for (const item of group.items || []) {
            const id = one(item.deviceId), value = parse(one(item.state_json));
            if (!id || !value || typeof value !== "object") continue;
            const old = devices.get(id);
            devices.set(id, {id, name: `${one(item.roomName)} · ${one(item.deviceName)}`, value,
              previous: old?.value, index: step.index, session: step.session});
          }
        }
        const data = result.data;
        if (action.name === "os_monitor_register" && data?.monitor_id) {
          monitors.set(data.monitor_id, {id: data.monitor_id, session: step.session,
            name: data.package_name || data.source, state: data.enabled ? "已注册" : "未启用", index: step.index});
        }
        const removals = [...(result.monitor_cleanup || [])];
        if (action.name === "os_monitor_remove") removals.push(result);
        for (const removal of removals) {
          if (removal.status === "success" && removal.data?.removed === true) {
            const monitor = monitors.get(removal.data.monitor_id);
            if (monitor) Object.assign(monitor, {state: "已撤销", index: step.index});
          }
        }
      }
      // Only explicitly recorded matched IDs indicate a trigger.
      function hits(value) {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value.matched_monitor_ids)) for (const id of value.matched_monitor_ids) {
          const monitor = monitors.get(id);
          if (monitor && monitor.state !== "已撤销") Object.assign(monitor, {state: "已触发", index: step.index});
        }
        for (const child of Object.values(value)) if (child && typeof child === "object") hits(child);
      }
      hits(step.details);
    }
    return {devices: [...devices.values()], monitors: [...monitors.values()]};
  }
  function title(step) {
    if (step.actions?.length === 1 && step.actions[0].name === 'call_device_tool') {
      const name = step.actions[0].arguments.toolName;
      return ({search_calendar_event:'读取日历记录',create_calendar_event:'创建日历事件',modify_calendar_event:'更新日历事件',delete_calendar_event:'取消日历事件',search_notes:'查询笔记',create_note:'创建笔记',modify_note:'更新笔记',send_message:'发送短信'})[name] || name;
    }
    const names = {os_search_tools: "查找可用能力", os_task_list: "查看委托列表", os_session_read: "回看相关会话", system_apps_list: "查看手机应用", system_app_open: "打开手机应用", gui_scroll: "滚动手机页面", get_contact_tool_schema: "查看操作接口", os_task_create: "保存委托与后续条件", os_task_read: "取回之前的委托", os_task_update: "更新委托进度", os_monitor_register: "注册变化监听", os_monitor_remove: "撤销监听", os_monitor_list: "检查已注册监听", notify_user: "向用户发送通知", ask_user_question: "向用户确认具体要求", gui_observe: "查看手机页面", gui_click: "点击手机页面", gui_set_text: "在手机中输入文字", skill: "读取操作说明"};
    if (!step.actions?.length) {
      const action = step.details?.action;
      const gui = {open_app: "打开应用", click: "点击页面", scroll: "滚动页面", drag: "拖动控件", navigate_back: "返回上一页", wait: "等待页面响应"};
      if (action && gui[action.action_type]) return gui[action.action_type] + (action.app_name ? `：${action.app_name}` : "");
      const planner = {"agent.file.append": "补充工作记录", "agent.file.read": "读取工作记录", "agent.file.write": "保存工作记录", "agent.send_message": "向用户回复", "agent.end_task": "结束当前处理", "agent.get_device_screen": "查看手机画面", "agent.do_with_device": "执行手机操作", "agent.infer_from_last_trajectory": "回看上次操作"};
      return planner[step.title] || step.title;
    }
    return (step.actions || []).map(a => names[a.name] || (/get_devices_info/.test(a.name) ? "查询设备列表" : /get_device_details/.test(a.name) ? "读取 App 中的设备状态" : /get_device_messages/.test(a.name) ? "检查设备提醒" : /control_device/.test(a.name) ? `请求设备操作：${({power_on:"打开",power_off:"关闭",set_brightness:"调整亮度",lock:"上锁"})[a.arguments.action] || a.arguments.action}` : a.name)).join(" · ") || step.title;
  }
  function explain(step) {
    const lines = [];
    for (const action of step.actions || []) {
      const result = parse(step.results?.find(r => r.call_id === action.call_id)?.text);
      if (/^app_smarthome_control_device_/.test(action.name) && result?.status === "success" && one(result.data?.code) === 0) {
        for (const item of result.data.data || []) {
          if (one(item.success) === true) lines.push(`App 已确认执行成功（版本 ${one(item.resource_version)}）；设备状态以随后读取为准。`);
          else if (one(item.success) === false) lines.push(`App 未执行成功：${one(item.reason) || "未提供原因"}`);
        }
      }
      if (/^app_smarthome_get_devices_info_/.test(action.name) && result?.status === "success" && one(result.data?.code) === 0) {
        const groups = result.data.data || [];
        const counts = groups.map(g => one(g.count));
        if (!counts.length || counts.some(n => !Number.isInteger(n))) continue;
        const count = counts.reduce((a,b) => a+b,0);
        const filters = [action.arguments.device_type && `类型 ${action.arguments.device_type}`, action.arguments.room && `房间 ${action.arguments.room}`].filter(Boolean);
        lines.push(`${filters.length ? "筛选：" + filters.join("、") : "查询全部设备"}；返回 ${count} 台${count === 0 ? "。仅表示本次查询没有匹配项。" : "。"}`);
        const lamps = groups.flatMap(g => g.items || []).filter(i => one(i.deviceName) === "Bedside Lamp");
        if (lamps.length) lines.push(lamps.map(i => `${one(i.roomName)} 的 ${one(i.deviceName)}（${one(i.deviceType)}）`).join("；"));
      }
      if (action.name === "ask_user_question" && Array.isArray(result?.answers)) {
        for (const answer of result.answers) {
          const text = answer.custom || (answer.selected || []).join("、");
          if (text) lines.push(`用户确认：${text}`);
        }
      }
    }
    return lines.join("\n");
  }
  function toolCall(action, results) {
    const result = parse(results?.find(r => r.call_id === action.call_id)?.text);
    const args = action.arguments || {};
    const parameters = Object.entries(args).filter(([k]) => !['markdown','summary','expected_version','expected_revision','task_ids'].includes(k));
    const code = one(result?.data?.code ?? result?.data?.details?.code);
    const rows = Array.isArray(result?.data?.data) ? result.data.data : [];
    let outcome = result ? `返回：${result.status || '已收到'}` : '没有关联的返回记录';
    if (result?.status === 'success') {
      if (code !== undefined && code !== 0) outcome = `App 返回错误 ${code}：${one(result.data.message) || ''}`;
      else if (rows.some(r => one(r.success) === false)) outcome = `App 未执行：${one(rows.find(r => one(r.success) === false).reason) || '未提供原因'}`;
      else if (rows.some(r => one(r.success) === true)) outcome = 'App 确认执行成功';
      else if (rows.length && rows.every(r => Number.isInteger(one(r.count)))) outcome = `返回 ${rows.reduce((n,r) => n + one(r.count),0)} 条记录`;
      else if (action.name === 'os_monitor_register') outcome = result.data?.enabled ? '监听已注册并启用' : '监听已注册，未启用';
      else if (action.name === 'os_task_create' || action.name === 'os_task_update') outcome = `委托状态：${({active:'进行中',completed:'已完成',cancelled:'已取消'})[result.data?.status] || result.data?.status || '已保存'}`;
      else if (action.name === 'os_monitor_remove') outcome = result.data?.removed === true ? '监听已撤销' : '返回成功，未确认撤销';
      else outcome = '工具返回成功';
    }
    const business = result?.data?.details?.result;
    if (business && ['failed', 'error', 'rejected'].includes(one(business.status))) outcome = `操作未完成：${one(business.error) || one(business.status)}`;
    return {name: action.name === 'call_device_tool' ? args.toolName : action.name,
      parameters: action.name === 'call_device_tool' ? Object.entries(args.arguments || {}) : parameters, outcome};
  }
  function mode(step) {
    if (step?.kind === 'gui' || step?.actions?.some(a => a.name.startsWith('gui_') || a.name === 'system_app_open')) return 'gui';
    if (step?.actions?.some(a => a.name.startsWith('app_') || a.name === 'call_device_tool')) return 'native';
    return 'context';
  }
  function records(step) {
    const collected = [];
    for (const action of step?.actions || []) {
      if (!action.name.startsWith('app_') && action.name !== 'call_device_tool') continue;
      const result = parse(step.results?.find(r => r.call_id === action.call_id)?.text);
      if (!result) continue;
      const data = result.data?.details?.result ?? result.data?.data;
      if (!data) continue;
      const unwrap = value => Array.isArray(value) ? (value.length === 1 ? unwrap(value[0]) : value.map(unwrap)) :
        value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k, unwrap(v)])) : value;
      collected.push({name: action.arguments?.toolName || action.name.replace(/_[a-f0-9]{8}$/, ''), data: unwrap(data)});
    }
    return collected;
  }
  return {collect, title, explain, toolCall, mode, records};
})();
if (typeof module !== "undefined") module.exports = Observations;
