import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchIndex, boundedDistance } from '../src/search/search-index.js';

const items = [
  { id: 'map', name: 'Old maps', description: 'School geography', tags: 'paper, school', location: 'Mom’s house / Basement / Box', placeId: 'box', photoCount: 1 },
  { id: 'case', name: 'Map case', description: 'Empty tube', tags: 'storage', location: 'Home / Office', placeId: 'office', photoCount: 0 },
  { id: 'drill', name: 'Cordless drill', description: 'Charger in case', tags: 'tools', location: 'Home / Basement', placeId: 'basement', photoCount: 1 },
  { id: 'lozko', name: 'Łóżko turystyczne', description: 'Dla dziecka', tags: 'dzieci', location: 'Strych', placeId: '', photoCount: 0 },
];

test('prioritizes exact/prefix name matches over weaker fields', () => {
  const index = new SearchIndex();
  index.rebuild(items);
  assert.equal(index.search('old maps')[0].id, 'map');
  assert.equal(index.search('map')[0].id, 'case');
});

test('matches accents and small typographical errors', () => {
  const index = new SearchIndex();
  index.rebuild(items);
  assert.equal(index.search('lozko')[0].id, 'lozko');
  assert.equal(index.search('cordles')[0].id, 'drill');
  assert.equal(boundedDistance('cordles', 'cordless', 2), 1);
});

test('combines place-subtree and photo filters without including unassigned items', () => {
  const index = new SearchIndex();
  index.rebuild(items);
  assert.deepEqual(index.search('', { placeIds: new Set(['box', 'basement']), photo: 'with' }).map(({ id }) => id), ['map', 'drill']);
  assert.deepEqual(index.search('', { placeIds: new Set(['office']), photo: 'without' }).map(({ id }) => id), ['case']);
});
