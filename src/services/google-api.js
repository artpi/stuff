export class GoogleApiError extends Error {
  constructor(message, { status = 0, reason = 'unknown', details = null, url = '' } = {}) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
    this.reason = reason;
    this.details = details;
    this.url = url;
  }
}

function classifyError(status, payload) {
  if (globalThis.navigator?.onLine === false) return 'network_unavailable';
  if (status === 401) return 'authorization_expired';
  if (status === 403) {
    const reason = payload?.error?.errors?.[0]?.reason || '';
    if (reason === 'insufficientFilePermissions' || reason === 'forbidden') return 'file_permission_missing';
    return 'access_denied';
  }
  if (status === 404) return 'file_unavailable';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'google_unavailable';
  return 'request_failed';
}

export class GoogleApiClient {
  constructor({ getAccessToken, onAuthorizationError } = {}) {
    this.getAccessToken = getAccessToken;
    this.onAuthorizationError = onAuthorizationError;
  }

  async request(url, { method = 'GET', query, body, headers = {}, responseType = 'json', signal } = {}) {
    const requestUrl = new URL(url);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') requestUrl.searchParams.set(key, String(value));
    });
    const token = this.getAccessToken?.();
    if (!token) {
      throw new GoogleApiError('Google authorization is required.', { reason: 'authorization_expired', url: requestUrl.origin + requestUrl.pathname });
    }

    const requestHeaders = new Headers(headers);
    requestHeaders.set('Authorization', `Bearer ${token}`);
    let requestBody = body;
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && typeof body !== 'string') {
      requestHeaders.set('Content-Type', 'application/json');
      requestBody = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(requestUrl, { method, headers: requestHeaders, body: requestBody, signal });
    } catch (error) {
      throw new GoogleApiError('Could not reach Google. Check your connection and try again.', {
        reason: 'network_unavailable',
        details: error,
        url: requestUrl.origin + requestUrl.pathname,
      });
    }

    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const reason = classifyError(response.status, payload);
      if (response.status === 401) this.onAuthorizationError?.();
      const message = payload?.error?.message || `Google request failed (${response.status}).`;
      throw new GoogleApiError(message, {
        status: response.status,
        reason,
        details: payload,
        url: requestUrl.origin + requestUrl.pathname,
      });
    }

    if (responseType === 'response') return response;
    if (responseType === 'blob') return response.blob();
    if (responseType === 'text') return response.text();
    if (response.status === 204) return null;
    return response.json();
  }
}

export function friendlyGoogleError(error) {
  const messages = {
    authorization_expired: 'Your Google access expired. Reconnect to continue; your unsaved form is still here.',
    file_permission_missing: 'This Google account cannot edit the selected inventory file.',
    access_denied: 'Google denied this action. Check the file permissions and account.',
    file_unavailable: 'The selected file was moved to trash, deleted, or is no longer available to this account.',
    network_unavailable: 'You appear to be offline. stuff needs a connection to read or save inventory data.',
    rate_limited: 'Google is receiving too many requests. Wait a moment and try again.',
    google_unavailable: 'Google is temporarily unavailable. Try again shortly.',
  };
  return messages[error?.reason] || error?.message || 'Something went wrong while talking to Google.';
}
