import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { TABLES, mapSheetRows } from '../src/data/schema-registry.js';

const payloads = [
  '<img src=x onerror=alert(1)>',
  '</textarea><script>alert(1)</script>',
  '<svg/onload=alert(1)>',
  'javascript:alert(1)',
  '" autofocus onfocus="alert(1)',
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (extname(path) === '.js') files.push(path);
  }
  return files;
}

test('keeps XSS payloads inert strings in every human-editable Sheet field', () => {
  Object.entries(TABLES).forEach(([tabName, fields]) => {
    const human = fields.filter((field) => field.human);
    if (!human.length) return;
    const headers = fields.map((field) => field.header);
    const row = fields.map((field, index) => field.human ? payloads[index % payloads.length] : '');
    const [record] = mapSheetRows(tabName, [headers, row]);
    human.forEach((field) => assert.equal(record[field.key], row[fields.indexOf(field)], `${tabName}.${field.header} changed the payload`));
  });
});

test('production source contains no HTML parsing or executable-code sinks', async () => {
  const root = resolve(import.meta.dirname, '..', 'src');
  const sources = await Promise.all((await sourceFiles(root)).map((file) => readFile(file, 'utf8')));
  const combined = sources.join('\n');
  for (const forbidden of [/\.innerHTML\b/, /\beval\s*\(/, /\bnew\s+Function\b/, /document\.write\b/, /insertAdjacentHTML\b/]) {
    assert.doesNotMatch(combined, forbidden);
  }
});

test('content security policy permits Google Picker to position its dialog', async () => {
  const html = await readFile(resolve(import.meta.dirname, '..', 'index.html'), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  const styleDirective = policy.split(';').find((directive) => directive.trim().startsWith('style-src')) || '';

  assert.match(styleDirective, /(?:^|\s)'self'(?:\s|$)/);
  assert.match(styleDirective, /(?:^|\s)'unsafe-inline'(?:\s|$)/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
});
