import test from 'node:test';
import assert from 'node:assert/strict';

import { EditConflictError, StuffSheetDatabase } from '../src/data/sheet-database.js';
import { FakeDrive, FakeSheets, v1Tables } from './helpers/fake-google.js';

if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) { super(type); this.detail = options.detail; }
  };
}

test('backfills manual rows by header name without changing unknown columns', async () => {
  const tables = v1Tables({ reordered: true });
  tables.Places.push(['Home', '', '', '', '', '', '', '', '', '', '']);
  tables.Items.push(['Old maps', 'keep me', 'Home', 'School maps', 'paper', '', '', '', '', '', '', '', '']);
  const sheets = new FakeSheets(tables);
  const database = await StuffSheetDatabase.connect({ spreadsheetId: 'sheet-1', sheets, drive: new FakeDrive(), appVersion: '0.1.0' });
  assert.equal(database.inspection.state, 'current');
  assert.match(database.data.places[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(database.data.places[0].path, 'Home');
  assert.match(database.data.items[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(database.data.items[0].placeId, database.data.places[0].id);
  assert.equal(database.data.items[0].quantity, 1);
  assert.equal(sheets.tables.Items[1][1], 'keep me');
});

test('creates text-only items and detects manual concurrent edits', async () => {
  const sheets = new FakeSheets(v1Tables());
  const database = await StuffSheetDatabase.connect({ spreadsheetId: 'sheet-1', sheets, drive: new FakeDrive(), appVersion: '0.1.0' });
  const item = await database.createItem({ name: 'Passport case' });
  assert.equal(item.name, 'Passport case');
  assert.equal(item.quantity, 1);
  const nameColumn = sheets.tables.Items[0].indexOf('Name');
  sheets.tables.Items[item._rowNumber - 1][nameColumn] = 'Changed directly in Sheets';
  await assert.rejects(
    database.updateItem(item.id, { ...item, name: 'Changed in app' }, { snapshot: item }),
    (error) => error instanceof EditConflictError && error.changedFields.includes('name'),
  );
});

test('marks newer schemas read-only before any write', async () => {
  const tables = v1Tables();
  const schemaRow = tables.Settings.find((row) => row[0] === 'schema_version');
  schemaRow[1] = 2;
  const database = await StuffSheetDatabase.connect({ spreadsheetId: 'sheet-1', sheets: new FakeSheets(tables), drive: new FakeDrive(), appVersion: '0.1.0' });
  assert.equal(database.inspection.state, 'newer');
  assert.equal(database.writeEnabled, false);
  await assert.rejects(database.createItem({ name: 'Must not write' }), /read-only/);
});

test('trashes a partially created root when Sheet initialization fails', async () => {
  const resources = {
    root: { id: 'partial-root' },
    photos: { id: 'partial-photos' },
    thumbnails: { id: 'partial-thumbnails' },
    spreadsheet: { id: 'partial-sheet' },
  };
  const trashed = [];
  const drive = {
    async createInventoryFiles() { return resources; },
    async trashFile(id) { trashed.push(id); },
  };
  const sheets = {
    async initializeV1() { throw new Error('presentation failed'); },
  };

  await assert.rejects(
    StuffSheetDatabase.create({ sheets, drive, appVersion: '0.1.0' }),
    /presentation failed/,
  );
  assert.deepEqual(trashed, ['partial-root']);
});

test('keeps an initialized inventory when a later inspection is interrupted', async () => {
  const resources = {
    root: { id: 'initialized-root' },
    photos: { id: 'initialized-photos' },
    thumbnails: { id: 'initialized-thumbnails' },
    spreadsheet: { id: 'initialized-sheet' },
  };
  const trashed = [];
  const drive = {
    async createInventoryFiles() { return resources; },
    async getFile() { return { id: 'initialized-sheet' }; },
    async trashFile(id) { trashed.push(id); },
  };
  const sheets = {
    async initializeV1() {},
    async getMetadata() { throw new Error('network interrupted inspection'); },
  };

  await assert.rejects(
    StuffSheetDatabase.create({ sheets, drive, appVersion: '0.1.0' }),
    /network interrupted inspection/,
  );
  assert.deepEqual(trashed, []);
});
