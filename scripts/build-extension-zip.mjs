import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'tenh-extension');
const { version } = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid extension version');
const outputDir = path.join(root, 'dist');
mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `tenh-companion-${version}.zip`);
// Use Python's standard ZIP writer so the package has manifest.json at its root.
execFileSync(process.env.PYTHON || 'python', ['-c', `
import pathlib, sys, zipfile
source, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(source.rglob('*')):
        if file.is_file() and not any(part.startswith('.') for part in file.relative_to(source).parts):
            archive.write(file, file.relative_to(source))
`, source, output], { stdio: 'inherit', windowsHide: true });
console.log(output);
