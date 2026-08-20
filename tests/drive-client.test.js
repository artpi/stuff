import test from 'node:test';
import assert from 'node:assert/strict';

import { DriveClient, INVENTORY_NAME } from '../src/services/drive-client.js';

test('discovers existing app-authorized inventories before creating another', async () => {
  let observed;
  const files = [{ id: 'sheet-1', name: INVENTORY_NAME, modifiedTime: '2026-08-20T10:00:00Z' }];
  const drive = new DriveClient({
    async request(url, options) {
      observed = { url, options };
      return { files };
    },
  });

  assert.deepEqual(await drive.listInventoryFiles(), files);
  assert.equal(observed.url, 'https://www.googleapis.com/drive/v3/files');
  assert.match(observed.options.query.q, /stuffDatabase/);
  assert.match(observed.options.query.q, /stuff — Inventory/);
  assert.equal(observed.options.query.orderBy, 'modifiedTime desc');
});

test('marks newly created inventory Sheets for rename-safe discovery', async () => {
  let observed;
  const drive = new DriveClient({
    async request(url, options) {
      observed = { url, options };
      return { id: 'sheet-2' };
    },
  });

  await drive.createSpreadsheetFile(INVENTORY_NAME, 'root-1');
  assert.equal(observed.options.body.appProperties.stuffDatabase, 'true');
  assert.deepEqual(observed.options.body.parents, ['root-1']);
});
