import { GOOGLE_CONFIG } from '../config.js';

const MIME = Object.freeze({
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  folder: 'application/vnd.google-apps.folder',
  images: 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif',
});

function waitForPicker(timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (!globalThis.gapi?.load) {
        if (Date.now() - startedAt >= timeout) {
          reject(new Error('Google Picker did not load. Check content blockers and your connection.'));
          return;
        }
        globalThis.setTimeout(check, 100);
        return;
      }
      globalThis.gapi.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('Google Picker could not be initialized.')),
        timeout,
        ontimeout: () => reject(new Error('Google Picker initialization timed out.')),
      });
    };
    check();
  });
}

export class GooglePickerService {
  constructor({ getAccessToken }) {
    this.getAccessToken = getAccessToken;
  }

  async pickSpreadsheet() {
    await waitForPicker();
    const view = new globalThis.google.picker.DocsView(globalThis.google.picker.ViewId.SPREADSHEETS)
      .setMimeTypes(MIME.spreadsheet);
    return this.#open({ title: 'Choose a stuff inventory', views: [view] });
  }

  async pickFolder({ title = 'Choose where to create the stuff folder', fileIds = [] } = {}) {
    await waitForPicker();
    const view = new globalThis.google.picker.DocsView(globalThis.google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(MIME.folder);
    if (fileIds.length) view.setFileIds(fileIds.join(','));
    if (globalThis.google.picker.DocsViewMode?.LIST) view.setMode(globalThis.google.picker.DocsViewMode.LIST);
    return this.#open({ title, views: [view] });
  }

  async pickImage({ title = 'Choose an image from Google Drive', fileIds = [] } = {}) {
    await waitForPicker();
    const view = new globalThis.google.picker.DocsView(globalThis.google.picker.ViewId.DOCS_IMAGES)
      .setMimeTypes(MIME.images);
    if (fileIds.length) view.setFileIds(fileIds.join(','));
    return this.#open({ title, views: [view] });
  }

  #open({ title, views }) {
    const token = this.getAccessToken();
    if (!token) return Promise.reject(new Error('Reconnect Google before opening Picker.'));
    return new Promise((resolve, reject) => {
      const builder = new globalThis.google.picker.PickerBuilder()
        .setTitle(title)
        .setOAuthToken(token)
        .setDeveloperKey(GOOGLE_CONFIG.pickerApiKey)
        .setAppId(GOOGLE_CONFIG.projectNumber)
        .setOrigin(globalThis.location.origin)
        .enableFeature(globalThis.google.picker.Feature.SUPPORT_DRIVES)
        .setCallback((data) => {
          if (data.action === globalThis.google.picker.Action.PICKED) {
            const document = data.docs?.[0];
            if (!document?.id) reject(new Error('Google Picker returned no file.'));
            else resolve({ id: document.id, name: document.name || document.id, mimeType: document.mimeType || '' });
          } else if (data.action === globalThis.google.picker.Action.CANCEL) {
            resolve(null);
          }
        });
      views.forEach((view) => builder.addView(view));
      builder.build().setVisible(true);
    });
  }
}
