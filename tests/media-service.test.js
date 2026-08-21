import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MediaService,
  isLinkSharedDrivePhoto,
  publicDriveMediaUrl,
  publicDriveThumbnailUrl,
} from '../src/services/media-service.js';

test('recovery preserves the Picker-authorized original and replaces only its thumbnail', async () => {
  const original = new Blob(['original'], { type: 'image/jpeg' });
  const thumbnail = new Blob(['thumbnail'], { type: 'image/jpeg' });
  const calls = [];
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousDocument = globalThis.document;

  globalThis.createImageBitmap = async () => ({ width: 800, height: 600, close() {} });
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }),
        toBlob: (callback) => callback(thumbnail),
      };
    },
  };

  const photo = { id: 'photo-1', source: 'Drive', driveFileId: 'original-1', thumbnailFileId: 'old-thumb' };
  const recovered = { ...photo, thumbnailFileId: 'new-thumb' };
  const service = new MediaService({
    picker: { pickImage: async () => ({ id: 'original-1', name: 'photo.jpg', mimeType: 'image/jpeg' }) },
    drive: {
      downloadFile: async (id) => { calls.push(['download', id]); return original; },
      copyFile: async () => { throw new Error('recovery must not copy the Picker-authorized original'); },
      resumableUpload: async (_blob, options) => { calls.push(['upload', options.parentId]); return { id: 'new-thumb' }; },
    },
    database: {
      settings: new Map([['thumbnails_folder_id', 'thumb-folder']]),
      replaceDrivePhotoThumbnail: async (id, thumbnailFileId) => {
        calls.push(['replace-thumbnail', id, thumbnailFileId]);
        return recovered;
      },
    },
  });

  try {
    assert.deepEqual(await service.recoverDrivePhotoAccess(photo), recovered);
    assert.deepEqual(calls, [
      ['download', 'original-1'],
      ['upload', 'thumb-folder'],
      ['replace-thumbnail', 'photo-1', 'new-thumb'],
    ]);
    assert.match(await service.resolvePhotoUrl(photo, { thumbnail: false }), /^blob:/);
  } finally {
    service.destroy();
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.document = previousDocument;
  }
});

test('a failed old thumbnail does not block a replacement file for the same photo', async () => {
  const service = new MediaService({
    picker: {},
    database: {},
    drive: {
      downloadFile: async (id) => {
        if (id === 'old-thumb') throw Object.assign(new Error('not found'), { status: 404, reason: 'file_unavailable' });
        return new Blob(['replacement'], { type: 'image/jpeg' });
      },
    },
  });
  const oldPhoto = { id: 'photo-1', source: 'Drive', driveFileId: 'original-1', thumbnailFileId: 'old-thumb' };
  const recoveredPhoto = { ...oldPhoto, thumbnailFileId: 'new-thumb' };

  try {
    await assert.rejects(service.resolvePhotoUrl(oldPhoto), /not found/);
    assert.match(await service.resolvePhotoUrl(recoveredPhoto), /^blob:/);
  } finally {
    service.destroy();
  }
});

test('link-shared Drive photos resolve anonymously without calling the Drive API', async () => {
  const calls = [];
  const url = publicDriveMediaUrl('https://drive.google.com/open?id=original-1&resourcekey=key-1');
  const photo = { id: 'photo-1', source: 'Drive', driveFileId: 'original-1', thumbnailFileId: 'thumb-1', url };
  const service = new MediaService({
    picker: {},
    database: {},
    drive: { downloadFile: async (id) => { calls.push(id); throw new Error('must not authenticate'); } },
  });

  try {
    assert.equal(isLinkSharedDrivePhoto(photo), true);
    assert.equal(await service.resolvePhotoUrl(photo, { thumbnail: false }), url);
    assert.equal(await service.resolvePhotoUrl(photo), publicDriveThumbnailUrl(url));
    assert.deepEqual(calls, []);
  } finally {
    service.destroy();
  }
});

test('publishes both Drive files and records the anonymous original URL', async () => {
  const calls = [];
  const previousImage = globalThis.Image;
  globalThis.Image = class {
    set src(value) {
      this.value = value;
      queueMicrotask(() => this.onload?.());
    }
  };
  const photo = { id: 'photo-1', source: 'Drive', driveFileId: 'original-1', thumbnailFileId: 'thumb-1' };
  const service = new MediaService({
    picker: {},
    drive: {
      listPermissions: async (id) => { calls.push(['list', id]); return []; },
      shareFileWithLink: async (id) => { calls.push(['share', id]); return { id: `permission-${id}` }; },
      getFile: async (id) => ({ id, resourceKey: 'resource-1' }),
      removePermission: async () => { throw new Error('successful publication must not roll back'); },
    },
    database: {
      markDrivePhotoPublic: async (id, url) => { calls.push(['record', id, url]); return { ...photo, url }; },
    },
  });

  try {
    const result = await service.publishDrivePhoto(photo);
    assert.equal(isLinkSharedDrivePhoto(result), true);
    assert.deepEqual(calls.slice(0, 4), [
      ['list', 'original-1'],
      ['share', 'original-1'],
      ['list', 'thumb-1'],
      ['share', 'thumb-1'],
    ]);
    assert.equal(calls[4][0], 'record');
    assert.equal(calls[4][1], 'photo-1');
    assert.match(calls[4][2], /^https:\/\/drive\.usercontent\.google\.com\/download\?/);
    assert.match(calls[4][2], /resourcekey=resource-1/);
  } finally {
    service.destroy();
    globalThis.Image = previousImage;
  }
});

test('rolls back permissions created during an incomplete publication', async () => {
  const calls = [];
  const photo = { id: 'photo-1', source: 'Drive', driveFileId: 'original-1', thumbnailFileId: 'thumb-1' };
  const service = new MediaService({
    picker: {},
    drive: {
      listPermissions: async (id) => { calls.push(['list', id]); return []; },
      shareFileWithLink: async (id) => {
        calls.push(['share', id]);
        if (id === 'thumb-1') throw new Error('permission denied');
        return { id: 'permission-original' };
      },
      removePermission: async (fileId, permissionId) => { calls.push(['remove', fileId, permissionId]); },
    },
    database: {
      markDrivePhotoPublic: async () => { throw new Error('failed publication must not update the Sheet'); },
    },
  });

  try {
    await assert.rejects(service.publishDrivePhoto(photo), /could not publish.*permission denied/i);
    assert.deepEqual(calls, [
      ['list', 'original-1'],
      ['share', 'original-1'],
      ['list', 'thumb-1'],
      ['share', 'thumb-1'],
      ['remove', 'original-1', 'permission-original'],
    ]);
  } finally {
    service.destroy();
  }
});
