#!/usr/bin/env python3
"""Build an offline, source-bound showcase. Never imports a runner or scorer.

Only subject trace projections are read from evaluator snapshots. World inputs
are separate context, and saved adopted verdicts are separate evaluation data.
"""
from __future__ import annotations

import argparse
import os
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil

ROOT = Path(os.environ.get('OSNATIVE_SOURCE_ROOT', Path(__file__).resolve().parents[2] / 'osnativeagent')).resolve()
VIEWER = ROOT / "trajectory_viewer"


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def clean(value):
    """Remove host/service secrets from the public projection, not source files."""
    if isinstance(value, dict):
        return {k: ("[redacted]" if re.search(
            r"api.?key|authorization|access.?token|secret|password|base_url|endpoint", k, re.I)
            else clean(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, str):
        value = re.sub(r"data:image/[^;]+;base64,[A-Za-z0-9+/=]+", "[image bytes omitted]", value)
        value = re.sub(r"\bsk-[A-Za-z0-9_-]{16,}", "[redacted credential]", value)
        value = re.sub(r"(?i)Bearer\s+[A-Za-z0-9._~+/-]{8,}", "Bearer [redacted]", value)
        value = re.sub(r"https?://(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?[^\s\"'<>]*", "[service address]", value)
        value = value.replace(str(ROOT), "[source]")
        value = re.sub(r"/home/[^/\s]+/", "[host]/", value)
        return value
    return value


def text_content(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(filter(None, (text_content(v) for v in value)))
    if isinstance(value, dict):
        if value.get("type") == "text":
            return value.get("text", "")
        return text_content(value.get("content", ""))
    return ""


def parse_args(value):
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return value


def public_node(node):
    # Intentionally exclude predicates, task_edges, reference answers and rubric.
    return {k: node[k] for k in ("id", "kind", "at", "message", "inject") if k in node}


def physical_tap(action, transform):
    """MobileWorld's executed x/y are display pixels, not resized model pixels."""
    if action.get("action_type") not in {"click", "double_tap", "long_press"}:
        return None
    size = transform.get("source_size")
    if not size or len(size) != 2 or not all(isinstance(v, (int, float)) and v > 0 for v in size):
        return None
    x, y = action.get("x"), action.get("y")
    if not all(isinstance(v, (int, float)) for v in (x, y)):
        return None
    width, height = size
    if 0 <= x <= width and 0 <= y <= height:
        return [x / width, y / height]
    return None


def stages_for(report, scenario):
    """Use capture order, not planned timestamps, to attach notification slices."""
    ids = {n["id"] for n in scenario["timeline"]}
    current = None
    for stage in report["evidence"]["snapshot_stages"]:
        if stage in ids:
            current = stage
        snapshot = report["evidence"]["evaluator_only_stage_snapshots"][stage]
        if current is not None:
            yield current, stage, snapshot["evaluator"]["stage_trajectory"]


class Images:
    def __init__(self, output):
        self.output = output
        self.manifest = {}
        self.missing = []

    def add(self, data, subject):
        expected = data.get("sha256") or data.get("screenshot_sha256")
        raw = data.get("artifact_path") or data.get("image_archive_path") or data.get("screenshot_path")
        if not raw or not expected:
            return None
        # Resolve only within this admitted subject archive, never arbitrary paths.
        recorded = Path(raw)
        candidates = []
        if "subject" in recorded.parts:
            suffix = recorded.parts[recorded.parts.index("subject") + 1:]
            candidates.append(subject.joinpath(*suffix))
        candidates += [subject / "images" / expected, subject / f"screen-{expected}.png",
                       subject / "model-inputs" / f"image-{expected}.png"]
        source = next((p for p in candidates if p.is_file() and p.resolve().is_relative_to(subject.resolve())), None)
        if source is None:
            self.missing.append({"sha256": expected, "filename": recorded.name})
            return None
        if digest(source) != expected:
            raise ValueError(f"Image hash mismatch: {source}")
        if expected not in self.manifest:
            # Byte-identical PNGs: no generated or reconstructed phone screens.
            if source.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
                raise ValueError(f"Expected PNG: {source}")
            target = self.output / "assets" / f"{expected}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            self.manifest[expected] = {"path": f"assets/{expected}.png", "sha256": expected,
                                       "bytes": source.stat().st_size}
        return self.manifest[expected]["path"]


def native_steps(report, scenario, report_ref):
    steps, seen = [], set()
    for stage, capture, trace in stages_for(report, scenario):
        groups = {}
        for collection in ("assistant_messages", "tool_calls", "tool_results"):
            for i, row in enumerate(trace[collection]):
                raw = row["raw"]
                identity = (raw["session_id"], raw["event_seq"])
                if identity in seen:
                    continue
                seen.add(identity)
                data = raw["data"]
                key = (raw["session_id"], data["turn"], data["step"])
                group = groups.setdefault(key, {"stage": stage, "capture_stage": capture,
                    "kind": "native", "title": "模型步骤", "time": raw["event_time"],
                    "clock": "device", "session": raw["session_id"],
                    "original_step": f"turn {data['turn']} / step {data['step']}",
                    "actions": [], "results": [], "message": "", "source": []})
                group["source"].append({"file": report_ref,
                    "pointer": f"/evidence/evaluator_only_stage_snapshots/{capture}/evaluator/stage_trajectory/{collection}/{i}",
                    "event_seq": raw["event_seq"]})
                if collection == "tool_calls":
                    group["actions"].append({"name": data["name"],
                        "arguments": parse_args(data["arguments"]), "call_id": data["callId"]})
                elif collection == "tool_results":
                    group["results"].append({"call_id": data["message"]["source"]["callId"],
                        "text": text_content(data["message"]["content"])})
                else:
                    group["message"] += row["text"]
        events = []
        for i, row in enumerate(trace["android_events"]):
            identity = (row.get("body", {}).get("session_id"), row["message_id"])
            if identity in seen:
                continue
            seen.add(identity)
            body = row["body"]
            events.append({"stage": stage, "capture_stage": capture, "kind": "input",
                "title": "用户委托" if row["type"] == "query" else "收到系统事件",
                "time": row["recorded_at"], "clock": "device",
                "message": body.get("text") or body.get("observation", {}).get("text") or body.get("summary", ""),
                "details": body, "source": [{"file": report_ref,
                    "pointer": f"/evidence/evaluator_only_stage_snapshots/{capture}/evaluator/stage_trajectory/android_events/{i}"}]})
        for step in groups.values():
            names = [a["name"] for a in step["actions"]]
            step["title"] = " · ".join(names) if names else "回复用户"
        steps.extend(sorted([*events, *groups.values()], key=lambda s: s["time"]))
    return steps


def claw_steps(report, scenario, subject, images, trace_ref):
    membership = {}
    for stage, capture, trace in stages_for(report, scenario):
        for row in trace["records"]:
            membership.setdefault(row["seq"], (stage, capture))
    rows = [json.loads(line) for line in (subject / "trajectory.jsonl").read_text().splitlines() if line.strip()]
    required = {"policy_step", "gui_action", "question", "delivery", "user_message", "user_question_reply"}
    unassigned = [r["seq"] for r in rows if r["event_type"] in required and r["seq"] not in membership]
    if unassigned:
        raise ValueError(f"Subject actions missing stage attribution: {unassigned[:10]}")
    steps, current_image, model_image, activation, response = [], None, None, None, {}
    observations = {i: row for i, row in enumerate(rows) if row["event_type"] == "observation"
                    and row["data"].get("screenshot_sha256")}
    first_gui = next((i for i, row in enumerate(rows) if row["event_type"] == "gui_action"), len(rows))
    initial = next(((i, row) for i, row in observations.items() if i < first_gui), None)
    # The first observation precedes any handset action. It is the initial
    # phone image during the off-phone planning lead-in, not a future result.
    displayed = initial
    selection = {"user_message": ("input", "用户委托"), "public_notification_received": ("input", "收到公开通知"),
                 "delivery": ("reply", "回复用户"), "question": ("question", "询问用户"),
                 "user_question_reply": ("input", "用户回答"),
                 "activation_budget_exhausted": ("status", "本次激活达到预算"),
                 "environment_error": ("status", "记录的环境错误"),
                 "activation_completed": ("status", "本次激活结束"),
                 "gui_subtask_completed": ("status", "GUI 子任务返回")}
    for line_no, row in enumerate(rows, 1):
        data, kind = row["data"], row["event_type"]
        if kind == "activation_started":
            activation, current_image, model_image, response = data["activation_id"], None, None, {}
        elif kind == "observation":
            current_image, model_image = data, None
            if data.get("screenshot_sha256"):
                displayed = (line_no - 1, row)
        elif kind == "model_image_transform":
            model_image = data
        elif kind == "model_response":
            response[data["api_name"]] = data.get("output", "")
        if row["seq"] not in membership:
            continue
        stage, capture = membership[row["seq"]]
        step = {"stage": stage, "capture_stage": capture, "time": datetime.fromtimestamp(
            row["recorded_at_ms"] / 1000, timezone.utc).isoformat(), "clock": "host",
            "activation": activation, "original_step": f"trace seq {row['seq']}",
            "source": [{"file": trace_ref, "line": line_no, "seq": row["seq"]}]}
        if kind == "policy_step":
            content = data["content"]
            # GUI policies repeat the following gui_action; retain that executed receipt instead.
            if re.match(r"^Step \d+ Output:", content):
                step.update(kind="result", title="规划工具返回", message=content)
            elif re.match(r"^Step \d+ Action:", content) and "agent." in content:
                command = re.search(r"agent\.([\w.]+)\(", content)
                step.update(kind="planner", title=f"agent.{command[1]}" if command else "规划动作",
                            message=content, model_output=response.get("task_step", ""))
            else:
                continue
        elif kind == "gui_action":
            step.update(kind="gui", title=data["action"]["action_type"], details=data,
                        model_output=response.get("mobileworld_gui_step", ""))
            if model_image or current_image:
                image_data = model_image or current_image
                step["image"] = images.add(image_data, subject)
                step["image_sha256"] = image_data.get("sha256") or image_data.get("screenshot_sha256")
                step["image_role"] = "动作前模型截图" if model_image else "最近一次动作前观察"
                # Parsed action x/y have already been converted to physical pixels
                # by the pinned upstream MobileWorld parser. Do not scale twice.
                if model_image:
                    point = physical_tap(data["action"], model_image)
                    if point is not None:
                        step["point"] = point
        elif kind in selection:
            category, title = selection[kind]
            step.update(kind=category, title=title, details=data)
            step["message"] = data.get("text") or data.get("message") or data.get("question") or data.get("answer") or ""
            if kind == "public_notification_received":
                notification = data["notification"]
                step["message"] = "\n".join(filter(None, [notification.get("title"), notification.get("text")]))
        else:
            continue
        after = None
        if kind == "gui_action" or (kind == "policy_step" and step.get("title") == "agent.get_device_screen"):
            for following_index in range(line_no, len(rows)):
                following = rows[following_index]
                if following["event_type"] in {"gui_action", "policy_step", "activation_started", "user_message"}:
                    break
                if following_index in observations:
                    after = (following_index, following)
                    break
            if after:
                displayed = after
        if displayed:
            observation_index, observation = displayed
            if step.get("image"):
                step["archived_before_image"] = {k: step[k] for k in ("image", "image_sha256", "image_role") if k in step}
            step.update(image=images.add(observation["data"], subject),
                image_sha256=observation["data"]["screenshot_sha256"],
                image_role="原运行的动作后画面" if after and kind == "gui_action" else "原运行的最近手机观察",
                image_capture_kind="archived_after_action" if after and kind == "gui_action" else "archived_observation",
                image_observation_source={"file": trace_ref, "line": observation_index + 1, "seq": observation["seq"]})
            step.pop("point", None)
        steps.append(step)
        if kind == "gui_subtask_completed":
            current_image, model_image = None, None
    return steps


def verify_scores(rows, report_path):
    if not rows or {r["source_report_sha256"] for r in rows} != {digest(report_path)}:
        raise ValueError(f"Adopted score does not match report: {report_path}")
    for row in rows:
        for path_key, hash_key in (("adopted_source", "adopted_source_sha256"),
                                   ("phase_result_source", "phase_result_sha256")):
            if hash_key in row and digest(ROOT / row[path_key]) != row[hash_key]:
                raise ValueError(f"Changed score source: {row[path_key]}")
    return [{"task_id": r["task_id"], "score": r["score"], "source": r["adopted_source"],
             "sha256": r["adopted_source_sha256"]} for r in rows]


def attach_replay(lane, manifest_path, images):
    replay = read(manifest_path)
    prefix = replay.get('protocol') == 'showcase.action-prefix.v1'
    completed = replay.get('prefix_complete') is True and replay.get('complete') is False if prefix else replay.get('complete') is True
    if (not completed or replay.get("model_calls") != 0
            or replay.get("scoring") is not False
            or replay["source_report_sha256"] != lane["report_sha256"]
            or replay["scenario_sha256"] != lane["scenario_sha256"]):
        raise ValueError("Replay source/completion mismatch")
    seen = set()
    continuous = replay.get("protocol") in {"showcase.action-replay.v1", "showcase.action-prefix.v1"}
    if continuous:
        verification_path = manifest_path.parent / "verification.json"
        if not verification_path.exists():
            raise ValueError("Continuous replay requires verification")
        verification = read(verification_path)
        if verification.get("passed") is not True or verification.get("manifest_sha256") != digest(manifest_path):
            raise ValueError("Replay verification mismatch")
        if prefix and verification.get('coverage') != {'kind':'prefix','first_step':1,'last_step':replay['stop_after_step'],'original_steps':len(lane['steps'])}:
            raise ValueError('Prefix verification coverage mismatch')
    capture_kind = "verified_prefix_replay" if prefix else "continuous_action_replay" if continuous else "excerpt_replay"
    executions = {}
    if continuous:
        for action in replay["actions"]:
            if "executed_arguments" in action:
                value = {"tool": action["source"]["name"], "arguments": action["executed_arguments"]}
            else:
                value = {"action": action.get("executed_action", action["source"])}
                reference = action.get("node_reference")
                if reference:
                    value.update(selected_resource=reference["source_node"]["resource-id"],
                        original_bounds=reference["source_node"]["bounds"], replay_bounds=reference["current_node"]["bounds"])
            executions.setdefault(action["step_index"], []).append(value)
    for frame in replay["frames"]:
        number = frame["step_index"]
        if number in seen or not 1 <= number <= len(lane["steps"]):
            raise ValueError("Replay frame index mismatch")
        seen.add(number)
        step = lane["steps"][number - 1]
        if clean(frame["source"]) != clean(step["source"]):
            raise ValueError("Replay frame source mismatch")
        source = (manifest_path.parent / frame["image"]).resolve()
        if not source.is_relative_to(manifest_path.parent.resolve()) or digest(source) != frame["sha256"]:
            raise ValueError("Replay image mismatch")
        if source.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError("Replay image must be PNG")
        relative = f"assets/{frame['sha256']}.png"
        target = images.output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        images.manifest[frame["sha256"]] = {"path": relative, "sha256": frame["sha256"],
            "bytes": source.stat().st_size, "capture_kind": capture_kind}
        if step.get("image"):
            step["archived_image"] = {k: step[k] for k in ("image", "image_sha256", "image_role") if k in step}
        step.update(image=relative, image_sha256=frame["sha256"],
            image_role="执行后手机画面" if continuous else "模拟器回放补录 · 操作后 · 展示者打开设备页面",
            image_capture_kind=capture_kind, replay={"captured_at": frame["captured_at"],
                "state": frame["state"], "resource_version": frame["resource_version"],
                "manifest_sha256": digest(manifest_path),
                "apk_hashes": replay.get("apk_hashes", {"com.dynamicworld.smarthome": replay["apk_sha256"]}),
                "matches_original_apks": replay.get("matches_original_apks"),
                "scope": replay["scope"], "executed_actions": executions.get(number, [])})
    limit = replay['stop_after_step'] if prefix else len(lane['steps'])
    if continuous and seen != set(range(1, limit + 1)):
        raise ValueError("Continuous replay requires a frame for every step")
    lane["replay_note"] = ("从初始环境顺序执行保存的手机动作，每步采集实际前台画面；不调用模型、不插入展示导航。推理和委托来自历史记录，画面来自本次动作回放，分数仍属于原运行。" if continuous else
        "全场景 App 画面补录：SmartHome 接口与 GUI 操作已重放；任务、监听和消息编排仍展示原记录。页面由展示者打开，不是原运行录像。"
        if replay.get("protocol") == "showcase.home-effects-replay.v1" else
        "客房灯关键动作在相同 SmartHome APK 上零模型回放；页面由展示者打开。不是原运行屏幕录像，未重跑监控器或其他任务。")
    if prefix:
        lane['capture_available_through_step'] = limit
        lane['replay_note'] = f'第 1–{limit} 步使用原运行 APK，从初始环境顺序回放保存动作并核对界面；无模型调用或展示导航。后续步骤仅保留原运行的动作、界面文字和返回，没有对应补采截图。分数仍属于原运行。'



def attach_frame_repair(lane, proof_path, images):
    """A verified prefix frame is not a successful whole-scene replay."""
    proof = read(proof_path)
    manifest_path = proof_path.parent / proof['manifest']
    replay = read(manifest_path)
    if (proof.get('protocol') != 'showcase.verified-frame-repair.v1' or proof.get('passed') is not True
            or proof['manifest_sha256'] != digest(manifest_path)
            or replay.get('model_calls') != 0 or replay.get('scoring') is not False
            or replay.get('prefix_complete') is not True
            or replay['source_report_sha256'] != lane['report_sha256']
            or replay['scenario_sha256'] != lane['scenario_sha256']):
        raise ValueError('Frame repair lacks source-matched verified prefix')
    for number in proof['steps']:
        step = lane['steps'][number - 1]
        frame = next(f for f in replay['frames'] if f['step_index'] == number)
        if frame['source'] != step['source'] or number > replay['stop_after_step']:
            raise ValueError('Frame repair step mismatch')
        path = manifest_path.parent / frame['image']
        if not path.resolve().is_relative_to(manifest_path.parent.resolve()) or digest(path) != frame['sha256']:
            raise ValueError('Frame repair image mismatch')
        if not path.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('Frame repair is not PNG')
        relative = f'assets/{frame["sha256"]}.png'
        (images.output / 'assets').mkdir(exist_ok=True)
        shutil.copyfile(path, images.output / relative)
        images.manifest[frame['sha256']] = dict(path=relative, sha256=frame['sha256'], bytes=path.stat().st_size)
        step['archived_image'] = {k: step[k] for k in ('image', 'image_sha256', 'image_role', 'image_observation_source') if k in step}
        step.pop('image_observation_source', None)
        step.update(image=relative, image_sha256=frame['sha256'], image_role='保存动作回放后的稳定画面',
                    image_capture_kind='verified_prefix_replay',
                    replay=dict(scope='Only this prefix frame; remainder uses historical captures',
                                captured_at=frame['captured_at'], manifest_sha256=digest(manifest_path),
                                verification_sha256=digest(proof_path), model_calls=0))
    lane['replay_note'] += ' 第 9 步使用从完整初始环境执行原 open_app 动作、等待界面稳定后的实拍截图；仅此帧补录，不代表 MobileClaw 全场景重放通过。原始空态截图保存在步骤来源中。'


def annotate_tasks(lanes, scenario):
    """Viewer-only attribution. Never infer ownership from a capture stage."""
    nodes = {n['id']: n for n in scenario['timeline']}
    requests = {nodes[t['establishment_node']].get('message'): t['task_id'] for t in scenario['tasks']}
    sessions = {}
    for step in lanes['native']['steps']:
        if step['title'] == '用户委托' and step.get('message') in requests:
            session = step.get('details', {}).get('session_id')
            if session:
                task = requests[step['message']]
                members = sessions.setdefault(session, {})
                members[task] = step['source']
    for key, lane in lanes.items():
        for step in lane['steps']:
            node = nodes[step['stage']]
            related = ([node['task_id']] if node.get('task_id') else
                       [e['task_id'] for e in node.get('task_edges', []) if e['relation'] == 'relevant'])
            session = step.get('session') or step.get('details', {}).get('session_id')
            members = sessions.get(session, {}) if key == 'native' else {}
            owner = next(iter(members)) if len(members) == 1 else None
            if len(members) > 1:
                related = list(dict.fromkeys([*related, *members]))
            direct = requests.get(step.get('message')) if step['title'] == '用户委托' else None
            step['task_attribution'] = dict(
                task_ids=[direct] if direct else [owner] if owner else [],
                context_task_ids=related,
                basis='exact_user_request' if direct else 'query_session' if owner else 'shared_session_context' if members else 'stage_context_only',
                source=step['source'] if direct else members[owner] if owner else [ref for refs in members.values() for ref in refs],
                context_source=dict(file=lane['report'].rsplit('/', 1)[0] + '/scenario.json',
                                    node_id=node['id'], field='task_id' if node.get('task_id') else 'task_edges'))
    return [dict(task_id=t['task_id'], establishment_node=t['establishment_node'],
                 request=nodes[t['establishment_node']].get('message', ''),
                 title={'v4_t031':'维修灯恢复', 'v4_t032':'温控器恢复', 'v4_t033':'核对维修结果',
                        'v4_t034':'离线灯补做', 'v4_t035':'离家守护与停止', 'v4_t036':'临时权限回收'}.get(t['task_id'], t['task_id']))
            for t in scenario['tasks']]


def build_case(case, index, images):
    reports = {key: read(ROOT / case[f"{key}_report"]) for key in ("native", "claw")}
    folders = {key: (ROOT / case[f"{key}_report"]).parent for key in reports}
    scenarios = {key: read(folders[key] / "scenario.json") for key in reports}
    nodes = {key: [public_node(n) for n in scenarios[key]["timeline"]] for key in reports}
    if nodes["native"] != nodes["claw"]:
        raise ValueError(f"Different public scenario inputs: {case['id']}")
    def task_contract(s):
        return ([{k: t[k] for k in ('task_id', 'establishment_node')} for t in s['tasks']],
                [{k: n.get(k) for k in ('id', 'task_id', 'task_edges')} for n in s['timeline']])
    if task_contract(scenarios['native']) != task_contract(scenarios['claw']):
        raise ValueError('Task relation declarations differ between the compared runs')
    scenario = scenarios["native"]
    stage_ids = {n["id"] for n in scenario["timeline"]}
    if any(h["stage"] not in stage_ids for h in case["highlights"]):
        raise ValueError(f"Unknown highlight stage: {case['id']}")
    subject = folders["claw"] / "subject"
    lanes = {}
    for key, config in (("native", "osnative_gpt54"), ("claw", "mobileclaw_gpt54")):
        report, report_ref = reports[key], case[f"{key}_report"]
        scores = verify_scores([r for r in index if r["scene"] == case["id"] and r["key"] == config], ROOT / report_ref)
        if {s["task_id"] for s in scores} != {t["task_id"] for t in scenario["tasks"]}:
            raise ValueError(f"Adopted tasks do not match scenario: {case['id']}")
        for score in scores:
            task = next(t for t in scenario["tasks"] if t["task_id"] == score["task_id"])
            node = next(n for n in scenario["timeline"] if n["id"] == task["establishment_node"])
            score.update(stage=node["id"], request=node.get("message", ""))
        if key == "native":
            steps = native_steps(report, scenario, report_ref)
        else:
            trace_ref = str(subject.relative_to(ROOT) / "trajectory.jsonl")
            steps = claw_steps(report, scenario, subject, images, trace_ref)
        for n, step in enumerate(steps, 1):
            step["id"] = f"{key}-{n}"
            step["index"] = n
        registration = folders[key] / "trial-registration.json"
        registered = read(registration) if registration.exists() else {}
        settings = {k: registered[k] for k in (
            "max_model_calls", "max_model_calls_per_activation", "max_main_calls_per_activation",
            "max_gui_subtask_steps", "cost_stop_threshold_usd", "registered_at") if k in registered}
        lanes[key] = {"name": "OS-native Agent" if key == "native" else "MobileClaw",
            "model": report["agent"]["model"]["model"], "run_id": report["run_id"],
            "report": report_ref, "report_sha256": digest(ROOT / report_ref),
            "scenario_sha256": digest(folders[key] / "scenario.json"), "settings": settings,
            "settings_note": "仅列出此运行保存的注册字段；未列出的设置未推断。",
            "scores": scores, "passed": sum(s["score"] == 1 for s in scores),
            "steps": steps, "step_counts": dict(Counter(s["kind"] for s in steps)),
            "capture": {"environment_valid": report.get("environment_valid"),
                        "cleanup_valid": report.get("cleanup_valid"),
                        "interrupted": report.get("interrupted")}}
        if key == "claw":
            lanes[key]["trace_sha256"] = digest(subject / "trajectory.jsonl")
            lanes[key]["replay_note"] = "手机画面来自原运行的真实观察：GUI 步骤对应紧随动作后的截图；非界面步骤沿用最近观察，首个手机动作前显示初始观察。没有重新生成模型决策。"
    for key in ("native", "claw"):
        if case.get(f"{key}_replay"):
            attach_replay(lanes[key], ROOT / case[f"{key}_replay"], images)
        for repair in case.get(f'{key}_frame_repairs', []):
            attach_frame_repair(lanes[key], ROOT / repair, images)
    if case.get("native_replay") and not case.get("claw_replay"):
        first = lanes["native"]["steps"][0]
        if first.get("image") and first.get("image_capture_kind") == "excerpt_replay":
            lanes["claw"]["initial_image"] = {"image": first["image"], "image_role": "共同初始 App 状态补录 · 非 MobileClaw 原运行截图", "title": "共同初始状态", "index": 0, "image_capture_kind": "shared_initial"}

    tasks = annotate_tasks(lanes, scenario)
    stages = [{**node, "label": case.get("stage_titles", {}).get(node["id"], node["id"].replace("_", " ")),
               "context": node.get("message") or case.get("stage_contexts", {}).get(node["id"]) or json.dumps(node.get("inject", []), ensure_ascii=False, indent=2)} for node in nodes["native"]]
    return clean({**{k: v for k, v in case.items() if not k.endswith("_report")},
        "stages": stages, "lanes": lanes, "tasks": tasks,
        "notes": ["按保存的采集阶段对齐；通知和定时激活归入其前面的场景事件。阶段归属不代表因果关系。",
                  "Step 是展示序号：OS-native 按模型步骤聚合工具调用；MobileClaw 分列规划和 GUI 动作。不能直接用展示步数比较效率。",
                  "OS-native 显示设备时间；MobileClaw 显示主机记录时间。场景时间是计划时间，未替换实际执行时间。",
                  "分数沿用已采纳结果；这是精选案例，不代表完整基准。运行日期、预算与环境版本可能不同，见来源。"]})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--selection', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    globals()['ROOT'] = args.source_root.resolve()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        parser.error(f'Output must be empty: {output}')
    output.mkdir(parents=True, exist_ok=True)
    selection = read(args.selection)
    index_path = ROOT / selection['adopted_index']
    index = read(index_path)['rows']
    images = Images(output)
    catalog = []
    for case in selection['cases']:
        data = build_case(case, index, images)
        if any(lane['model'] != 'gpt-5.4' for lane in data['lanes'].values()):
            raise ValueError('Showcase selection requires GPT-5.4 in both lanes')
        for task in data['tasks']:
            task['title'] = case.get('task_titles', {}).get(task['task_id'], task['title'])
        target = output / 'data' / f"{case['id']}.json"
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        catalog.append({k: data[k] for k in ('id', 'title', 'subtitle', 'description')})
        print(case['id'], {k: len(v['steps']) for k, v in data['lanes'].items()}, flush=True)
    (output / 'data/catalog.json').write_text(json.dumps(catalog, ensure_ascii=False), encoding='utf-8')
    manifest = dict(protocol='trajectory_showcase.export.v2', selection_sha256=digest(args.selection),
        adopted_index_sha256=digest(index_path), source_mutations=0, model_calls=0,
        exporter_sha256=digest(Path(__file__)), image_policy='byte-identical captured images',
        images=list(images.manifest.values()), missing_images=images.missing,
        files=[dict(path=str(p.relative_to(output)), sha256=digest(p)) for p in sorted((output/'data').glob('*.json'))])
    (output/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    print(f'Exported {len(catalog)} cases / {len(images.manifest)} images; missing: {len(images.missing)}')
    if images.missing:
        raise ValueError('Unresolved original screenshot references')


if __name__ == '__main__':
    main()
