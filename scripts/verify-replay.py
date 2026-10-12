#!/usr/bin/env python3
"""Check saved-action captures against their original observations; never score."""
import argparse
import hashlib
import json
from pathlib import Path


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(directory, data_path):
    replay = read(directory / 'replay.json')
    lane = read(data_path)['lanes']['native']
    prefix = replay.get('protocol') == 'showcase.action-prefix.v1'
    limit = replay['stop_after_step'] if prefix else len(lane['steps'])
    selected_steps = lane['steps'][:limit]
    aliases = read(directory / 'reference-map.json')
    # These describe capture/execution time, not scheduled event times or task deadlines.
    volatile = {'updated_at', 'observed_at', 'captured_at', 'duration_ms', 'createdDate', 'modifiedDate'}

    def normalize(value, historical=False):
        if isinstance(value, str):
            return aliases.get(value, value) if historical else value
        if isinstance(value, list):
            return [normalize(v, historical) for v in value]
        if isinstance(value, dict):
            return {k: normalize(v, historical) for k, v in value.items() if k not in volatile}
        return value

    def business(result):
        data = result.get('data')
        # OS bindings duplicate the same return as both text content and structured details.
        return data.get('details', data) if isinstance(data, dict) else data

    def gui_nodes(result):
        # Handles and bounds can change across captures. Visible labels, roles, editable
        # values and permission states must agree; no invented navigation is permitted.
        return [tuple((k, n.get(k)) for k in ('resource_id', 'role', 'text', 'description', 'checked', 'editable', 'clickable'))
                for n in result.get('data', {}).get('nodes', [])]

    checks = dict(complete=(replay.get('prefix_complete') is True and replay['complete'] is False and 0 < limit < len(lane['steps'])) if prefix else replay['complete'] is True,
                  zero_model=replay['model_calls'] == 0,
                  scoring_disabled=replay['scoring'] is False,
                  source_report=replay['source_report_sha256'] == lane['report_sha256'],
                  source_scenario=replay['scenario_sha256'] == lane['scenario_sha256'],
                  postcheck=read(directory / 'postcheck.json')['verified'] is True,
                  all_steps=[f['step_index'] for f in replay['frames']] == [s['index'] for s in selected_steps],
                  all_actions=[(a['step_index'],a['source']['call_id']) for a in replay['actions']] ==
                              [(s['index'],a['call_id']) for s in selected_steps for a in s.get('actions', [])])
    checks['frame_hashes'] = all(sha(directory / f['image']) == f['sha256'] for f in replay['frames'])
    installed = lambda name: {r['package']:r['installed_sha256'] for r in read(directory / name)['checks']}
    checks['captured_apks'] = replay['apk_hashes'] == installed('admission.json') == installed('postcheck.json')
    checks['original_apk_comparison'] = replay['matches_original_apks'] == (replay['apk_hashes'] == installed('source-installation.json'))
    differences = []
    for action in replay['actions']:
        step = lane['steps'][action['step_index'] - 1]
        source = next(a for a in step['actions'] if a['call_id'] == action['source']['call_id'])
        checks['source:' + source['call_id']] = source == action['source']
        if action.get('execution_kind') == 'saved_context':
            checks['saved_context:' + source['call_id']] = action['result'] == next(r['text'] for r in step['results'] if r['call_id'] == source['call_id'])
        if not (source['name'].startswith(('app_', 'gui_')) or source['name'] == 'call_device_tool'):
            continue
        original = json.loads(next(r['text'] for r in step['results'] if r['call_id'] == source['call_id']))
        current = action['result']
        if source['name'].startswith('app_') or source['name'] == 'call_device_tool':
            old, new = normalize(business(original), True), normalize(business(current))
            passed = old == new
            checks['business:' + source['call_id']] = passed
            if not passed:
                differences.append(dict(step=step['index'], tool=source['name'], expected=old, actual=new))
        if source['name'].startswith('gui_'):
            passed = gui_nodes(original) == gui_nodes(current)
            checks['gui:' + source['call_id']] = passed
            if not passed:
                differences.append(dict(step=step['index'], tool=source['name'], expected=gui_nodes(original), actual=gui_nodes(current)))
    result = dict(passed=all(checks.values()), checks=checks, model_calls=0, scoring=False,
                  coverage={'kind':'prefix' if prefix else 'complete', 'first_step':1,'last_step':limit,'original_steps':len(lane['steps'])},
                  manifest_sha256=sha(directory / 'replay.json'),
                  normalization=dict(reference_map_sha256=sha(directory / 'reference-map.json'),
                                     ignored_execution_time_fields=sorted(volatile),
                                     gui='Visible text, resource IDs, roles, editable and checked states; exclude transient handles and pixel bounds.'),
                  differences=differences)
    (directory / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(dict(passed=result['passed'], checks=len(checks), failed=[k for k, v in checks.items() if not v])))
    return result['passed']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--viewer-data', type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(0 if verify(args.directory, args.viewer_data) else 1)
