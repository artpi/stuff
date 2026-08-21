export function createUuid(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeHeader(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

export function normalizeSearchText(value) {
  return String(value ?? '')
    .replace(/[łŁ]/g, 'l')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function parseTags(value) {
  const seen = new Set();
  return String(value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      const normalized = normalizeSearchText(tag);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function moveIdToIndex(ids, movedId, targetId) {
  const next = [...ids];
  const fromIndex = next.indexOf(movedId);
  const targetIndex = next.indexOf(targetId);
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return next;
  const [moved] = next.splice(fromIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function toA1Column(index) {
  let value = Number(index) + 1;
  let column = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
}

export function quoteSheetName(name) {
  return `'${String(name).replaceAll("'", "''")}'`;
}

export function parsePositiveNumber(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function safeHttpsUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:') {
    throw new TypeError('Only HTTPS URLs are supported.');
  }
  if (url.username || url.password) {
    throw new TypeError('URLs containing credentials are not supported.');
  }
  return url;
}

export function parsePublicDriveUrl(value) {
  const url = safeHttpsUrl(value);
  const isDrive = url.hostname === 'drive.google.com'
    || url.hostname === 'docs.google.com'
    || url.hostname === 'drive.usercontent.google.com';
  if (!isDrive) return null;

  const pathMatch = url.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const fileId = pathMatch?.[1] || url.searchParams.get('id');
  if (!fileId) return null;
  const resourceKey = url.searchParams.get('resourcekey') || url.searchParams.get('resourceKey');
  return { fileId, resourceKey, originalUrl: url.href };
}

export function compareSemver(left, right) {
  const parse = (version) => String(version || '0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

export function humanFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function wait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export function debounce(callback, milliseconds = 120) {
  let timeoutId;
  return (...args) => {
    globalThis.clearTimeout(timeoutId);
    timeoutId = globalThis.setTimeout(() => callback(...args), milliseconds);
  };
}

export function isIos() {
  return /iPad|iPhone|iPod/.test(globalThis.navigator?.userAgent || '')
    || (globalThis.navigator?.platform === 'MacIntel' && globalThis.navigator?.maxTouchPoints > 1);
}
