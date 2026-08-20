import { createUuid, normalizeSearchText, parsePositiveNumber } from '../utils.js';

const now = () => new Date().toISOString();

export class DemoDatabase extends EventTarget {
  constructor() {
    super();
    this.spreadsheetId = 'demo-spreadsheet';
    this.settings = new Map([
      ['database_type', 'stuff'],
      ['database_id', 'demo'],
      ['schema_version', '1'],
      ['minimum_app_version', '0.1.0'],
      ['migration_state', 'idle'],
      ['root_folder_id', 'demo-root'],
      ['photos_folder_id', 'demo-photos'],
      ['thumbnails_folder_id', 'demo-thumbnails'],
    ]);
    this.inspection = { state: 'current', messages: [], schemaVersion: 1 };
    this.writeEnabled = true;
    this.data = {
      places: [
        { id: 'home', name: 'Home', parent: '', parentId: '', path: 'Home', description: '', photoCount: 0, version: 1 },
        { id: 'office', name: 'Office', parent: 'Home', parentId: 'home', path: 'Home / Office', description: 'The quiet room upstairs', photoCount: 0, version: 1 },
        { id: 'cabinet', name: 'Tall cabinet', parent: 'Home / Office', parentId: 'office', path: 'Home / Office / Tall cabinet', description: '', photoCount: 0, version: 1 },
        { id: 'basement', name: 'Basement', parent: 'Home', parentId: 'home', path: 'Home / Basement', description: '', photoCount: 0, version: 1 },
        { id: 'sports-box', name: 'Sports box', parent: 'Home / Basement', parentId: 'basement', path: 'Home / Basement / Sports box', description: '', photoCount: 0, version: 1 },
      ],
      items: [
        { id: 'maps', name: 'Old maps', location: 'Home / Office / Tall cabinet', placeId: 'cabinet', description: 'School maps and a city plan', tags: 'maps, paper, school', quantity: 2, photoCount: 1, coverPhoto: '', createdAt: now(), updatedAt: now(), version: 1 },
        { id: 'drill', name: 'Cordless drill', location: 'Home / Basement', placeId: 'basement', description: 'Charger in the same case', tags: 'tools, repair', quantity: 1, photoCount: 1, coverPhoto: '', createdAt: now(), updatedAt: now(), version: 1 },
        { id: 'skates', name: 'Roller skates', location: 'Home / Basement / Sports box', placeId: 'sports-box', description: 'Adjustable size', tags: 'sport, children', quantity: 2, photoCount: 1, coverPhoto: '', createdAt: now(), updatedAt: now(), version: 1 },
        { id: 'passport-case', name: 'Passport case', location: 'Home / Office', placeId: 'office', description: 'Documents only; passports are elsewhere', tags: 'documents, travel', quantity: 1, photoCount: 0, coverPhoto: '', createdAt: now(), updatedAt: now(), version: 1 },
      ],
      photos: [
        { id: 'photo-maps', entityType: 'Item', entityId: 'maps', entity: 'Old maps', source: 'Drive', url: 'assets/demo/maps.svg', order: 1, driveFileId: 'demo-maps', thumbnailFileId: 'demo-maps-thumb' },
        { id: 'photo-drill', entityType: 'Item', entityId: 'drill', entity: 'Cordless drill', source: 'Drive', url: 'assets/demo/tools.svg', order: 1, driveFileId: 'demo-tools', thumbnailFileId: 'demo-tools-thumb' },
        { id: 'photo-skates', entityType: 'Item', entityId: 'skates', entity: 'Roller skates', source: 'Drive', url: 'assets/demo/skates.svg', order: 1, driveFileId: 'demo-skates', thumbnailFileId: 'demo-skates-thumb' },
      ],
    };
  }

  #changed() {
    this.dispatchEvent(new CustomEvent('datachange', { detail: this.data }));
  }

  async inspect() { return this.inspection; }
  async synchronizeManualRows() { this.#changed(); return { updatedCells: 0, diagnostics: [] }; }
  async repairSchema() { return this.synchronizeManualRows(); }
  async migrate() { return this.inspection; }
  async runDiagnostics() { return []; }

  descendantPlaceIds(placeId, includeSelf = true) {
    const result = new Set(includeSelf ? [placeId] : []);
    let added = true;
    while (added) {
      added = false;
      this.data.places.forEach((place) => {
        if (result.has(place.parentId) && !result.has(place.id)) { result.add(place.id); added = true; }
      });
    }
    return result;
  }

  photosFor(entityId) {
    return this.data.photos.filter((photo) => photo.entityId === entityId).sort((a, b) => Number(a.order) - Number(b.order));
  }

  async createItem(values) {
    const place = this.data.places.find((candidate) => candidate.id === values.placeId);
    const item = {
      id: createUuid(), name: String(values.name).trim(), location: place?.path || '', placeId: place?.id || '',
      description: values.description || '', tags: values.tags || '', quantity: parsePositiveNumber(values.quantity, 1),
      photoCount: 0, coverPhoto: '', createdAt: now(), updatedAt: now(), version: 1,
    };
    this.data.items.unshift(item); this.#changed(); return item;
  }

  async updateItem(id, values) {
    const item = this.data.items.find((candidate) => candidate.id === id);
    const place = this.data.places.find((candidate) => candidate.id === values.placeId);
    Object.assign(item, values, { location: place?.path || values.location || '', placeId: place?.id || '', updatedAt: now(), version: Number(item.version) + 1 });
    this.#changed(); return item;
  }

  async createPlace(values) {
    const parent = this.data.places.find((candidate) => candidate.id === values.parentId);
    const place = { id: createUuid(), name: String(values.name).trim(), parent: parent?.path || '', parentId: parent?.id || '', path: parent ? `${parent.path} / ${String(values.name).trim()}` : String(values.name).trim(), description: values.description || '', photoCount: 0, version: 1 };
    this.data.places.push(place); this.#changed(); return place;
  }

  async updatePlace(id, values) {
    const place = this.data.places.find((candidate) => candidate.id === id);
    const parent = this.data.places.find((candidate) => candidate.id === values.parentId);
    const oldPath = place.path;
    Object.assign(place, values, { parent: parent?.path || '', parentId: parent?.id || '', path: parent ? `${parent.path} / ${values.name}` : values.name, version: Number(place.version) + 1 });
    this.data.places.forEach((candidate) => { if (candidate.path.startsWith(`${oldPath} /`)) candidate.path = place.path + candidate.path.slice(oldPath.length); });
    this.data.items.forEach((item) => { const location = this.data.places.find((candidate) => candidate.id === item.placeId); if (location) item.location = location.path; });
    this.#changed(); return place;
  }

  async addDrivePhoto(values) { return this.#addPhoto({ ...values, source: 'Drive' }); }
  async addUrlPhoto(values) { return this.#addPhoto({ ...values, source: 'URL' }); }
  #addPhoto(values) {
    const photo = { id: createUuid(), order: this.photosFor(values.entityId).length + 1, createdAt: now(), ...values };
    this.data.photos.push(photo);
    const collection = values.entityType === 'Place' ? this.data.places : this.data.items;
    const entity = collection.find((candidate) => candidate.id === values.entityId);
    if (entity) entity.photoCount = this.photosFor(entity.id).length;
    this.#changed(); return photo;
  }

  async reorderPhotos(entityId, ids) { ids.forEach((id, index) => { const photo = this.data.photos.find((candidate) => candidate.id === id && candidate.entityId === entityId); if (photo) photo.order = index + 1; }); this.#changed(); }
  async removePhoto(photoId) { const photo = this.data.photos.find((candidate) => candidate.id === photoId); this.data.photos = this.data.photos.filter((candidate) => candidate.id !== photoId); const entity = [...this.data.items, ...this.data.places].find((candidate) => candidate.id === photo?.entityId); if (entity) entity.photoCount = this.photosFor(entity.id).length; this.#changed(); }
}

export class DemoMediaService extends EventTarget {
  constructor(database) { super(); this.database = database; this.activeUploads = 0; }
  get uploading() { return this.activeUploads > 0; }
  async resolvePhotoUrl(photo) { return photo.url || ''; }
  async uploadFiles(files, entity, onProgress = () => {}) {
    const completed = [];
    for (let index = 0; index < files.length; index += 1) {
      onProgress({ index, total: files.length, file: files[index], stage: 'full', progress: 0.5, completed: index });
      const photo = await this.database.addDrivePhoto({ entityType: entity.entityType, entityId: entity.id, entity: entity.name || entity.path, driveFileId: createUuid(), thumbnailFileId: createUuid(), url: 'assets/demo/maps.svg' });
      completed.push(photo);
      onProgress({ index, total: files.length, file: files[index], stage: 'complete', progress: 1, completed: index + 1 });
    }
    return completed;
  }
  async importPickerImage() { return null; }
  async addPublicUrl(entity, url) { return this.database.addUrlPhoto({ entityType: entity.entityType, entityId: entity.id, entity: entity.name || entity.path, url }); }
  destroy() {}
}
