const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const filename = path.join(__dirname, '../ai-center-frontend/data-menu/sources-api.js');

function openClient(fetch) {
  const context = vm.createContext({window:{}, fetch, URLSearchParams, AbortController,
    setTimeout, clearTimeout, crypto:{randomUUID}});
  vm.runInContext(readFileSync(filename, 'utf8'), context, {filename});
  return context.window.SourcesAPI;
}

function reply(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json', ...headers}});
}

test('mutations reuse an intent across a lost response and preserve the quoted source ETag', async () => {
  const calls = [];
  const api = openClient(async (path, options) => {
    calls.push({path, options});
    if (calls.length === 1) throw new TypeError('Network error');
    return reply({id:'history'}, 200, {ETag:'"2"'});
  });
  api.setToken('private-session');
  const key = api.intent();
  const payload = {name:'Reign register'};
  await assert.rejects(api.updateSource('history', payload, '"1"', key), {code:'connection_error', retryable:true});
  const result = await api.updateSource('history', payload, '"1"', key);
  assert.equal(result.etag, '"2"');
  assert.equal(result.data.id, 'history');
  assert.equal(calls.length, 2);
  for (const {path, options} of calls) {
    assert.equal(path, '/api/v1/sources/history');
    assert.equal(options.headers['Idempotency-Key'], key);
    assert.equal(options.headers['If-Match'], '"1"');
    assert.equal(options.headers.Authorization, 'Bearer private-session');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, JSON.stringify(payload));
  }
});

test('expired credentials are cleared; late responses from a replaced credential cannot win', async () => {
  let release;
  const forbidden = () => reply({code:'unauthenticated', message:'Sign in', request_id:'trace-1'}, 401);
  const api = openClient(() => new Promise(resolve => {release = resolve;}));
  api.setToken('previous');
  for (const response of [reply({rows:[{country:'France'}]}), forbidden()]) {
    const late = api.preview('src', 'asset');
    api.setToken(api.intent());
    release(response);
    await assert.rejects(late, {code:'session_changed'});
    assert.equal(api.hasToken(), true);
  }
  const current = api.listSources();
  release(forbidden());
  await assert.rejects(current, {status:401, code:'unauthenticated', requestId:'trace-1'});
  assert.equal(api.hasToken(), false);
});

test('list and preview queries bind snapshots, cursors and supported fields; static HTML is an error', async () => {
  const urls = [];
  const api = openClient(async url => {
    urls.push(url);
    return urls.length <= 2 ? reply({}) : new Response('<html>Static demo</html>', {headers:{'Content-Type':'text/html'}});
  });
  await api.listAssets('src', {schema:'EU4 & Old', limit:25, cursor:'a=b', password:'fixture-reject'});
  await api.preview('src', 'asset', {snapshot_id:'snapshot', mode:'masked', limit:15});
  assert.equal(urls[0], '/api/v1/sources/src/assets?schema=EU4+%26+Old&limit=25&cursor=a%3Db');
  assert.equal(urls[1], '/api/v1/sources/src/assets/asset/preview?mode=masked&limit=15&snapshot_id=snapshot');
  await assert.rejects(api.listSources(), {code:'api_unavailable'});
});
