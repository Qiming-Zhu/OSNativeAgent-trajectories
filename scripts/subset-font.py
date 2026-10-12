#!/usr/bin/env python3
"""Subset the licensed CJK font to UI text and decoded saved observations."""
import argparse
import hashlib
import json
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
metadata = json.loads((ROOT / 'fonts/source.json').read_text())
assert hashlib.sha256(args.source.read_bytes()).hexdigest() == metadata['source_sha256']
characters = set()


def collect(value, depth=0):
    if isinstance(value, str):
        characters.update(value)
        if depth < 8 and value.startswith(('{', '[')):
            try:
                collect(json.loads(value), depth + 1)
            except (ValueError, TypeError):
                pass
    elif isinstance(value, dict):
        for key, child in value.items():
            collect(key, depth); collect(child, depth)
    elif isinstance(value, list):
        for child in value:
            collect(child, depth)


for path in [*ROOT.glob('*.js'), *ROOT.glob('*.html'), *ROOT.glob('demo/*.html')]:
    collect(path.read_text())
for path in (ROOT / 'data').glob('*.json'):
    collect(json.loads(path.read_text()))
options = subset.Options()
options.name_IDs = ['*']; options.name_legacy = True; options.name_languages = ['*']
font = TTFont(args.source)
worker = subset.Subsetter(options=options)
worker.populate(text=''.join(sorted(characters)))
worker.subset(font)
for entry in font['name'].names:
    if entry.nameID in [1, 4, 6, 16, 17]:
        name = 'TrajectorySans' if entry.nameID == 6 else 'Regular' if entry.nameID == 17 else 'Trajectory Sans'
        entry.string = name.encode(entry.getEncoding(), errors='replace')
target = ROOT / 'fonts/trajectory-sans.ttf'
font.save(target)
metadata.update(characters=len(characters), output_sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                derivation='fontTools subset of UI and decoded observations from four GPT-5.4 traces; renamed Trajectory Sans')
(ROOT / 'fonts/source.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(f'Subset: {len(characters)} characters, {target.stat().st_size} bytes')
