const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const INVENTORY_NAME = 'stuff — Inventory';

function cleanFilename(value, fallback = 'photo') {
  const cleaned = String(value || fallback)
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 180) || fallback;
}

export class DriveClient {
  constructor(api, { getAccessToken, onAuthorizationError } = {}) {
    this.api = api;
    this.getAccessToken = getAccessToken;
    this.onAuthorizationError = onAuthorizationError;
  }

  createFolder(name, parentId = '') {
    return this.api.request(`${DRIVE_BASE}/files`, {
      method: 'POST',
      query: { fields: 'id,name,mimeType,parents,webViewLink,trashed,capabilities' },
      body: { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) },
    });
  }

  createSpreadsheetFile(name, parentId) {
    return this.api.request(`${DRIVE_BASE}/files`, {
      method: 'POST',
      query: { fields: 'id,name,mimeType,parents,webViewLink,trashed,capabilities' },
      body: {
        name,
        mimeType: SHEET_MIME,
        parents: [parentId],
        appProperties: { stuffDatabase: 'true' },
      },
    });
  }

  listInventoryFiles() {
    return this.api.request(`${DRIVE_BASE}/files`, {
      query: {
        q: `mimeType = '${SHEET_MIME}' and trashed = false and (name = '${INVENTORY_NAME}' or appProperties has { key='stuffDatabase' and value='true' })`,
        fields: 'files(id,name,mimeType,parents,webViewLink,createdTime,modifiedTime,appProperties)',
        orderBy: 'modifiedTime desc',
        pageSize: 100,
        spaces: 'drive',
      },
    }).then((response) => response.files || []);
  }

  async createInventoryFiles(parentId = '') {
    const root = await this.createFolder('stuff', parentId);
    try {
      const photos = await this.createFolder('Photos', root.id);
      const thumbnails = await this.createFolder('Thumbnails', root.id);
      const spreadsheet = await this.createSpreadsheetFile(INVENTORY_NAME, root.id);
      return { root, photos, thumbnails, spreadsheet };
    } catch (error) {
      try {
        await this.trashFile(root.id);
      } catch {
        // Keep the original setup error; a partial root is safe and visible in Drive trash.
      }
      throw error;
    }
  }

  getFile(fileId, fields = 'id,name,mimeType,parents,webViewLink,trashed,capabilities,size,createdTime,modifiedTime,driveId,isAppAuthorized') {
    return this.api.request(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`, {
      query: { fields, supportsAllDrives: true },
    });
  }

  getAbout() {
    return this.api.request(`${DRIVE_BASE}/about`, { query: { fields: 'user' } });
  }

  shareFolder(folderId, emailAddress) {
    return this.api.request(`${DRIVE_BASE}/files/${encodeURIComponent(folderId)}/permissions`, {
      method: 'POST',
      query: { sendNotificationEmail: true, supportsAllDrives: true, fields: 'id,type,role,emailAddress' },
      body: { type: 'user', role: 'writer', emailAddress: String(emailAddress).trim() },
    });
  }

  copyFile(fileId, { name, parentId }) {
    return this.api.request(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/copy`, {
      method: 'POST',
      query: { supportsAllDrives: true, fields: 'id,name,mimeType,parents,size,capabilities,webViewLink' },
      body: { name: cleanFilename(name), parents: [parentId] },
    });
  }

  async backupSpreadsheet(fileId, rootFolderId, schemaVersion, timestamp = new Date()) {
    let backupFolder;
    const query = `'${rootFolderId.replaceAll("'", "\\'")}' in parents and name = 'Backups' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const existing = await this.api.request(`${DRIVE_BASE}/files`, {
      query: { q: query, fields: 'files(id,name)', spaces: 'drive', pageSize: 1 },
    });
    backupFolder = existing.files?.[0] || await this.createFolder('Backups', rootFolderId);
    const safeTimestamp = timestamp.toISOString().replaceAll(':', '-');
    return this.copyFile(fileId, {
      parentId: backupFolder.id,
      name: `stuff backup — schema v${schemaVersion} — ${safeTimestamp}`,
    });
  }

  downloadFile(fileId) {
    return this.api.request(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`, {
      query: { alt: 'media', supportsAllDrives: true },
      responseType: 'blob',
    });
  }

  listFolderFiles(folderIds) {
    const parents = folderIds.map((id) => `'${String(id).replaceAll("'", "\\'")}' in parents`).join(' or ');
    if (!parents) return Promise.resolve([]);
    return this.api.request(`${DRIVE_BASE}/files`, {
      query: {
        q: `(${parents}) and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,parents,size,capabilities,webViewLink)',
        pageSize: 1000,
        spaces: 'drive',
      },
    }).then((response) => response.files || []);
  }

  trashFile(fileId) {
    return this.api.request(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`, {
      method: 'PATCH',
      query: { supportsAllDrives: true, fields: 'id,trashed' },
      body: { trashed: true },
    });
  }

  async resumableUpload(blob, { name, parentId, onProgress = () => {} }) {
    const token = this.getAccessToken();
    if (!token) throw new Error('Reconnect Google before uploading.');
    const metadata = { name: cleanFilename(name), parents: [parentId] };
    const sessionResponse = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,name,mimeType,size,parents,capabilities,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': blob.type || 'application/octet-stream',
        'X-Upload-Content-Length': String(blob.size),
      },
      body: JSON.stringify(metadata),
    });
    if (sessionResponse.status === 401) this.onAuthorizationError?.();
    if (!sessionResponse.ok) throw new Error(`Could not start photo upload (${sessionResponse.status}).`);
    const sessionUrl = sessionResponse.headers.get('Location');
    if (!sessionUrl) throw new Error('Google did not return an upload session.');

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('PUT', sessionUrl);
      request.setRequestHeader('Authorization', `Bearer ${this.getAccessToken()}`);
      request.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      request.addEventListener('load', () => {
        if (request.status >= 200 && request.status < 300) {
          onProgress(1);
          try {
            resolve(JSON.parse(request.responseText));
          } catch {
            reject(new Error('Google returned an unreadable upload response.'));
          }
        } else {
          if (request.status === 401) this.onAuthorizationError?.();
          reject(new Error(`Photo upload failed (${request.status}).`));
        }
      });
      request.addEventListener('error', () => reject(new Error('Photo upload failed because the network connection was lost.')));
      request.addEventListener('abort', () => reject(new DOMException('Photo upload was canceled.', 'AbortError')));
      request.send(blob);
    });
  }
}

export { FOLDER_MIME, INVENTORY_NAME, SHEET_MIME, cleanFilename };
