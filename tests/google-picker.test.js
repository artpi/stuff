import test from 'node:test';
import assert from 'node:assert/strict';

import { GooglePickerService } from '../src/services/google-picker.js';

function installPicker() {
  const state = { views: [], builder: null };

  class DocsView {
    constructor(id) {
      this.id = id;
      state.views.push(this);
    }

    setMimeTypes(mimeTypes) { this.mimeTypes = mimeTypes; return this; }
    setIncludeFolders(value) { this.includeFolders = value; return this; }
    setSelectFolderEnabled(value) { this.selectFolderEnabled = value; return this; }
    setOwnedByMe(value) { this.ownedByMe = value; return this; }
    setFileIds(value) { this.fileIds = value; return this; }
    setMode(value) { this.mode = value; return this; }
  }

  class PickerBuilder {
    constructor() { state.builder = this; }
    setTitle(value) { this.title = value; return this; }
    setOAuthToken() { return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    setOrigin() { return this; }
    enableFeature() { return this; }
    setCallback(value) { this.callback = value; return this; }
    addView(value) { this.view = value; return this; }
    build() { return this; }
    setVisible() { return this; }
  }

  globalThis.gapi = { load: (_name, options) => options.callback() };
  globalThis.google = { picker: {
    Action: { CANCEL: 'cancel', PICKED: 'picked' },
    DocsView,
    DocsViewMode: { LIST: 'list' },
    Feature: { SUPPORT_DRIVES: 'support-drives' },
    PickerBuilder,
    ViewId: { DOCS_IMAGES: 'images', FOLDERS: 'folders', SPREADSHEETS: 'spreadsheets' },
  } };
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://stuff.test' } });

  return state;
}

async function openAndCancel(method) {
  const state = installPicker();
  const service = new GooglePickerService({ getAccessToken: () => 'token' });
  const result = service[method]();
  await new Promise((resolve) => setImmediate(resolve));
  state.builder.callback({ action: 'cancel' });
  await result;
  return state.views[0];
}

test('existing-inventory Picker includes both owned and shared Sheets', async () => {
  const view = await openAndCancel('pickSpreadsheet');
  assert.equal(view.id, 'spreadsheets');
  assert.equal(view.ownedByMe, undefined);
});

test('image Picker includes both owned and shared images', async () => {
  const view = await openAndCancel('pickImage');
  assert.equal(view.id, 'images');
  assert.equal(view.ownedByMe, undefined);
});

test('folder Picker can present one exact shared folder for explicit authorization', async () => {
  const state = installPicker();
  const service = new GooglePickerService({ getAccessToken: () => 'token' });
  const result = service.pickFolder({ title: 'Authorize Photos folder', fileIds: ['photos-123'] });
  await new Promise((resolve) => setImmediate(resolve));

  const view = state.views[0];
  assert.equal(state.builder.title, 'Authorize Photos folder');
  assert.equal(view.id, 'folders');
  assert.equal(view.includeFolders, true);
  assert.equal(view.selectFolderEnabled, true);
  assert.equal(view.fileIds, 'photos-123');
  assert.equal(view.mode, 'list');

  state.builder.callback({ action: 'picked', docs: [{ id: 'photos-123', name: 'Photos', mimeType: 'application/vnd.google-apps.folder' }] });
  assert.deepEqual(await result, { id: 'photos-123', name: 'Photos', mimeType: 'application/vnd.google-apps.folder' });
});
