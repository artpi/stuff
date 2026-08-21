import { normalizeHeader, quoteSheetName, toA1Column } from '../utils.js';

export const DATABASE_TYPE = 'stuff';
export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_DATA_ROWS = 10000;
export const PHOTO_ACCESS_PRIVATE = 'private';
export const PHOTO_ACCESS_LINK = 'anyone_with_link';

export const TABLES = Object.freeze({
  Items: Object.freeze([
    { key: 'name', header: 'Name', human: true, required: true },
    { key: 'location', header: 'Location', human: true },
    { key: 'description', header: 'Description', human: true },
    { key: 'tags', header: 'Tags', human: true },
    { key: 'quantity', header: 'Quantity', human: true, defaultValue: 1 },
    { key: 'photoCount', header: 'Photo Count', generated: true },
    { key: 'coverPhoto', header: 'Cover Photo', generated: true },
    { key: 'id', header: 'ID', generated: true, required: true },
    { key: 'placeId', header: 'Place ID', generated: true },
    { key: 'createdAt', header: 'Created At', generated: true },
    { key: 'updatedAt', header: 'Updated At', generated: true },
    { key: 'version', header: 'Version', generated: true, defaultValue: 1 },
  ]),
  Places: Object.freeze([
    { key: 'name', header: 'Name', human: true, required: true },
    { key: 'parent', header: 'Parent', human: true },
    { key: 'description', header: 'Description', human: true },
    { key: 'path', header: 'Path', generated: true },
    { key: 'photoCount', header: 'Photo Count', generated: true },
    { key: 'coverPhoto', header: 'Cover Photo', generated: true },
    { key: 'id', header: 'ID', generated: true, required: true },
    { key: 'parentId', header: 'Parent ID', generated: true },
    { key: 'createdAt', header: 'Created At', generated: true },
    { key: 'updatedAt', header: 'Updated At', generated: true },
    { key: 'version', header: 'Version', generated: true, defaultValue: 1 },
  ]),
  Photos: Object.freeze([
    { key: 'entityType', header: 'Entity Type', human: true },
    { key: 'entity', header: 'Entity', human: true },
    { key: 'source', header: 'Source', human: true },
    { key: 'url', header: 'URL', human: true },
    { key: 'order', header: 'Order', human: true },
    { key: 'description', header: 'Description', human: true },
    { key: 'id', header: 'ID', generated: true, required: true },
    { key: 'entityId', header: 'Entity ID', generated: true },
    { key: 'driveFileId', header: 'Drive File ID', generated: true },
    { key: 'thumbnailFileId', header: 'Thumbnail File ID', generated: true },
    { key: 'createdAt', header: 'Created At', generated: true },
  ]),
  Settings: Object.freeze([
    { key: 'key', header: 'Key', human: false, required: true },
    { key: 'value', header: 'Value', human: false, required: true },
    { key: 'description', header: 'Description', human: false },
  ]),
});

export const REQUIRED_TABS = Object.freeze(Object.keys(TABLES));

export const SETTING_DESCRIPTIONS = Object.freeze({
  database_type: 'Database marker; must equal stuff',
  database_id: 'Stable inventory UUID',
  schema_version: 'Current integer schema version',
  minimum_app_version: 'Oldest app version allowed to write',
  migration_state: 'idle, running, or failed',
  migration_from: 'Source version for an in-progress migration',
  migration_to: 'Target version for an in-progress migration',
  migration_step: 'Last completed idempotent migration step',
  migration_backup_id: 'Drive ID of the pre-migration backup',
  root_folder_id: 'Drive ID of the dedicated stuff folder',
  photos_folder_id: 'Drive ID of the full-size Photos folder',
  thumbnails_folder_id: 'Drive ID of the Thumbnails folder',
  photo_access_mode: 'private or anyone_with_link; controls new Drive photo uploads',
  created_at: 'Database creation time in UTC',
  updated_at: 'Last structural update time in UTC',
});

export function createSettingsRows({ databaseId, rootFolderId, photosFolderId, thumbnailsFolderId, appVersion, now }) {
  const timestamp = now || new Date().toISOString();
  const values = {
    database_type: DATABASE_TYPE,
    database_id: databaseId,
    schema_version: CURRENT_SCHEMA_VERSION,
    minimum_app_version: appVersion,
    migration_state: 'idle',
    migration_from: '',
    migration_to: '',
    migration_step: '',
    migration_backup_id: '',
    root_folder_id: rootFolderId,
    photos_folder_id: photosFolderId,
    thumbnails_folder_id: thumbnailsFolderId,
    photo_access_mode: PHOTO_ACCESS_LINK,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return Object.entries(values).map(([key, value]) => [key, value, SETTING_DESCRIPTIONS[key] || '']);
}

export function buildHeaderIndex(headers = []) {
  const index = new Map();
  headers.forEach((header, position) => {
    const normalized = normalizeHeader(header);
    if (normalized && !index.has(normalized)) index.set(normalized, position);
  });
  return index;
}

export function fieldIndex(headers, field) {
  return buildHeaderIndex(headers).get(normalizeHeader(field.header));
}

export function mapSheetRows(tabName, values = []) {
  const schema = TABLES[tabName];
  if (!schema) throw new TypeError(`Unknown table: ${tabName}`);
  const headers = values[0] || [];
  const headerIndex = buildHeaderIndex(headers);
  return values.slice(1).map((row, rowOffset) => {
    const record = { _rowNumber: rowOffset + 2, _raw: [...row] };
    schema.forEach((field) => {
      const index = headerIndex.get(normalizeHeader(field.header));
      record[field.key] = index === undefined ? '' : (row[index] ?? '');
    });
    return record;
  }).filter((record) => schema.some((field) => String(record[field.key] ?? '').trim() !== ''));
}

export function inspectHeaders(tabName, headers = []) {
  const schema = TABLES[tabName];
  const index = buildHeaderIndex(headers);
  const missing = schema.filter((field) => !index.has(normalizeHeader(field.header)));
  return {
    tabName,
    missing,
    missingHuman: missing.filter((field) => field.human || (tabName === 'Settings' && field.required)),
    missingGenerated: missing.filter((field) => field.generated),
    unknown: headers.filter((header) => !schema.some((field) => normalizeHeader(field.header) === normalizeHeader(header))),
    index,
  };
}

function rangeForColumn(tabName, columnIndex) {
  const column = toA1Column(columnIndex);
  return `=${quoteSheetName(tabName)}!$${column}$2:$${column}`;
}

function dataValidation(sheetId, columnIndex, rule) {
  return {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: MAX_DATA_ROWS + 1,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      rule: { strict: false, showCustomUi: true, ...rule },
    },
  };
}

export function buildSheetPresentationRequests(sheetMetadata, headerRows) {
  const sheetsByTitle = new Map(sheetMetadata.map((sheet) => [sheet.properties.title, sheet.properties]));
  const indexes = Object.fromEntries(
    Object.entries(headerRows).map(([tabName, headers]) => [tabName, buildHeaderIndex(headers)]),
  );
  const requests = [];

  for (const [tabName, schema] of Object.entries(TABLES)) {
    const properties = sheetsByTitle.get(tabName);
    if (!properties) continue;
    const columnCount = Math.max(schema.length, headerRows[tabName]?.length || 0);
    requests.push(
      {
        updateSheetProperties: {
          properties: { sheetId: properties.sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      {
        repeatCell: {
          range: { sheetId: properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.09, green: 0.27, blue: 0.21 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
        },
      },
      {
        autoResizeDimensions: {
          dimensions: { sheetId: properties.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: columnCount },
        },
      },
    );
  }

  const placePathIndex = indexes.Places?.get(normalizeHeader('Path'));
  const itemLocationIndex = indexes.Items?.get(normalizeHeader('Location'));
  const placeParentIndex = indexes.Places?.get(normalizeHeader('Parent'));
  const itemQuantityIndex = indexes.Items?.get(normalizeHeader('Quantity'));
  const photoTypeIndex = indexes.Photos?.get(normalizeHeader('Entity Type'));
  const photoSourceIndex = indexes.Photos?.get(normalizeHeader('Source'));
  const photoOrderIndex = indexes.Photos?.get(normalizeHeader('Order'));
  const itemSheet = sheetsByTitle.get('Items');
  const placeSheet = sheetsByTitle.get('Places');
  const photoSheet = sheetsByTitle.get('Photos');

  if (placePathIndex !== undefined && itemLocationIndex !== undefined && itemSheet) {
    requests.push(dataValidation(itemSheet.sheetId, itemLocationIndex, {
      condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: rangeForColumn('Places', placePathIndex) }] },
    }));
  }
  if (placePathIndex !== undefined && placeParentIndex !== undefined && placeSheet) {
    requests.push(dataValidation(placeSheet.sheetId, placeParentIndex, {
      condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: rangeForColumn('Places', placePathIndex) }] },
    }));
  }
  if (itemQuantityIndex !== undefined && itemSheet) {
    requests.push(dataValidation(itemSheet.sheetId, itemQuantityIndex, {
      condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] },
    }));
  }
  if (photoTypeIndex !== undefined && photoSheet) {
    requests.push(dataValidation(photoSheet.sheetId, photoTypeIndex, {
      condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Item' }, { userEnteredValue: 'Place' }] },
    }));
  }
  if (photoSourceIndex !== undefined && photoSheet) {
    requests.push(dataValidation(photoSheet.sheetId, photoSourceIndex, {
      condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Drive' }, { userEnteredValue: 'URL' }] },
    }));
  }
  if (photoOrderIndex !== undefined && photoSheet) {
    requests.push(dataValidation(photoSheet.sheetId, photoOrderIndex, {
      condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] },
    }));
  }

  return requests;
}

export const SCHEMA_REGISTRY = Object.freeze(new Map([
  [1, Object.freeze({ version: 1, tables: TABLES })],
]));
