import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'index.html', 'privacy.html', 'SKILL.md', 'llms.txt', 'manifest.webmanifest', 'sw.js', 'CNAME',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-192.png', 'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
];
const failures = [];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

for (const relative of required) {
  try { await readFile(join(root, relative)); }
  catch { failures.push(`Missing required file: ${relative}`); }
}

const sourceFiles = (await filesUnder(join(root, 'src'))).filter((file) => extname(file) === '.js');
const forbidden = [
  { pattern: /\.innerHTML\b/, label: 'innerHTML' },
  { pattern: /insertAdjacentHTML\b/, label: 'insertAdjacentHTML' },
  { pattern: /\beval\s*\(/, label: 'eval' },
  { pattern: /\bnew\s+Function\b/, label: 'new Function' },
  { pattern: /document\.write\b/, label: 'document.write' },
  { pattern: /set(?:Timeout|Interval)\s*\(\s*['"`]/, label: 'string-based timer' },
  { pattern: /createElement\s*\(\s*['"]script['"]/, label: 'dynamic script element' },
];
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  forbidden.forEach(({ pattern, label }) => {
    if (pattern.test(source)) failures.push(`${file.slice(root.length + 1)} uses forbidden ${label}`);
  });
}

const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
if (manifest.display !== 'standalone') failures.push('Manifest display must be standalone.');
if (!manifest.icons?.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable')) failures.push('Manifest needs a 512px maskable icon.');

const skill = await readFile(join(root, 'SKILL.md'), 'utf8');
if (!skill.startsWith('---\nname: stuff-inventory\n')) failures.push('SKILL.md needs valid stuff-inventory frontmatter.');
if (!skill.includes('database_type` is exactly `stuff`')) failures.push('SKILL.md must document database validation.');

const llms = await readFile(join(root, 'llms.txt'), 'utf8');
if (!llms.includes('https://stuff.piszek.com/SKILL.md')) failures.push('llms.txt must advertise the canonical skill URL.');

if (failures.length) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(`Static and security checks passed for ${sourceFiles.length} source modules.\n`);
}
