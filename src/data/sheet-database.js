import { APP_VERSION } from '../config.js';
import {
  CURRENT_SCHEMA_VERSION,
  DATABASE_TYPE,
  REQUIRED_TABS,
  TABLES,
  buildHeaderIndex,
  buildSheetPresentationRequests,
  createSettingsRows,
  inspectHeaders,
  mapSheetRows,
} from './schema-registry.js';
import { migrationPath } from './migrations/index.js';
import {
  compareSemver,
  createUuid,
  normalizeHeader,
  normalizeSearchText,
  parsePositiveNumber,
  quoteSheetName,
  safeHttpsUrl,
  toA1Column,
} from '../utils.js';

export class DatabaseStateError extends Error {
  constructor(message, state) {
    super(message);
    this.name = 'DatabaseStateError';
    this.state = state;
  }
}

export class EditConflictError extends Error {
  constructor(tabName, current, proposed, changedFields) {
    super(`${tabName} changed after it was opened.`);
    this.name = 'EditConflictError';
    this.tabName = tabName;
    this.current = current;
    this.proposed = proposed;
    this.changedFields = changedFields;
  }
}

function normalizeSettingRows(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(row.key || '').trim();
    if (key) map.set(key, String(row.value ?? ''));
  });
  return map;
}

function humanKeys(tabName) {
  return TABLES[tabName].filter((field) => field.human).map((field) => field.key);
}

function compareHumanSnapshot(tabName, current, snapshot) {
  if (!snapshot) return [];
  return humanKeys(tabName).filter((key) => String(current[key] ?? '') !== String(snapshot[key] ?? ''));
}

function valueRange(tabName) {
  return `${quoteSheetName(tabName)}!A1:ZZ`;
}

function fieldByKey(tabName, key) {
  const field = TABLES[tabName].find((candidate) => candidate.key === key);
  if (!field) throw new TypeError(`Unknown ${tabName} field: ${key}`);
  return field;
}

function canonicalSource(value) {
  const normalized = normalizeSearchText(value);
  if (normalized === 'drive') return 'Drive';
  if (normalized === 'url') return 'URL';
  return String(value || '').trim();
}

function canonicalEntityType(value) {
  const normalized = normalizeSearchText(value);
  if (normalized === 'item') return 'Item';
  if (normalized === 'place') return 'Place';
  return String(value || '').trim();
}

function uniqueBy(items, key) {
  const counts = new Map();
  items.forEach((item) => {
    const value = String(item[key] || '').trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return counts;
}

export class StuffSheetDatabase extends EventTarget {
  constructor({ spreadsheetId, sheets, drive, appVersion = APP_VERSION }) {
    super();
    this.spreadsheetId = spreadsheetId;
    this.sheets = sheets;
    this.drive = drive;
    this.appVersion = appVersion;
    this.metadata = null;
    this.fileMetadata = null;
    this.inspection = null;
    this.settings = new Map();
    this.headers = {};
    this.headerIndexes = {};
    this.sheetIds = {};
    this.data = { items: [], places: [], photos: [] };
    this.writeEnabled = false;
  }

  static async create({ sheets, drive, parentFolderId = '', appVersion = APP_VERSION }) {
    const resources = await drive.createInventoryFiles(parentFolderId);
    let initialized = false;
    try {
      const now = new Date().toISOString();
      const databaseId = createUuid();
      await sheets.initializeV1(resources.spreadsheet.id, createSettingsRows({
        databaseId,
        rootFolderId: resources.root.id,
        photosFolderId: resources.photos.id,
        thumbnailsFolderId: resources.thumbnails.id,
        appVersion,
        now,
      }));
      initialized = true;
      const database = new StuffSheetDatabase({ spreadsheetId: resources.spreadsheet.id, sheets, drive, appVersion });
      await database.inspect();
      await database.synchronizeManualRows();
      return { database, resources };
    } catch (error) {
      if (!initialized) {
        try {
          await drive.trashFile(resources.root.id);
        } catch {
          // Preserve the original setup failure; the partial root remains visible for manual cleanup.
        }
      }
      throw error;
    }
  }

  static async connect(options) {
    const database = new StuffSheetDatabase(options);
    await database.inspect();
    if (database.inspection.state === 'current') await database.synchronizeManualRows();
    return database;
  }

  async inspect() {
    this.writeEnabled = false;
    const [metadata, fileMetadata] = await Promise.all([
      this.sheets.getMetadata(this.spreadsheetId),
      this.drive.getFile(this.spreadsheetId),
    ]);
    this.metadata = metadata;
    this.fileMetadata = fileMetadata;
    const sheetTitles = new Set((metadata.sheets || []).map((sheet) => sheet.properties.title));
    this.sheetIds = Object.fromEntries((metadata.sheets || []).map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
    const existingTabs = REQUIRED_TABS.filter((tabName) => sheetTitles.has(tabName));
    const missingTabs = REQUIRED_TABS.filter((tabName) => !sheetTitles.has(tabName));

    if (fileMetadata.trashed) {
      return this.#setInspection('unknown', ['The spreadsheet is in Google Drive trash.'], { missingTabs });
    }
    if (!existingTabs.length) {
      return this.#setInspection('uninitialized', ['No stuff tabs were found.'], { missingTabs });
    }

    const response = await this.sheets.batchGet(this.spreadsheetId, existingTabs.map(valueRange));
    const valuesByTab = {};
    existingTabs.forEach((tabName, index) => {
      valuesByTab[tabName] = response.valueRanges?.[index]?.values || [];
      this.headers[tabName] = valuesByTab[tabName][0] || [];
      this.headerIndexes[tabName] = buildHeaderIndex(this.headers[tabName]);
    });

    if (!sheetTitles.has('Settings')) {
      return this.#setInspection('unknown', ['The required Settings tab is missing or renamed.'], { missingTabs, valuesByTab });
    }
    const settingRows = mapSheetRows('Settings', valuesByTab.Settings || []);
    this.settings = normalizeSettingRows(settingRows);
    if (this.settings.get('database_type') !== DATABASE_TYPE) {
      return this.#setInspection('unknown', ['The selected spreadsheet is not a stuff database.'], { missingTabs, valuesByTab });
    }
    if (missingTabs.length) {
      return this.#setInspection('unknown', [`Required tabs are missing or renamed: ${missingTabs.join(', ')}.`], { missingTabs, valuesByTab });
    }

    const headerInspections = Object.fromEntries(REQUIRED_TABS.map((tabName) => [tabName, inspectHeaders(tabName, this.headers[tabName])]));
    const missingHuman = Object.values(headerInspections).flatMap((result) => result.missingHuman.map((field) => `${result.tabName}.${field.header}`));
    const missingGenerated = Object.values(headerInspections).flatMap((result) => result.missingGenerated.map((field) => `${result.tabName}.${field.header}`));
    const schemaVersion = Number.parseInt(this.settings.get('schema_version'), 10);
    const migrationState = this.settings.get('migration_state') || 'idle';
    const minimumAppVersion = this.settings.get('minimum_app_version') || '0.0.0';

    this.#mapData(valuesByTab);
    if (!Number.isInteger(schemaVersion)) {
      return this.#setInspection('unknown', ['schema_version is missing or not an integer.'], { headerInspections, valuesByTab });
    }
    if (compareSemver(this.appVersion, minimumAppVersion) < 0 || schemaVersion > CURRENT_SCHEMA_VERSION) {
      return this.#setInspection('newer', ['This inventory requires a newer version of stuff.'], { schemaVersion, minimumAppVersion, headerInspections, valuesByTab });
    }
    if (migrationState !== 'idle') {
      return this.#setInspection('interrupted', [`Migration state is ${migrationState}.`], { schemaVersion, migrationState, headerInspections, valuesByTab });
    }
    if (schemaVersion < CURRENT_SCHEMA_VERSION) {
      return this.#setInspection('upgradeable', [`Schema v${schemaVersion} can be upgraded to v${CURRENT_SCHEMA_VERSION}.`], { schemaVersion, headerInspections, valuesByTab });
    }
    if (missingHuman.length) {
      return this.#setInspection('unknown', [`Required human-facing headers are missing or renamed: ${missingHuman.join(', ')}.`], { schemaVersion, headerInspections, valuesByTab });
    }
    const resourceValidation = await this.#validateDriveResources();
    if (resourceValidation.issues.length) {
      return this.#setInspection('unknown', resourceValidation.issues.map((issue) => issue.message), {
        schemaVersion,
        headerInspections,
        valuesByTab,
        resourceIssues: resourceValidation.issues,
        resourceMetadata: resourceValidation.metadata,
      });
    }
    if (missingGenerated.length) {
      return this.#setInspection('repairable', [`Generated columns can be restored: ${missingGenerated.join(', ')}.`], {
        schemaVersion,
        headerInspections,
        valuesByTab,
        repairPlan: { missingGenerated },
      });
    }

    this.writeEnabled = true;
    return this.#setInspection('current', [], { schemaVersion, minimumAppVersion, headerInspections, valuesByTab });
  }

  async #validateDriveResources() {
    const specifications = [
      { key: 'root_folder_id', label: 'stuff root folder' },
      { key: 'photos_folder_id', label: 'Photos folder' },
      { key: 'thumbnails_folder_id', label: 'Thumbnails folder' },
    ];
    const metadata = {};
    const issues = [];
    await Promise.all(specifications.map(async ({ key, label }) => {
      const id = this.settings.get(key);
      if (!id) {
        issues.push({ key, label, code: 'missing_id', message: `Settings is missing the Drive ID for the ${label}.` });
        return;
      }
      try {
        const file = await this.drive.getFile(id);
        metadata[key] = file;
        if (file.trashed) issues.push({ key, label, id, code: 'trashed', message: `The ${label} is in Drive trash. Restore it before writing.` });
        if (file.mimeType !== 'application/vnd.google-apps.folder') issues.push({ key, label, id, code: 'wrong_type', message: `The stored ${label} ID no longer points to a folder.` });
        if (file.driveId) issues.push({ key, label, id, code: 'shared_drive', message: `The ${label} is inside a Shared Drive. V1 supports My Drive folders only.` });
        if (file.capabilities?.canAddChildren === false) issues.push({ key, label, id, code: 'read_only', message: `This account cannot add files to the ${label}. Ask the owner for editor access.` });
      } catch (error) {
        issues.push({ key, label, id, code: 'unavailable', message: `The ${label} is unavailable to this app/account. Authorize this exact folder with Google Picker.`, error });
      }
    }));
    return { metadata, issues };
  }

  #setInspection(state, messages, details = {}) {
    this.inspection = { state, messages, ...details };
    this.dispatchEvent(new CustomEvent('inspectionchange', { detail: this.inspection }));
    return this.inspection;
  }

  #mapData(valuesByTab) {
    this.data = {
      items: mapSheetRows('Items', valuesByTab.Items || []),
      places: mapSheetRows('Places', valuesByTab.Places || []),
      photos: mapSheetRows('Photos', valuesByTab.Photos || []),
    };
  }

  #assertWritable() {
    if (!this.writeEnabled || this.inspection?.state !== 'current') {
      throw new DatabaseStateError('The connected inventory is read-only until its schema is current.', this.inspection?.state || 'unknown');
    }
  }

  #columnIndex(tabName, key) {
    const field = fieldByKey(tabName, key);
    const index = this.headerIndexes[tabName]?.get(normalizeHeader(field.header));
    if (index === undefined) throw new DatabaseStateError(`Required column ${tabName}.${field.header} is missing.`, 'repairable');
    return index;
  }

  #cellUpdate(tabName, rowNumber, key, value) {
    const column = toA1Column(this.#columnIndex(tabName, key));
    return { range: `${quoteSheetName(tabName)}!${column}${rowNumber}`, majorDimension: 'ROWS', values: [[value ?? '']] };
  }

  async #writeFields(tabName, rowNumber, changes) {
    const data = Object.entries(changes).map(([key, value]) => this.#cellUpdate(tabName, rowNumber, key, value));
    await this.sheets.batchUpdateValues(this.spreadsheetId, data);
  }

  #recordRow(tabName, record) {
    const headers = this.headers[tabName];
    const row = Array.from({ length: headers.length }, () => '');
    TABLES[tabName].forEach((field) => {
      const index = this.headerIndexes[tabName].get(normalizeHeader(field.header));
      if (index !== undefined && record[field.key] !== undefined) row[index] = record[field.key];
    });
    return row;
  }

  async #appendRecord(tabName, record) {
    this.#assertWritable();
    await this.sheets.appendValues(this.spreadsheetId, `${quoteSheetName(tabName)}!A:ZZ`, [this.#recordRow(tabName, record)]);
    await this.inspect();
    return this.#findById(tabName, record.id);
  }

  #findById(tabName, id) {
    const collection = this.data[tabName.toLocaleLowerCase('en-US')];
    return collection?.find((record) => record.id === id) || null;
  }

  #resolvePlace(value, placeId = '') {
    if (placeId) {
      const byId = this.data.places.find((place) => place.id === placeId);
      if (byId) return { place: byId, ambiguous: false };
    }
    const normalized = normalizeSearchText(value);
    if (!normalized) return { place: null, ambiguous: false };
    const exactPath = this.data.places.filter((place) => normalizeSearchText(place.path) === normalized);
    if (exactPath.length === 1) return { place: exactPath[0], ambiguous: false };
    const exactName = this.data.places.filter((place) => normalizeSearchText(place.name) === normalized);
    return { place: exactName.length === 1 ? exactName[0] : null, ambiguous: exactPath.length > 1 || exactName.length > 1 };
  }

  #resolveEntity(type, value, entityId = '') {
    const canonicalType = canonicalEntityType(type);
    const collection = canonicalType === 'Item' ? this.data.items : canonicalType === 'Place' ? this.data.places : [];
    if (entityId) {
      const direct = collection.find((entity) => entity.id === entityId);
      if (direct) return { entity: direct, ambiguous: false };
    }
    const normalized = normalizeSearchText(value);
    const matches = collection.filter((entity) => normalizeSearchText(canonicalType === 'Place' ? (entity.path || entity.name) : entity.name) === normalized);
    if (matches.length === 1) return { entity: matches[0], ambiguous: false };
    if (canonicalType === 'Place') {
      const names = collection.filter((entity) => normalizeSearchText(entity.name) === normalized);
      if (names.length === 1) return { entity: names[0], ambiguous: false };
      if (names.length > 1) return { entity: null, ambiguous: true };
    }
    return { entity: null, ambiguous: matches.length > 1 };
  }

  async synchronizeManualRows() {
    this.#assertWritable();
    const updates = [];
    const now = new Date().toISOString();

    for (const place of this.data.places) {
      if (!String(place.name || '').trim()) continue;
      if (!place.id) {
        place.id = createUuid();
        updates.push(this.#cellUpdate('Places', place._rowNumber, 'id', place.id));
      }
      if (!place.createdAt) updates.push(this.#cellUpdate('Places', place._rowNumber, 'createdAt', now));
      if (!place.updatedAt) updates.push(this.#cellUpdate('Places', place._rowNumber, 'updatedAt', now));
      if (!place.version) updates.push(this.#cellUpdate('Places', place._rowNumber, 'version', 1));
    }

    const placesById = new Map(this.data.places.filter((place) => place.id).map((place) => [place.id, place]));
    const findParent = (place) => {
      if (place.parentId && placesById.has(place.parentId)) return placesById.get(place.parentId);
      const normalized = normalizeSearchText(place.parent);
      if (!normalized) return null;
      const byPath = this.data.places.filter((candidate) => candidate.id !== place.id && normalizeSearchText(candidate.path) === normalized);
      if (byPath.length === 1) return byPath[0];
      const byName = this.data.places.filter((candidate) => candidate.id !== place.id && normalizeSearchText(candidate.name) === normalized);
      return byName.length === 1 ? byName[0] : null;
    };

    this.data.places.forEach((place) => {
      const parent = findParent(place);
      place._resolvedParentId = parent?.id || '';
      if (parent && place.parentId !== parent.id) updates.push(this.#cellUpdate('Places', place._rowNumber, 'parentId', parent.id));
    });

    const pathMemo = new Map();
    const pathFor = (place, stack = new Set()) => {
      if (pathMemo.has(place.id)) return pathMemo.get(place.id);
      if (stack.has(place.id)) return '';
      const nextStack = new Set(stack).add(place.id);
      const parent = place._resolvedParentId ? placesById.get(place._resolvedParentId) : null;
      const parentPath = parent ? pathFor(parent, nextStack) : '';
      if (parent && !parentPath) return '';
      const path = parentPath ? `${parentPath} / ${String(place.name).trim()}` : String(place.name).trim();
      pathMemo.set(place.id, path);
      return path;
    };

    this.data.places.forEach((place) => {
      const path = pathFor(place);
      if (path && place.path !== path) {
        place.path = path;
        updates.push(this.#cellUpdate('Places', place._rowNumber, 'path', path));
      }
    });

    for (const item of this.data.items) {
      if (!String(item.name || '').trim()) continue;
      if (!item.id) {
        item.id = createUuid();
        updates.push(this.#cellUpdate('Items', item._rowNumber, 'id', item.id));
      }
      if (!item.createdAt) updates.push(this.#cellUpdate('Items', item._rowNumber, 'createdAt', now));
      if (!item.updatedAt) updates.push(this.#cellUpdate('Items', item._rowNumber, 'updatedAt', now));
      if (!item.version) updates.push(this.#cellUpdate('Items', item._rowNumber, 'version', 1));
      if (!item.quantity) updates.push(this.#cellUpdate('Items', item._rowNumber, 'quantity', 1));
      const resolved = this.#resolvePlace(item.location, item.placeId);
      if (resolved.place && item.placeId !== resolved.place.id) {
        item.placeId = resolved.place.id;
        updates.push(this.#cellUpdate('Items', item._rowNumber, 'placeId', resolved.place.id));
      }
    }

    const nextOrder = new Map();
    for (const photo of this.data.photos) {
      const type = canonicalEntityType(photo.entityType);
      const source = canonicalSource(photo.source);
      if (!photo.id) {
        photo.id = createUuid();
        updates.push(this.#cellUpdate('Photos', photo._rowNumber, 'id', photo.id));
      }
      if (!photo.createdAt) updates.push(this.#cellUpdate('Photos', photo._rowNumber, 'createdAt', now));
      const resolved = this.#resolveEntity(type, photo.entity, photo.entityId);
      if (resolved.entity && photo.entityId !== resolved.entity.id) {
        photo.entityId = resolved.entity.id;
        updates.push(this.#cellUpdate('Photos', photo._rowNumber, 'entityId', resolved.entity.id));
      }
      const orderKey = `${type}:${photo.entityId || photo.entity}`;
      const proposedOrder = nextOrder.get(orderKey) || 1;
      if (!parsePositiveNumber(photo.order, 0)) updates.push(this.#cellUpdate('Photos', photo._rowNumber, 'order', proposedOrder));
      nextOrder.set(orderKey, Math.max(proposedOrder, Number(photo.order) || 0) + 1);
      photo.entityType = type;
      photo.source = source;
    }

    const photoGroups = new Map();
    this.data.photos.forEach((photo) => {
      if (!photo.entityId) return;
      if (!photoGroups.has(photo.entityId)) photoGroups.set(photo.entityId, []);
      photoGroups.get(photo.entityId).push(photo);
    });
    for (const [tabName, collection] of [['Items', this.data.items], ['Places', this.data.places]]) {
      collection.forEach((entity) => {
        const photos = (photoGroups.get(entity.id) || []).sort((a, b) => Number(a.order) - Number(b.order));
        const cover = photos[0];
        const coverValue = cover
          ? (canonicalSource(cover.source) === 'URL' ? cover.url : cover.driveFileId ? `https://drive.google.com/open?id=${cover.driveFileId}` : '')
          : '';
        if (Number(entity.photoCount || 0) !== photos.length) updates.push(this.#cellUpdate(tabName, entity._rowNumber, 'photoCount', photos.length));
        if (String(entity.coverPhoto || '') !== coverValue) updates.push(this.#cellUpdate(tabName, entity._rowNumber, 'coverPhoto', coverValue));
      });
    }

    if (updates.length) await this.sheets.batchUpdateValues(this.spreadsheetId, updates);
    await this.inspect();
    this.dispatchEvent(new CustomEvent('datachange', { detail: this.data }));
    return { updatedCells: updates.length, diagnostics: await this.runDiagnostics({ includeMedia: false }) };
  }

  async createItem(values) {
    this.#assertWritable();
    const name = String(values.name || '').trim();
    if (!name) throw new TypeError('Name is required.');
    const now = new Date().toISOString();
    const resolved = this.#resolvePlace(values.location, values.placeId);
    if (resolved.ambiguous) throw new TypeError('The selected location is ambiguous. Choose a full place path.');
    const record = {
      name,
      location: resolved.place?.path || String(values.location || '').trim(),
      description: String(values.description || '').trim(),
      tags: String(values.tags || '').trim(),
      quantity: parsePositiveNumber(values.quantity, 1),
      photoCount: 0,
      coverPhoto: '',
      id: createUuid(),
      placeId: resolved.place?.id || '',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    return this.#appendRecord('Items', record);
  }

  async updateItem(id, values, { snapshot, overwrite = false } = {}) {
    this.#assertWritable();
    await this.inspect();
    const current = this.#findById('Items', id);
    if (!current) throw new Error('This item no longer exists in the Sheet.');
    const changedFields = compareHumanSnapshot('Items', current, snapshot);
    if (changedFields.length && !overwrite) throw new EditConflictError('Items', current, values, changedFields);
    const resolved = this.#resolvePlace(values.location, values.placeId);
    if (resolved.ambiguous) throw new TypeError('The selected location is ambiguous. Choose a full place path.');
    await this.#writeFields('Items', current._rowNumber, {
      name: String(values.name || '').trim(),
      location: resolved.place?.path || String(values.location || '').trim(),
      description: String(values.description || '').trim(),
      tags: String(values.tags || '').trim(),
      quantity: parsePositiveNumber(values.quantity, 1),
      placeId: resolved.place?.id || '',
      updatedAt: new Date().toISOString(),
      version: Number(current.version || 0) + 1,
    });
    await this.inspect();
    this.dispatchEvent(new CustomEvent('datachange', { detail: this.data }));
    return this.#findById('Items', id);
  }

  async createPlace(values) {
    this.#assertWritable();
    const name = String(values.name || '').trim();
    if (!name) throw new TypeError('Name is required.');
    const parentResult = this.#resolvePlace(values.parent, values.parentId);
    if (parentResult.ambiguous) throw new TypeError('The selected parent is ambiguous. Choose a full place path.');
    const parent = parentResult.place;
    const duplicate = this.data.places.find((place) => normalizeSearchText(place.name) === normalizeSearchText(name) && String(place.parentId || '') === String(parent?.id || ''));
    if (duplicate) throw new TypeError('A place with this name already exists under the selected parent.');
    const now = new Date().toISOString();
    const record = {
      name,
      parent: parent?.path || '',
      description: String(values.description || '').trim(),
      path: parent ? `${parent.path} / ${name}` : name,
      photoCount: 0,
      coverPhoto: '',
      id: createUuid(),
      parentId: parent?.id || '',
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    return this.#appendRecord('Places', record);
  }

  descendantPlaceIds(placeId, includeSelf = true) {
    const result = new Set(includeSelf ? [placeId] : []);
    let changed = true;
    while (changed) {
      changed = false;
      this.data.places.forEach((place) => {
        if (place.parentId && result.has(place.parentId) && !result.has(place.id)) {
          result.add(place.id);
          changed = true;
        }
      });
    }
    return result;
  }

  async updatePlace(id, values, { snapshot, overwrite = false } = {}) {
    this.#assertWritable();
    await this.inspect();
    const current = this.#findById('Places', id);
    if (!current) throw new Error('This place no longer exists in the Sheet.');
    const changedFields = compareHumanSnapshot('Places', current, snapshot);
    if (changedFields.length && !overwrite) throw new EditConflictError('Places', current, values, changedFields);
    const parentResult = this.#resolvePlace(values.parent, values.parentId);
    if (parentResult.ambiguous) throw new TypeError('The selected parent is ambiguous. Choose a full place path.');
    const parent = parentResult.place;
    const descendants = this.descendantPlaceIds(id);
    if (parent && descendants.has(parent.id)) throw new TypeError('A place cannot be moved inside itself or one of its descendants.');
    await this.#writeFields('Places', current._rowNumber, {
      name: String(values.name || '').trim(),
      parent: parent?.path || '',
      description: String(values.description || '').trim(),
      parentId: parent?.id || '',
      updatedAt: new Date().toISOString(),
      version: Number(current.version || 0) + 1,
    });
    await this.inspect();
    await this.synchronizeManualRows();
    const pathUpdates = [];
    this.data.items.forEach((item) => {
      if (!descendants.has(item.placeId)) return;
      const place = this.data.places.find((candidate) => candidate.id === item.placeId);
      if (place && item.location !== place.path) pathUpdates.push(this.#cellUpdate('Items', item._rowNumber, 'location', place.path));
    });
    if (pathUpdates.length) await this.sheets.batchUpdateValues(this.spreadsheetId, pathUpdates);
    await this.inspect();
    this.dispatchEvent(new CustomEvent('datachange', { detail: this.data }));
    return this.#findById('Places', id);
  }

  async addDrivePhoto({ entityType, entityId, entity, driveFileId, thumbnailFileId, url = '', description = '' }) {
    return this.#addPhoto({ entityType, entityId, entity, source: 'Drive', driveFileId, thumbnailFileId, url, description });
  }

  async addUrlPhoto({ entityType, entityId, entity, url, description = '' }) {
    safeHttpsUrl(url);
    return this.#addPhoto({ entityType, entityId, entity, source: 'URL', url, description });
  }

  async replaceDrivePhotoThumbnail(photoId, thumbnailFileId) {
    this.#assertWritable();
    await this.inspect();
    const photo = this.#findById('Photos', photoId);
    if (!photo) throw new Error('This photo relationship no longer exists.');
    if (canonicalSource(photo.source) !== 'Drive') throw new TypeError('Only Drive photos have a thumbnail to replace.');
    if (!String(thumbnailFileId || '').trim()) throw new TypeError('A replacement thumbnail is required.');
    await this.#writeFields('Photos', photo._rowNumber, { thumbnailFileId });
    await this.inspect();
    return this.#findById('Photos', photoId);
  }

  async replaceDrivePhotoFiles(photoId, { driveFileId, thumbnailFileId, url = '' }) {
    this.#assertWritable();
    await this.inspect();
    const photo = this.#findById('Photos', photoId);
    if (!photo) throw new Error('This photo relationship no longer exists.');
    if (canonicalSource(photo.source) !== 'Drive') throw new TypeError('Only Drive photos can have their files replaced.');
    if (!String(driveFileId || '').trim() || !String(thumbnailFileId || '').trim()) throw new TypeError('Replacement original and thumbnail files are required.');
    await this.#writeFields('Photos', photo._rowNumber, { driveFileId, thumbnailFileId, url });
    await this.inspect();
    return this.#findById('Photos', photoId);
  }

  async #addPhoto(values) {
    this.#assertWritable();
    const type = canonicalEntityType(values.entityType);
    const resolved = this.#resolveEntity(type, values.entity, values.entityId);
    if (!resolved.entity) throw new TypeError(resolved.ambiguous ? 'The photo entity is ambiguous.' : 'The photo entity does not exist.');
    const siblings = this.data.photos.filter((photo) => photo.entityId === resolved.entity.id);
    const record = {
      entityType: type,
      entity: type === 'Place' ? (resolved.entity.path || resolved.entity.name) : resolved.entity.name,
      source: canonicalSource(values.source),
      url: values.url || '',
      order: siblings.reduce((maximum, photo) => Math.max(maximum, Number(photo.order) || 0), 0) + 1,
      description: String(values.description || '').trim(),
      id: createUuid(),
      entityId: resolved.entity.id,
      driveFileId: values.driveFileId || '',
      thumbnailFileId: values.thumbnailFileId || '',
      createdAt: new Date().toISOString(),
    };
    const photo = await this.#appendRecord('Photos', record);
    await this.synchronizeManualRows();
    return photo;
  }

  async reorderPhotos(entityId, orderedIds) {
    this.#assertWritable();
    const updates = orderedIds.map((photoId, index) => {
      const photo = this.data.photos.find((candidate) => candidate.id === photoId && candidate.entityId === entityId);
      if (!photo) throw new TypeError('A reordered photo is missing or belongs to another entity.');
      return this.#cellUpdate('Photos', photo._rowNumber, 'order', index + 1);
    });
    await this.sheets.batchUpdateValues(this.spreadsheetId, updates);
    await this.inspect();
    await this.synchronizeManualRows();
  }

  async removePhoto(photoId, { deleteFiles = false } = {}) {
    this.#assertWritable();
    await this.inspect();
    const photo = this.#findById('Photos', photoId);
    if (!photo) throw new Error('This photo relationship no longer exists.');
    if (deleteFiles && canonicalSource(photo.source) === 'Drive') {
      for (const fileId of [photo.driveFileId, photo.thumbnailFileId].filter(Boolean)) {
        const metadata = await this.drive.getFile(fileId);
        if (!metadata.capabilities?.canTrash) throw new Error(`You cannot move ${metadata.name || 'this photo'} to trash.`);
      }
      for (const fileId of [photo.driveFileId, photo.thumbnailFileId].filter(Boolean)) await this.drive.trashFile(fileId);
    }
    await this.sheets.deleteRow(this.spreadsheetId, this.sheetIds.Photos, photo._rowNumber);
    await this.inspect();
    await this.synchronizeManualRows();
  }

  photosFor(entityId) {
    return this.data.photos
      .filter((photo) => photo.entityId === entityId)
      .sort((left, right) => Number(left.order) - Number(right.order));
  }

  async repairSchema() {
    if (this.inspection?.state !== 'repairable') throw new DatabaseStateError('This schema cannot be repaired automatically.', this.inspection?.state);
    const data = [];
    for (const [tabName, result] of Object.entries(this.inspection.headerInspections)) {
      let nextColumn = this.headers[tabName].length;
      result.missingGenerated.forEach((field) => {
        data.push({
          range: `${quoteSheetName(tabName)}!${toA1Column(nextColumn)}1`,
          majorDimension: 'ROWS',
          values: [[field.header]],
        });
        nextColumn += 1;
      });
    }
    await this.sheets.batchUpdateValues(this.spreadsheetId, data);
    await this.inspect();
    const presentation = buildSheetPresentationRequests(this.metadata.sheets || [], this.headers);
    await this.sheets.batchUpdate(this.spreadsheetId, presentation);
    await this.inspect();
    if (this.inspection.state !== 'current') throw new DatabaseStateError('Repair did not produce a current schema.', this.inspection.state);
    return this.synchronizeManualRows();
  }

  async setSetting(key, value) {
    const rows = mapSheetRows('Settings', this.inspection?.valuesByTab?.Settings || []);
    const current = rows.find((row) => row.key === key);
    if (current) {
      await this.#writeFields('Settings', current._rowNumber, { value });
    } else {
      await this.sheets.appendValues(this.spreadsheetId, `${quoteSheetName('Settings')}!A:C`, [[key, value, '']]);
    }
    this.settings.set(key, String(value));
  }

  async migrate(targetVersion = CURRENT_SCHEMA_VERSION) {
    const fromVersion = Number(this.settings.get('schema_version'));
    if (fromVersion === targetVersion) return this.inspect();
    if (this.inspection?.state !== 'upgradeable' && this.inspection?.state !== 'interrupted') {
      throw new DatabaseStateError('This inventory is not in an upgradeable state.', this.inspection?.state);
    }
    const path = migrationPath(fromVersion, targetVersion);
    if (!path) throw new Error(`No safe migration path exists from schema v${fromVersion} to v${targetVersion}.`);
    const backup = await this.drive.backupSpreadsheet(this.spreadsheetId, this.settings.get('root_folder_id'), fromVersion);
    await this.setSetting('migration_backup_id', backup.id);
    await this.setSetting('migration_from', fromVersion);
    await this.setSetting('migration_to', targetVersion);
    await this.setSetting('migration_state', 'running');
    try {
      for (const migration of path) {
        for (let index = 0; index < migration.steps.length; index += 1) {
          await migration.steps[index]({ database: this, sheets: this.sheets, drive: this.drive });
          await this.setSetting('migration_step', `${migration.to}:${index + 1}`);
        }
        await this.setSetting('schema_version', migration.to);
      }
      await this.setSetting('migration_state', 'idle');
      await this.setSetting('migration_step', '');
      await this.setSetting('updated_at', new Date().toISOString());
      return this.inspect();
    } catch (error) {
      await this.setSetting('migration_state', 'failed');
      this.writeEnabled = false;
      throw error;
    }
  }

  async runDiagnostics({ includeMedia = true } = {}) {
    const issues = [];
    const itemIds = uniqueBy(this.data.items, 'id');
    const placeIds = uniqueBy(this.data.places, 'id');
    const photoIds = uniqueBy(this.data.photos, 'id');
    for (const [tabName, collection, counts] of [
      ['Items', this.data.items, itemIds],
      ['Places', this.data.places, placeIds],
      ['Photos', this.data.photos, photoIds],
    ]) {
      collection.forEach((record) => {
        if (!record.id) issues.push({ severity: 'warning', tab: tabName, row: record._rowNumber, code: 'missing_id', message: 'Generated ID is missing.' });
        if (record.id && counts.get(record.id) > 1) issues.push({ severity: 'error', tab: tabName, row: record._rowNumber, code: 'duplicate_id', message: `Duplicate ID ${record.id}.` });
      });
    }

    const placeById = new Map(this.data.places.map((place) => [place.id, place]));
    this.data.places.forEach((place) => {
      if (place.parent && !place.parentId) issues.push({ severity: 'warning', tab: 'Places', row: place._rowNumber, code: 'unresolved_parent', message: `Parent “${place.parent}” is unresolved or ambiguous.` });
      const visited = new Set([place.id]);
      let parentId = place.parentId;
      while (parentId) {
        if (visited.has(parentId)) {
          issues.push({ severity: 'error', tab: 'Places', row: place._rowNumber, code: 'place_cycle', message: 'Place hierarchy contains a cycle.' });
          break;
        }
        visited.add(parentId);
        parentId = placeById.get(parentId)?.parentId || '';
      }
    });
    this.data.items.forEach((item) => {
      if (item.location && !item.placeId) issues.push({ severity: 'warning', tab: 'Items', row: item._rowNumber, code: 'unresolved_location', message: `Location “${item.location}” is unresolved or ambiguous.` });
      if (item.placeId && !placeById.has(item.placeId)) issues.push({ severity: 'error', tab: 'Items', row: item._rowNumber, code: 'missing_place', message: 'Place ID does not match a place.' });
    });
    const entities = new Set([...this.data.items, ...this.data.places].map((record) => record.id));
    this.data.photos.forEach((photo) => {
      if (!photo.entityId || !entities.has(photo.entityId)) issues.push({ severity: 'error', tab: 'Photos', row: photo._rowNumber, code: 'missing_entity', message: 'Photo entity is missing or unresolved.' });
      if (!['Drive', 'URL'].includes(canonicalSource(photo.source))) issues.push({ severity: 'warning', tab: 'Photos', row: photo._rowNumber, code: 'invalid_source', message: 'Source must be Drive or URL.' });
      if (!['Item', 'Place'].includes(canonicalEntityType(photo.entityType))) issues.push({ severity: 'warning', tab: 'Photos', row: photo._rowNumber, code: 'invalid_entity_type', message: 'Entity Type must be Item or Place.' });
      if (canonicalSource(photo.source) === 'URL') {
        try {
          safeHttpsUrl(photo.url);
        } catch {
          issues.push({ severity: 'warning', tab: 'Photos', row: photo._rowNumber, code: 'invalid_url', message: 'Public photo URL must use HTTPS.' });
        }
      }
      if (!Number.isInteger(Number(photo.order)) || Number(photo.order) <= 0) issues.push({ severity: 'warning', tab: 'Photos', row: photo._rowNumber, code: 'invalid_order', message: 'Order must be a positive integer.' });
    });

    if (includeMedia && this.settings.get('photos_folder_id') && this.settings.get('thumbnails_folder_id')) {
      const files = await this.drive.listFolderFiles([this.settings.get('photos_folder_id'), this.settings.get('thumbnails_folder_id')]);
      const referenced = new Set(this.data.photos.flatMap((photo) => [photo.driveFileId, photo.thumbnailFileId]).filter(Boolean));
      files.filter((file) => !referenced.has(file.id)).forEach((file) => {
        issues.push({ severity: 'info', tab: 'Drive', row: 0, code: 'unreferenced_media', fileId: file.id, message: `Unreferenced app-owned media: ${file.name}.` });
      });
    }
    return issues;
  }
}
