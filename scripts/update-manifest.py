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
    for item in manifest['files']:
        if item['path'].startswith('data/') and sha(ROOT / item['path']) != item['sha256']:
            raise ValueError('Original trajectory data changed: ' + item['path'])
    for item in manifest['images']:
        image = ROOT / item['path']
        if sha(image) != item['sha256']:
            raise ValueError('Trajectory image changed: ' + item['path'])
    paths = [ROOT / name for name in (
        '.nojekyll', 'index.html', 'home.css', 'home.js', 'demo/index.html',
        'app.js', 'observations.js', 'style.css')]
    for directory in ('data', 'fonts', 'assets/figures'):
        paths.extend(path for path in (ROOT / directory).rglob('*') if path.is_file())
    manifest['files'] = [{'path': path.relative_to(ROOT).as_posix(), 'sha256': sha(path)}
                         for path in sorted(set(paths))]
    manifest['site_build'] = {
        'model_calls': 0, 'phone_actions': 0,
        'presentation': 'paper homepage with integrated trajectory demo',
        'source_export_manifest': 'data/original-export-manifest.json',
        'source_export_manifest_sha256': sha(original),
    }
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Checked {len(manifest["images"])} unchanged trajectory images; recorded {len(paths)} presentation files.')


if __name__ == '__main__':
    main()
