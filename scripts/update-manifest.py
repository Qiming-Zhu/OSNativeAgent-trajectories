#!/usr/bin/env python3
"""Refresh static presentation hashes while preserving trajectory provenance."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    original = ROOT / 'data/original-export-manifest.json'
    manifest = json.loads(original.read_text())
    additions = ROOT / 'data/additional-export-manifest.json'
    extra = json.loads(additions.read_text())
    for source in (manifest, extra):
        for item in source['files']:
            # The live catalog combines both immutable exports.
            if item['path'] == 'data/catalog.json':
                continue
            if item['path'].startswith('data/') and sha(ROOT / item['path']) != item['sha256']:
                raise ValueError('Trajectory data changed: ' + item['path'])
        for item in source['images']:
            if sha(ROOT / item['path']) != item['sha256']:
                raise ValueError('Trajectory image changed: ' + item['path'])
    catalog = json.loads((ROOT / 'data/catalog.json').read_text())
    if len({item['id'] for item in catalog}) != 4:
        raise ValueError('Expected four distinct scenario exports')
    for item in catalog:
        data = json.loads((ROOT / 'data' / (item['id'] + '.json')).read_text())
        if any(data[key] != item[key] for key in item):
            raise ValueError('Catalog metadata does not match its trajectory')
    manifest['images'] = list({item['sha256']:item for item in manifest['images'] + extra['images']}.values())
    paths = [ROOT / name for name in (
        '.nojekyll', 'index.html', 'home.css', 'home.js', 'demo/index.html',
        'app.js', 'observations.js', 'style.css', 'stories.js')]
    for directory in ('data', 'fonts', 'assets/figures'):
        paths.extend(path for path in (ROOT / directory).rglob('*') if path.is_file())
    manifest['files'] = [{'path': path.relative_to(ROOT).as_posix(), 'sha256': sha(path)}
                         for path in sorted(set(paths))]
    manifest['site_build'] = {
        'model_calls': 0, 'phone_actions': 0,
        'presentation': 'paper homepage with integrated trajectory demo',
        'source_export_manifest': 'data/original-export-manifest.json',
        'source_export_manifest_sha256': sha(original),
        'additional_export_manifest': 'data/additional-export-manifest.json',
        'additional_export_manifest_sha256': sha(additions),
    }
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Checked {len(manifest["images"])} unchanged trajectory images; recorded {len(paths)} presentation files.')


if __name__ == '__main__':
    main()
