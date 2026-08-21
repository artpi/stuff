import { createUuid, parsePublicDriveUrl, safeHttpsUrl } from '../utils.js';

function extensionFor(file) {
  const fromName = String(file.name || '').match(/\.([a-zA-Z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLocaleLowerCase('en-US');
  const byType = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' };
  return byType[file.type] || 'image';
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image format cannot be previewed in the browser.'));
    };
    image.src = url;
  });
}

export async function createThumbnail(file, maximumEdge = 480) {
  let source;
  let width;
  let height;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    width = source.width;
    height = source.height;
  } catch {
    source = await loadImage(file);
    width = source.naturalWidth;
    height = source.naturalHeight;
  }
  const scale = Math.min(1, maximumEdge / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#f7f2e8';
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  source.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('The browser could not create a thumbnail.')),
      'image/jpeg',
      0.82,
    );
  });
}

export function validatePublicImage(urlValue, timeout = 12_000) {
  const url = safeHttpsUrl(urlValue);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeoutId = globalThis.setTimeout(() => {
      image.src = '';
      reject(new Error('The public image took too long to load.'));
    }, timeout);
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      globalThis.clearTimeout(timeoutId);
      resolve(url.href);
    };
    image.onerror = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new Error('This URL is not an anonymously readable image.'));
    };
    image.src = url.href;
  });
}

export function publicDriveMediaUrl(urlValue) {
  const parsed = parsePublicDriveUrl(urlValue);
  if (!parsed) return null;
  const url = new URL('https://drive.usercontent.google.com/download');
  url.searchParams.set('id', parsed.fileId);
  url.searchParams.set('export', 'view');
  url.searchParams.set('authuser', '0');
  if (parsed.resourceKey) url.searchParams.set('resourcekey', parsed.resourceKey);
  return url.href;
}

class BlobUrlCache {
  constructor(limit = 80) {
    this.limit = limit;
    this.entries = new Map();
  }

  get(key) {
    const url = this.entries.get(key);
    if (!url) return '';
    this.entries.delete(key);
    this.entries.set(key, url);
    return url;
  }

  set(key, blob) {
    const existing = this.entries.get(key);
    if (existing) URL.revokeObjectURL(existing);
    const url = URL.createObjectURL(blob);
    this.entries.set(key, url);
    while (this.entries.size > this.limit) {
      const [oldestKey, oldestUrl] = this.entries.entries().next().value;
      this.entries.delete(oldestKey);
      URL.revokeObjectURL(oldestUrl);
    }
    return url;
  }

  clear() {
    this.entries.forEach((url) => URL.revokeObjectURL(url));
    this.entries.clear();
  }
}

export class MediaService extends EventTarget {
  constructor({ drive, database, picker }) {
    super();
    this.drive = drive;
    this.database = database;
    this.picker = picker;
    this.cache = new BlobUrlCache();
    this.unavailablePhotoIds = new Set();
    this.photoAccessGenerations = new Map();
    this.activeUploads = 0;
    this.beforeUnload = (event) => {
      if (!this.activeUploads) return;
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener?.('beforeunload', this.beforeUnload);
  }

  get uploading() {
    return this.activeUploads > 0;
  }

  async resolvePhotoUrl(photo, { thumbnail = true } = {}) {
    if (String(photo.source).toLocaleLowerCase('en-US') === 'url') {
      return publicDriveMediaUrl(photo.url) || safeHttpsUrl(photo.url).href;
    }
    const fileId = thumbnail && photo.thumbnailFileId ? photo.thumbnailFileId : photo.driveFileId;
    if (!fileId) return '';
    if (this.unavailablePhotoIds.has(photo.id)) throw new Error('This Drive photo needs its access recovered.');
    const generation = this.photoAccessGenerations.get(photo.id) || 0;
    const cached = this.cache.get(fileId);
    if (cached) return cached;
    try {
      const blob = await this.drive.downloadFile(fileId);
      return this.cache.set(fileId, blob);
    } catch (error) {
      if ((this.photoAccessGenerations.get(photo.id) || 0) === generation) this.unavailablePhotoIds.add(photo.id);
      throw error;
    }
  }

  async uploadFiles(files, entity, onProgress = () => {}) {
    const queue = [...files];
    const completed = [];
    for (let index = 0; index < queue.length; index += 1) {
      const file = queue[index];
      try {
        const photo = await this.#uploadFile(file, entity, (stage, progress) => onProgress({ index, total: queue.length, file, stage, progress, completed: completed.length }));
        completed.push(photo);
        onProgress({ index, total: queue.length, file, stage: 'complete', progress: 1, completed: completed.length });
      } catch (error) {
        error.completedPhotos = completed;
        throw error;
      }
    }
    return completed;
  }

  async #uploadFile(file, entity, onProgress) {
    this.activeUploads += 1;
    this.dispatchEvent(new CustomEvent('uploadstatechange', { detail: { active: this.activeUploads } }));
    let fullFile;
    let thumbnailFile;
    try {
      onProgress('thumbnail', 0);
      const thumbnail = await createThumbnail(file);
      const unique = createUuid();
      const extension = extensionFor(file);
      const base = `${entity.id}-${unique}`;
      onProgress('full', 0);
      fullFile = await this.drive.resumableUpload(file, {
        name: `${base}.${extension}`,
        parentId: this.database.settings.get('photos_folder_id'),
        onProgress: (progress) => onProgress('full', progress),
      });
      onProgress('thumbnail', 0.2);
      thumbnailFile = await this.drive.resumableUpload(thumbnail, {
        name: `${base}-thumb.jpg`,
        parentId: this.database.settings.get('thumbnails_folder_id'),
        onProgress: (progress) => onProgress('thumbnail', 0.2 + progress * 0.8),
      });
      return await this.database.addDrivePhoto({
        entityType: entity.entityType,
        entityId: entity.id,
        entity: entity.entityType === 'Place' ? entity.path : entity.name,
        driveFileId: fullFile.id,
        thumbnailFileId: thumbnailFile.id,
        url: fullFile.webViewLink || '',
      });
    } catch (error) {
      // Keep successfully uploaded files for diagnostics; automatic deletion could
      // remove a file that was attached before a later Sheet request failed.
      throw error;
    } finally {
      this.activeUploads -= 1;
      this.dispatchEvent(new CustomEvent('uploadstatechange', { detail: { active: this.activeUploads } }));
    }
  }

  async importPickerImage(entity, onProgress = () => {}) {
    const selection = await this.picker.pickImage();
    if (!selection) return null;
    this.activeUploads += 1;
    this.dispatchEvent(new CustomEvent('uploadstatechange', { detail: { active: this.activeUploads } }));
    try {
      onProgress({ stage: 'copy', progress: 0.1 });
      const full = await this.drive.copyFile(selection.id, {
        name: `${entity.id}-${createUuid()}-${selection.name}`,
        parentId: this.database.settings.get('photos_folder_id'),
      });
      onProgress({ stage: 'thumbnail', progress: 0.35 });
      const original = await this.drive.downloadFile(full.id);
      const thumbnail = await createThumbnail(original);
      const thumb = await this.drive.resumableUpload(thumbnail, {
        name: `${entity.id}-${createUuid()}-thumb.jpg`,
        parentId: this.database.settings.get('thumbnails_folder_id'),
        onProgress: (progress) => onProgress({ stage: 'thumbnail', progress: 0.35 + progress * 0.6 }),
      });
      const photo = await this.database.addDrivePhoto({
        entityType: entity.entityType,
        entityId: entity.id,
        entity: entity.entityType === 'Place' ? entity.path : entity.name,
        driveFileId: full.id,
        thumbnailFileId: thumb.id,
        url: full.webViewLink || '',
      });
      onProgress({ stage: 'complete', progress: 1 });
      return photo;
    } finally {
      this.activeUploads -= 1;
      this.dispatchEvent(new CustomEvent('uploadstatechange', { detail: { active: this.activeUploads } }));
    }
  }

  async recoverDrivePhotoAccess(photo, onProgress = () => {}) {
    if (String(photo.source).toLocaleLowerCase('en-US') !== 'drive' || !photo.driveFileId) {
      throw new TypeError('Only Drive photos with an original file can be recovered.');
    }
    const selection = await this.picker.pickImage({
      title: 'Recover photo access',
      fileIds: [photo.driveFileId],
    });
    if (!selection) return null;
    if (selection.id !== photo.driveFileId) {
      throw new Error('Choose the highlighted original photo so stuff can restore access to this record.');
    }
    this.activeUploads += 1;
    this.dispatchEvent(new CustomEvent('uploadstatechange', { detail: { active: this.activeUploads } }));
    try {
      onProgress({ stage: 'downloading', progress: 0.15 });
      // Selecting the referenced original in Picker is the durable drive.file
      // grant. Keep that exact ID; a copy made through files.copy is not a
      // substitute for explicitly opening the file with this app.
      const original = await this.drive.downloadFile(selection.id);
      onProgress({ stage: 'thumbnail', progress: 0.45 });
      const thumbnail = await createThumbnail(original);
      const thumb = await this.drive.resumableUpload(thumbnail, {
        name: `${photo.id}-${createUuid()}-thumb.jpg`,
        parentId: this.database.settings.get('thumbnails_folder_id'),
        onProgress: (progress) => onProgress({ stage: 'thumbnail', progress: 0.45 + progress * 0.5 }),
      });
      onProgress({ stage: 'linking', progress: 0.97 });
      const recovered = await this.database.replaceDrivePhotoThumbnail(photo.id, thumb.id);
      this.cache.set(selection.id, original);
      this.cache.set(thumb.id, thumbnail);
      this.unavailablePhotoIds.delete(photo.id);
      this.photoAccessGenerations.set(photo.id, (this.photoAccessGenerations.get(photo.id) || 0) + 1);
      onProgress({ stage: 'complete', progress: 1 });
      return recovered;
    } finally {
      this.activeUploads -= 1;
      this.dispatchEvent(new CustomEvent('uploadstatechange', { detail: { active: this.activeUploads } }));
    }
  }

  async addPublicUrl(entity, urlValue, description = '') {
    const driveUrl = publicDriveMediaUrl(urlValue);
    const validatedUrl = await validatePublicImage(driveUrl || urlValue);
    return this.database.addUrlPhoto({
      entityType: entity.entityType,
      entityId: entity.id,
      entity: entity.entityType === 'Place' ? entity.path : entity.name,
      url: driveUrl ? safeHttpsUrl(urlValue).href : validatedUrl,
      description,
    });
  }

  destroy() {
    globalThis.removeEventListener?.('beforeunload', this.beforeUnload);
    this.cache.clear();
  }
}
