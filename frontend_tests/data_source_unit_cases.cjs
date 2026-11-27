const assert = require('node:assert/strict');

// Each unittest method starts a fresh process with its own session and fetch spy.
globalThis.window = {};
require('../ai-center-frontend/data-menu/sources-api.js');
const api = window.SourcesAPI;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

function recordFetch(respond = () => json({})) {
  const calls = [];
  globalThis.fetch = (url, options) => {
    calls.push({url, ...options, headers: new Headers(options.headers)});
    return respond();
  };
  return calls;
}

async function listSourcesFilters() {
  const calls = recordFetch();
  const name = 'History & maps';
  await api.listSources({name, enabled: false, cursor: '', unknown: 'ignored'});

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url, 'http://localhost');
  assert.equal(calls[0].method, 'GET');
  assert.equal(url.pathname, '/api/v1/sources');
  assert.deepEqual(Object.fromEntries(url.searchParams), {name, enabled: 'false'});
}

async function updateSourceRequest() {
  const calls = recordFetch();
  const change = {name: 'Updated source', enabled: false};
  const etag = '"version-1"';
  const key = 'update-intent';
  await api.updateSource('source/one', change, etag, key);

  assert.equal(calls.length, 1);
  const request = calls[0];
  assert.equal(request.url, '/api/v1/sources/source%2Fone');
  assert.equal(request.method, 'PATCH');
  assert.equal(request.headers.get('Content-Type'), 'application/json');
  assert.equal(request.headers.get('If-Match'), etag);
  assert.equal(request.headers.get('Idempotency-Key'), key);
  assert.deepEqual(JSON.parse(request.body), change);

  await assert.rejects(api.updateSource('source/one', change, undefined, key), TypeError);
  await assert.rejects(api.updateSource('source/one', change, etag, undefined), TypeError);
  assert.equal(calls.length, 1, 'Neither invalid update should reach fetch');
}

async function tokenChangeDiscardsPendingResponse() {
  let finishOldRequest;
  const oldResponse = new Promise(resolve => { finishOldRequest = resolve; });
  const oldCalls = recordFetch(() => oldResponse);
  api.setToken('first-session');
  const pending = api.listSources();

  api.setToken('second-session');
  // Simulate a late response from a transport that did not honor the abort.
  finishOldRequest(json({items: [{id: 'old-source'}]}));
  await assert.rejects(pending, {code: 'session_changed', status: 409});
  assert.equal(oldCalls.length, 1);
  assert.equal(oldCalls[0].headers.get('Authorization'), 'Bearer first-session');
  assert.equal(oldCalls[0].signal.aborted, true);

  const fresh = {items: [{id: 'new-source'}]};
  const newCalls = recordFetch(() => json(fresh));
  assert.deepEqual((await api.listSources()).data, fresh);
  assert.equal(newCalls.length, 1);
  assert.equal(newCalls[0].headers.get('Authorization'), 'Bearer second-session');
}

async function unauthorizedClearsToken() {
  api.setToken('expired-session');
  const rejected = recordFetch(() => json({code: 'unauthorized', message: 'Expired'}, 401));
  await assert.rejects(api.listSources(), {status: 401, code: 'unauthorized'});
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].headers.get('Authorization'), 'Bearer expired-session');
  assert.equal(api.hasToken(), false);

  const next = recordFetch();
  await api.listSources();
  assert.equal(next.length, 1);
  assert.equal(next[0].headers.has('Authorization'), false);
}

const cases = {
  listSourcesFilters,
  updateSourceRequest,
  tokenChangeDiscardsPendingResponse,
  unauthorizedClearsToken,
};
cases[process.argv[2]]().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
