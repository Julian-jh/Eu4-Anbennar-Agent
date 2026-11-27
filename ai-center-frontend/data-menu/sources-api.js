(() => {
  'use strict';

  const base = '/api/v1';
  const pending = new Set();
  let token = '';
  let session = 0;

  class ApiError extends Error {
    constructor(status, code, message, requestId = null) {
      super(message);
      this.name = 'SourcesApiError';
      this.status = status;
      this.code = code;
      this.requestId = requestId;
      this.retryable = status === 0 || status === 408 || status === 429 || status >= 500;
    }
  }

  function setToken(value) {
    const next = value.trim();
    if (next === token) return;
    token = next;
    session++;
    for (const controller of pending) controller.abort();
  }

  function checkSession(started) {
    if (session !== started) {
      throw new ApiError(409, 'session_changed', 'The active Sources credential changed. Reload this view.');
    }
  }

  function segment(id) {
    if (typeof id !== 'string' || !id || id === '.' || id === '..') {
      throw new TypeError('An asset, source or operation ID is required.');
    }
    return encodeURIComponent(id);
  }

  function query(values, allowed) {
    const params = new URLSearchParams();
    for (const name of allowed) {
      const value = values[name];
      if (value !== undefined && value !== null && value !== '') params.set(name, String(value));
    }
    const text = params.toString();
    return text ? '?' + text : '';
  }

  async function request(path, {method = 'GET', body, key, etag} = {}) {
    if (method !== 'GET' && !key) throw new TypeError('Generate an intent key before submitting this action.');
    if (method === 'PATCH' && !etag) throw new TypeError('Open the source to obtain its current ETag.');
    const headers = {Accept: 'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (key) headers['Idempotency-Key'] = key;
    if (etag) headers['If-Match'] = etag;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const started = session;
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(base + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal
      });
      checkSession(started);
      const isJson = (response.headers.get('Content-Type') || '').toLowerCase().includes('application/json');
      const data = isJson ? await response.json() : null;
      checkSession(started);
      const requestId = response.headers.get('X-Request-ID') || data?.request_id;
      if (response.status === 401) setToken('');
      if (!response.ok && data?.code) {
        throw new ApiError(response.status, data.code, data.message || 'The Sources request failed.', requestId);
      }
      if (!isJson) {
        throw new ApiError(response.ok ? 503 : response.status, 'api_unavailable',
          'The Sources API is unavailable at this address. Start the workbench using start-frontend.bat.', requestId);
      }
      if (!response.ok) {
        throw new ApiError(response.status, 'request_failed', 'The Sources request failed (HTTP ' + response.status + ').', requestId);
      }
      return {data, etag: response.headers.get('ETag'), location: response.headers.get('Location'), status: response.status};
    } catch (error) {
      if (error instanceof ApiError) throw error;
      checkSession(started);
      if (controller.signal.aborted) {
        throw new ApiError(0, 'request_timeout', 'The Sources request timed out. Retry this action to check its result.');
      }
      throw new ApiError(0, 'connection_error', 'Could not reach the Sources API. Check the local service and retry.');
    } finally {
      clearTimeout(timer);
      pending.delete(controller);
    }
  }

  const source = id => '/sources/' + segment(id);
  const asset = (id, assetId) => source(id) + '/assets/' + segment(assetId);
  const post = (path, body, key) => request(path, {method: 'POST', body, key});

  window.SourcesAPI = Object.freeze({
    setToken, clearToken: () => setToken(''), hasToken: () => Boolean(token),
    intent: () => crypto.randomUUID(),
    listSources: (filters = {}) => request('/sources' + query(filters, ['name', 'corpus', 'engine', 'enabled', 'limit', 'cursor'])),
    getSource: id => request(source(id)),
    createSource: (body, key) => post('/sources', body, key),
    updateSource: (id, body, etag, key) => request(source(id), {method: 'PATCH', body, etag, key}),
    testDraft: (body, key) => post('/source-connection-tests', body, key),
    testSaved: (id, key) => post(source(id) + '/connection-tests', undefined, key),
    getTest: id => request('/source-connection-tests/' + segment(id)),
    sync: (id, key) => post(source(id) + '/sync-runs', undefined, key),
    getRun: id => request('/source-sync-runs/' + segment(id)),
    listRuns: (id, filters = {}) => request(source(id) + '/sync-runs' + query(filters, ['limit', 'cursor'])),
    health: id => request(source(id) + '/health'),
    listAssets: (id, filters = {}) => request(source(id) + '/assets' + query(filters, ['schema', 'kind', 'name', 'limit', 'cursor'])),
    getAsset: (id, assetId, snapshotId) => request(asset(id, assetId) + query({snapshot_id: snapshotId}, ['snapshot_id'])),
    preview: (id, assetId, options = {}) => request(asset(id, assetId) + '/preview' + query(options, ['mode', 'limit', 'snapshot_id']))
  });
})();
