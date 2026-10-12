#!/usr/bin/env python3
"""Build compact homepage excerpts from the exported, source-bound GPT-5.4 runs."""
import hashlib
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    dict(id='home_repair', title='Home repair', heading='Temporary access for a helper',
         apps='SmartHome · QQ', task='T036', count=6,
         request='Let Li Si control only the study lamp while he helps. When he says he is finished, remove that access. Leave everyone else’s permissions alone.',
         steps=[62, 65, 138], labels=['Find the helper', 'Grant limited access', 'Remove access'],
         captions=['The agent opens household settings through the GUI.', 'Only the study-lamp permission is enabled for Li Si.', 'After the completion message, the agent switches the permission off.'],
         default=1),
    dict(id='airport_coordination', title='Airport coordination', heading='Keep an airport pickup up to date',
         apps='Flights · Calendar · SMS', task='T054', count=6,
         request='Create an airport pickup event 30 minutes after MU5501 arrives. If the flight is delayed or changes terminal, update the same event.',
         steps=[7, 30, 64], labels=['Create the pickup', 'Flight delayed', 'Terminal changed'],
         captions=['The saved calendar readback shows the initial pickup time and terminal.', 'The flight delay is reflected in the same calendar event.', 'The event now points to T1. Its identity is unchanged across all three readbacks.'],
         default=1),
    dict(id='evening_errands', title='Evening orders', heading='Update a delivery address',
         apps='Food · Shopping · Wallet · QQ', task='T073', count=5,
         request='Move tonight’s dinner delivery to the second floor. If it can no longer be changed, tell me and keep the order.',
         steps=[19, 21, 24], labels=['Edit the delivery', 'Save the address', 'A later change'],
         captions=['The agent opens the delivery-address editor through the GUI.', 'The order page shows the saved second-floor address.', 'Once preparation begins, the agent checks whether a second address change is still possible.'],
         default=1),
    dict(id='cross_district_course', title='Course planning', heading='Confirm and cancel a class',
         apps='SMS · QQ · Calendar · Notes', task='T086–T087', count=4,
         request='Wait until the teacher and Li Si agree on the same class. Add it to my calendar and tell Li Si. If it is officially cancelled, update both.',
         steps=[42, 52, 56], labels=['Both sides confirm', 'Class cancelled', 'Tell the companion'],
         captions=['After both confirmations, the agent sends the agreed time and place in QQ.', 'The calendar tool returns a successful deletion for the class event.', 'The agent sends the cancellation in QQ, preserving the earlier messages.'],
         default=2),
]


def one(value):
    return value[0] if isinstance(value, list) and len(value) == 1 else value


def record_for(scene, step):
    if scene == 'airport_coordination':
        action = next(a for a in step['actions'] if a.get('arguments', {}).get('toolName') == 'search_calendar_event')
        result = json.loads(next(r['text'] for r in step['results'] if r['call_id'] == action['call_id']))
        event = result['data']['details']['result']['events'][0]
        stamp = lambda key: datetime.fromtimestamp(one(event[key]) / 1000, ZoneInfo('Asia/Shanghai'))
        time = lambda key: stamp(key).strftime('%H:%M')
        return dict(title=one(event['title']), subtitle='Calendar · recorded readback',
                    rows=[['Date', stamp('start_time').strftime('%-d %B %Y')], ['Time', time('start_time') + '–' + time('end_time')],
                          ['Terminal', one(event['location'][0]['location'])], ['Version', str(one(event['resource_version']))]],
                    reference=one(event['event_id']), tool='search_calendar_event', call_id=action['call_id'])
    if scene == 'cross_district_course' and step['index'] == 52:
        action = next(a for a in step['actions'] if a.get('arguments', {}).get('toolName') == 'delete_calendar_event')
        result = json.loads(next(r['text'] for r in step['results'] if r['call_id'] == action['call_id']))
        data = result['data']['details']['result']
        assert one(data['status']) == 'succeeded'
        return dict(title='Class cancellation', subtitle='Calendar · recorded tool result',
                    rows=[['Operation', one(data['operation_type'])], ['Status', one(data['status'])],
                          ['Readback verified', str(one(data['system_readback_verified'])).lower()]],
                    reference=one(data['event_id']), tool='delete_calendar_event', call_id=action['call_id'])
    return None


def main():
    stories = []
    for config in CASES:
        path = ROOT / 'data' / (config['id'] + '.json')
        data = json.loads(path.read_text())
        assert all(l['model'] == 'gpt-5.4' for l in data['lanes'].values())
        story = {k: v for k, v in config.items() if k not in ('steps', 'labels', 'captions')}
        story['moments'] = []
        for number, label, caption in zip(config['steps'], config['labels'], config['captions']):
            step = next(s for s in data['lanes']['native']['steps'] if s['index'] == number)
            native_stage = [s for s in data['lanes']['native']['steps'] if s['stage'] == step['stage']]
            claw_stage = [s for s in data['lanes']['claw']['steps'] if s['stage'] == step['stage']]
            # Shared event context only; the two lanes keep their own step sequence.
            paired = {('home_repair',62):127, ('home_repair',65):130, ('home_repair',138):322, ('cross_district_course',56):183, ('evening_errands',21):37}.get((config['id'],number))
            claw_index = next((i for i, s in enumerate(claw_stage) if s['index'] == paired), None) if paired else None
            if claw_index is None:
                claw_index = next((i for i, s in enumerate(claw_stage) if s['kind'] == 'gui'), 0)
            href = 'demo/#' + urlencode(dict(scene=config['id'], stage=step['stage'], filter='all', n=native_stage.index(step), c=claw_index))
            record = record_for(config['id'], step)
            image = step.get('image') if not record else None
            if image:
                assert hashlib.sha256((ROOT / image).read_bytes()).hexdigest() == step['image_sha256']
            story['moments'].append(dict(label=label, caption=caption, step=number, stage=step['stage'],
                href=href, mode='native' if record else 'gui', record=record, image=image,
                capture_kind=step.get('image_capture_kind') if image else None,
                image_sha256=step.get('image_sha256') if image else None,
                source=step['source']))
        story['data_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        story['outcomes'] = {key: dict(passed=lane['passed'], total=len(lane['scores'])) for key, lane in data['lanes'].items()}
        stories.append(story)
    (ROOT / 'data/stories.json').write_text(json.dumps(dict(model='GPT-5.4', stories=stories), ensure_ascii=False, indent=2) + '\n')
    print(f'Built {len(stories)} stories / {sum(len(s["moments"]) for s in stories)} source-bound moments.')


if __name__ == '__main__':
    main()
