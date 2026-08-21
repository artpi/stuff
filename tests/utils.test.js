import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareSemver,
  moveIdToIndex,
  normalizeHeader,
  normalizeSearchText,
  parsePublicDriveUrl,
  parseTags,
  safeHttpsUrl,
  toA1Column,
} from '../src/utils.js';

test('normalizes headers and multilingual search text predictably', () => {
  assert.equal(normalizeHeader('  Photo   Count  '), 'photo count');
  assert.equal(normalizeSearchText('ŁÓŻKO — część 2!'), 'lozko czesc 2');
  assert.deepEqual(parseTags(' Maps, school, maps,  paper '), ['Maps', 'school', 'paper']);
});

test('converts zero-based indexes to A1 columns', () => {
  assert.equal(toA1Column(0), 'A');
  assert.equal(toA1Column(25), 'Z');
  assert.equal(toA1Column(26), 'AA');
  assert.equal(toA1Column(701), 'ZZ');
});

test('moves a dragged photo to the target position', () => {
  assert.deepEqual(moveIdToIndex(['a', 'b', 'c', 'd'], 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveIdToIndex(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveIdToIndex(['a', 'b'], 'a', 'a'), ['a', 'b']);
});

test('accepts only credential-free HTTPS public URLs', () => {
  assert.equal(safeHttpsUrl('https://example.com/photo.jpg').href, 'https://example.com/photo.jpg');
  assert.throws(() => safeHttpsUrl('http://example.com/photo.jpg'), /HTTPS/);
  assert.throws(() => safeHttpsUrl('https://user:secret@example.com/photo.jpg'), /credentials/);
});

test('parses common public Google Drive links without needing OAuth', () => {
  assert.deepEqual(parsePublicDriveUrl('https://drive.google.com/file/d/abc_DEF-123/view?resourcekey=rk'), {
    fileId: 'abc_DEF-123',
    resourceKey: 'rk',
    originalUrl: 'https://drive.google.com/file/d/abc_DEF-123/view?resourcekey=rk',
  });
  assert.equal(parsePublicDriveUrl('https://example.com/photo.jpg'), null);
  assert.deepEqual(parsePublicDriveUrl('https://drive.usercontent.google.com/download?id=abc_DEF-123&resourcekey=rk'), {
    fileId: 'abc_DEF-123',
    resourceKey: 'rk',
    originalUrl: 'https://drive.usercontent.google.com/download?id=abc_DEF-123&resourcekey=rk',
  });
});

test('compares semantic app versions numerically', () => {
  assert.equal(compareSemver('1.10.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.0', '1.0.0'), 0);
  assert.equal(compareSemver('0.9.9', '1.0.0'), -1);
});
