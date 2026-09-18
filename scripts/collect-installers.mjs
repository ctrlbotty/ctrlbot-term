import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const { productName: name, version } = config;
const release = join(root, 'src-tauri/target/release');
const destination = join(root, 'installers');
const artifacts = [
  [join(release, 'bundle/nsis', `${name}_${version}_x64-setup.exe`), `${name}-Setup-${version}.exe`],
  [join(release, 'ctrlbot-term.exe'), `${name}-${version}-portable.exe`],
];
// Fail before touching published files if a build output is missing.
for (const [source] of artifacts) {
  if (!existsSync(source)) throw new Error(`Missing build output: ${source}`);
}
mkdirSync(destination, { recursive: true });
for (const [source, filename] of artifacts) {
  copyFileSync(source, join(destination, filename));
  console.log(`Created installers/${filename}`);
}
// Keep older downloads accessible without mixing them with the current choices.
const current = new Set(artifacts.map(([, filename]) => filename));
for (const filename of readdirSync(destination)) {
  if (!/^CTRLbot (?:Term|Terminator)[_-].*\.(exe|msi)$/i.test(filename) || current.has(filename)) continue;
  const archive = join(destination, 'archive');
  mkdirSync(archive, { recursive: true });
  let target = join(archive, filename);
  if (existsSync(target)) target = join(archive, `${Date.now()}-${filename}`);
  renameSync(join(destination, filename), target);
}
writeFileSync(join(destination, 'README.txt'), `${name} ${version} — Windows x64\n\n` +
  `${name}-Setup-${version}.exe\n  FULL INSTALL — recommended. Installs the app, shortcuts, and uninstaller.\n\n` +
  `${name}-${version}-portable.exe\n  PORTABLE — run directly, no application installation or shortcuts.\n  Requires Microsoft Edge WebView2 Runtime already installed.\n  Settings are stored in your Windows user profile, shared with the installed app.\n\n` +
  `Older builds are in archive/.\n`);
