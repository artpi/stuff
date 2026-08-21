import { TABLES } from '../../src/data/schema-registry.js';

function columnIndex(letters) {
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function tabFromRange(range) {
  return range.match(/^'((?:[^']|'')+)'!/)?.[1].replaceAll("''", "'") || range.split('!')[0];
}

export class FakeSheets {
  constructor(tables) {
    this.tables = structuredClone(tables);
    this.ids = Object.fromEntries(Object.keys(this.tables).map((tab, index) => [tab, index + 1]));
  }

  async getMetadata(spreadsheetId) {
    return { spreadsheetId, properties: { title: 'stuff — Inventory', locale: 'en_US' }, sheets: Object.entries(this.ids).map(([title, sheetId]) => ({ properties: { title, sheetId, gridProperties: {} } })) };
  }

  async batchGet(spreadsheetId, ranges) {
    return { valueRanges: ranges.map((range) => ({ range, values: structuredClone(this.tables[tabFromRange(range)] || []) })) };
  }

  async batchUpdateValues(spreadsheetId, data) {
    data.forEach(({ range, values }) => {
      const tab = tabFromRange(range);
      const cell = range.match(/!([A-Z]+)(\d+)$/);
      if (!cell) throw new Error(`FakeSheets cannot update range ${range}`);
      const column = columnIndex(cell[1]);
      const row = Number(cell[2]) - 1;
      while (this.tables[tab].length <= row) this.tables[tab].push([]);
      while (this.tables[tab][row].length <= column) this.tables[tab][row].push('');
      this.tables[tab][row][column] = values[0][0];
    });
    return { totalUpdatedCells: data.length };
  }

  async appendValues(spreadsheetId, range, values) {
    this.tables[tabFromRange(range)].push(...structuredClone(values));
    return { updates: { updatedRows: values.length } };
  }

  async deleteRow(spreadsheetId, sheetId, rowNumber) {
    const tab = Object.entries(this.ids).find(([, id]) => id === sheetId)?.[0];
    this.tables[tab].splice(rowNumber - 1, 1);
  }

  async batchUpdate() { return { replies: [] }; }
}

export class FakeDrive {
  async getFile(id) {
    const folder = ['root', 'photos', 'thumbs'].includes(id);
    return { id, name: folder ? id : 'stuff — Inventory', mimeType: folder ? 'application/vnd.google-apps.folder' : 'application/vnd.google-apps.spreadsheet', trashed: false, capabilities: { canEdit: true, canTrash: true, canAddChildren: folder } };
  }
  async listFolderFiles() { return []; }
  async backupSpreadsheet() { return { id: 'backup-id' }; }
}

export function v1Tables({ reordered = false } = {}) {
  const settings = [
    ['Key', 'Value', 'Description'],
    ['database_type', 'stuff', ''],
    ['database_id', 'db-1', ''],
    ['schema_version', 1, ''],
    ['minimum_app_version', '0.1.0', ''],
    ['migration_state', 'idle', ''],
    ['root_folder_id', 'root', ''],
    ['photos_folder_id', 'photos', ''],
    ['thumbnails_folder_id', 'thumbs', ''],
    ['photo_access_mode', 'anyone_with_link', ''],
  ];
  const defaults = Object.fromEntries(Object.entries(TABLES).map(([tab, fields]) => [tab, [fields.map((field) => field.header)]]));
  defaults.Settings = settings;
  if (reordered) defaults.Items[0] = ['Name', 'Custom Note', 'Location', 'Description', 'Tags', 'Quantity', 'Photo Count', 'Cover Photo', 'ID', 'Place ID', 'Created At', 'Updated At', 'Version'];
  return defaults;
}
