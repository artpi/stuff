import test from 'node:test';
import assert from 'node:assert/strict';

import { MediaService } from '../src/services/media-service.js';

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
