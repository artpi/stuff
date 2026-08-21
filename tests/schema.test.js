import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TABLES,
  buildSheetPresentationRequests,
  inspectHeaders,
  mapSheetRows,
} from '../src/data/schema-registry.js';

test('keeps human fields first and omits place types and status fields', () => {
  Object.values(TABLES).forEach((fields) => {
    const firstGenerated = fields.findIndex((field) => field.generated);
    if (firstGenerated < 0) return;
    assert.equal(fields.slice(firstGenerated).some((field) => field.human), false);
  });
  assert.equal(TABLES.Places.some((field) => field.header === 'Type'), false);
  assert.equal(TABLES.Items.some((field) => field.header === 'Status'), false);
  assert.equal(TABLES.Photos.some((field) => field.header === 'Status'), false);
});

test('maps reordered headers and preserves unknown columns outside domain records', () => {
  const values = [
    ['Custom note', 'ID', 'Name', 'Location', 'Quantity'],
    ['do not touch', 'item-1', 'Old maps', 'Home / Office', 2],
  ];
  const [item] = mapSheetRows('Items', values);
  assert.equal(item.id, 'item-1');
  assert.equal(item.name, 'Old maps');
  assert.equal(item.location, 'Home / Office');
  assert.equal(item.quantity, 2);
  assert.equal(item._raw[0], 'do not touch');
  const inspection = inspectHeaders('Items', values[0]);
  assert.deepEqual(inspection.unknown, ['Custom note']);
  assert.equal(inspection.missingHuman.some((field) => field.header === 'Description'), true);
});

test('creates native warning-only dropdowns from current header positions', () => {
  const metadata = ['Items', 'Places', 'Photos', 'Settings'].map((title, index) => ({ properties: { title, sheetId: index + 1 } }));
  const headers = {
    Items: ['Name', 'Custom', 'Quantity', 'Location'],
    Places: ['Name', 'Description', 'Parent', 'Path'],
    Photos: ['Entity', 'Entity Type', 'Order', 'Source'],
    Settings: ['Key', 'Value', 'Description'],
  };
  const requests = buildSheetPresentationRequests(metadata, headers);
  const validations = requests.filter((request) => request.setDataValidation).map((request) => request.setDataValidation);
  assert.equal(validations.length, 6);
  assert.equal(validations.every(({ rule }) => rule.strict === false && rule.showCustomUi === true), true);
  const location = validations.find(({ range }) => range.sheetId === 1 && range.startColumnIndex === 3);
  assert.equal(location.rule.condition.type, 'ONE_OF_RANGE');
  assert.equal(location.rule.condition.values[0].userEnteredValue, "='Places'!$D$2:$D");
  const parent = validations.find(({ range }) => range.sheetId === 2 && range.startColumnIndex === 2);
  assert.equal(parent.rule.condition.values[0].userEnteredValue, "='Places'!$D$2:$D");
  const entityType = validations.find(({ range }) => range.sheetId === 3 && range.startColumnIndex === 1);
  assert.deepEqual(entityType.rule.condition.values.map(({ userEnteredValue }) => userEnteredValue), ['Item', 'Place']);
});
