const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');

// Opt-in: use a fresh, disposable workspace and a dedicated source account.
// The fixture contains url, tokenFile, optional fieldsTokenFile, host, port, database,
// schema, username, password, table, clearColumn, clearValue and maskedColumn.
test('a browser can connect a real source, sync its catalog and preview by grant', {
  skip: !process.env.SOURCES_BROWSER_FIXTURE,
  timeout: 90_000
}, async () => {
  const fixture = JSON.parse(readFileSync(process.env.SOURCES_BROWSER_FIXTURE, 'utf8'));
  const url = new URL(fixture.url);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.port && url.port !== '63074',
    'This check requires a dedicated temporary origin.');
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.SOURCES_BROWSER_CHANNEL || 'msedge'
  });
  const admin = readFileSync(fixture.tokenFile, 'utf8').trim();
  const fieldsOnly = fixture.fieldsTokenFile ? readFileSync(fixture.fieldsTokenFile, 'utf8').trim() : null;
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      if (sessionStorage.getItem('browser-test-started')) return;
      sessionStorage.setItem('browser-test-started', '1');
      localStorage.setItem('ai-center.workbench.v1', JSON.stringify({
        version:1, state:{}, sources:[{id:'old-local', name:'Retired browser-only fixture'}]
      }));
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.name + ': ' + error.message));
    const sources = page.locator('#ac-live-sources');
    const byLabel = name => sources.getByLabel(name, {exact:true});
    const click = name => sources.getByRole('button', {name, exact:true}).click();
    const signin = async token => {
      await byLabel('Access token').fill(token);
      await click('Connect');
    };
    const previews = sources.getByRole('table', {name:'Source row preview'});
    await page.goto(url.origin + '/#/data/catalog');
    await signin(admin);
    await sources.getByRole('heading', {name:'No sources connected'}).waitFor();
    assert.equal((await sources.innerText()).includes('Retired browser-only fixture'), false);
    assert.equal(await page.evaluate(() => 'sources' in JSON.parse(localStorage.getItem('ai-center.workbench.v1'))), false);

    await click('Add source');
    const displayName = 'Disposable browser check';
    await byLabel('Source name').fill(displayName);
    await byLabel('Host').fill(fixture.host);
    await byLabel('Port').fill(String(fixture.port));
    await byLabel('Database').fill(fixture.database);
    await byLabel('Schemas (comma separated)').fill(fixture.schema);
    await byLabel('Username').fill(fixture.username);
    await sources.locator('select[name="tls_profile"]').selectOption('local-development');
    await byLabel('Database password').fill(fixture.password);
    await click('Test draft connection');
    await sources.getByText(/Connection succeeded/).waitFor();
    assert.equal(await byLabel('Database password').inputValue(), '');
    assert.equal(await sources.locator('select[name="credential"]').inputValue(), 'keep');
    await sources.locator('select[name="credential"]').selectOption('replace');
    await byLabel('Database password').fill(fixture.password);
    await click('Create source');
    await sources.getByRole('heading', {name:displayName}).waitFor();
    await click('Test saved connection');
    await sources.getByText(/Connection succeeded/).waitFor();
    await click('Sync now');
    await sources.locator('.ls-health').getByText('available', {exact:true}).waitFor({timeout:20_000});
    await click('Show sync history');
    await sources.getByRole('table', {name:'Sync history'}).getByText('succeeded', {exact:true}).waitFor();
    await click('Asset preview');
    await click(fixture.table);
    const fields = sources.getByRole('table', {name:'Field definitions'});
    await fields.getByText(fixture.clearColumn, {exact:true}).waitFor();
    await click('Load sample');
    await previews.waitFor();
    assert.ok((await previews.locator('tbody td').allTextContents()).every(cell => cell === '[REDACTED]'));
    await sources.locator('select[name="mode"]').selectOption('raw');
    await click('Load sample');
    await sources.getByText('No columns on this table are approved for original values.').waitFor();
    await sources.getByText('Original-value permissions', {exact:true}).click();
    await sources.getByRole('checkbox', {name:fixture.clearColumn, exact:true}).check();
    await click('Save column permissions');
    await sources.getByText('Column permissions saved.').waitFor();
    await click('Load sample');
    await previews.getByText(String(fixture.clearValue), {exact:true}).first().waitFor();
    const headers = await previews.getByRole('columnheader').allTextContents();
    const maskedIndex = headers.indexOf(fixture.maskedColumn);
    assert.ok(maskedIndex >= 0);
    const rows = previews.locator('tbody tr');
    assert.ok(await rows.count() > 0);
    for (const row of await rows.all()) {
      assert.equal(await row.locator('td').nth(maskedIndex).textContent(), '[REDACTED]');
    }

    // Reload loses the bearer, not the published catalog. A lower grant cannot reuse the raw sample.
    await page.reload();
    await byLabel('Access token').waitFor();
    assert.equal(await previews.count(), 0);
    await signin(fieldsOnly || admin);
    await fields.waitFor();
    if (fieldsOnly) {
      await click('Load sample');
      await sources.getByText('Your token does not grant this operation.').waitFor();
      assert.equal(await previews.count(), 0);
      await click('Sign out');
      await signin(admin);
    }
    await click('Back to sources');
    await sources.getByRole('button', {name:displayName}).waitFor();
    await page.locator('[data-section="storages"]').click();
    await page.locator('[data-page="lifecycle"]:visible').waitFor();
    await page.locator('[data-section="datasets"]').click();
    await page.getByRole('table').first().waitFor();
    await page.locator('[data-section="catalog"]').click();
    await sources.getByRole('button', {name:displayName}).waitFor();
    await click('Sign out');
    await byLabel('Access token').waitFor();
    const stored = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    for (const value of [admin, fieldsOnly, fixture.password, displayName].filter(Boolean)) {
      assert.ok(!stored.includes(value), 'Sources records and secrets must not persist in browser storage.');
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    let message = String(error.stack || error);
    for (const value of [admin, fieldsOnly, fixture.password, fixture.clearValue].filter(Boolean)) {
      message = message.replaceAll(String(value), '[redacted]');
    }
    throw new Error(message);
  } finally {
    await browser.close();
  }
});
