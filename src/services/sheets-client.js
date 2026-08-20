import { TABLES, buildSheetPresentationRequests } from '../data/schema-registry.js';
import { quoteSheetName, toA1Column } from '../utils.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsClient {
  constructor(api) {
    this.api = api;
  }

  getMetadata(spreadsheetId, includeGridData = false) {
    return this.api.request(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}`, {
      query: {
        includeGridData,
        fields: includeGridData
          ? undefined
          : 'spreadsheetId,properties(title,locale),sheets(properties(sheetId,title,index,gridProperties)),namedRanges',
      },
    });
  }

  batchGet(spreadsheetId, ranges) {
    const url = new URL(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet`);
    ranges.forEach((range) => url.searchParams.append('ranges', range));
    url.searchParams.set('majorDimension', 'ROWS');
    url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
    return this.api.request(url.href);
  }

  batchUpdate(spreadsheetId, requests, includeSpreadsheetInResponse = false) {
    if (!requests.length) return Promise.resolve({ replies: [] });
    return this.api.request(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: { requests, includeSpreadsheetInResponse },
    });
  }

  batchUpdateValues(spreadsheetId, data, valueInputOption = 'RAW') {
    if (!data.length) return Promise.resolve({ totalUpdatedCells: 0 });
    return this.api.request(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption, data },
    });
  }

  appendValues(spreadsheetId, range, values) {
    return this.api.request(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`, {
      method: 'POST',
      query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', includeValuesInResponse: true },
      body: { majorDimension: 'ROWS', values },
    });
  }

  clearValues(spreadsheetId, range) {
    return this.api.request(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, {
      method: 'POST',
      body: {},
    });
  }

  deleteRow(spreadsheetId, sheetId, rowNumber) {
    return this.batchUpdate(spreadsheetId, [{
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
      },
    }]);
  }

  async initializeV1(spreadsheetId, settingsRows) {
    const initial = await this.getMetadata(spreadsheetId);
    const defaultSheet = initial.sheets?.[0]?.properties;
    if (!defaultSheet) throw new Error('The new spreadsheet has no default sheet.');
    const requests = [
      { updateSpreadsheetProperties: { properties: { title: 'stuff — Inventory', locale: 'en_US' }, fields: 'title,locale' } },
      { updateSheetProperties: { properties: { sheetId: defaultSheet.sheetId, title: 'Items' }, fields: 'title' } },
      ...['Places', 'Photos', 'Settings'].map((title) => ({ addSheet: { properties: { title, gridProperties: { rowCount: 1001, columnCount: 26 } } } })),
    ];
    await this.batchUpdate(spreadsheetId, requests);

    const headers = Object.fromEntries(Object.entries(TABLES).map(([tab, fields]) => [tab, fields.map((field) => field.header)]));
    await this.batchUpdateValues(spreadsheetId, [
      ...Object.entries(headers).map(([tab, row]) => ({ range: `${quoteSheetName(tab)}!A1:${toA1Column(row.length - 1)}1`, majorDimension: 'ROWS', values: [row] })),
      { range: `${quoteSheetName('Settings')}!A2:C${settingsRows.length + 1}`, majorDimension: 'ROWS', values: settingsRows },
    ]);

    const metadata = await this.getMetadata(spreadsheetId);
    await this.batchUpdate(spreadsheetId, buildSheetPresentationRequests(metadata.sheets || [], headers));
    return metadata;
  }
}
