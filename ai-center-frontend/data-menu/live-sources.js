(() => {
  'use strict';

  const api = window.SourcesAPI;
  const corpora = ['EU4', 'Anbennar', 'Real History'];
  const waiting = new Set(['queued', 'running']);
  const el = (tag, content, className) => {
    const item = document.createElement(tag);
    if (content != null) item.textContent = String(content);
    if (className) item.className = className;
    return item;
  };
  const group = (className, ...children) => {
    const container = el('div', null, className);
    container.append(...children);
    return container;
  };
  const button = (label, onClick, cls = 'ac-btn') => {
    const item = el('button', label, cls);
    item.type = 'button';
    item.addEventListener('click', onClick);
    return item;
  };
  const input = (name, value = '', type = 'text') => {
    const item = el('input');
    item.name = name;
    item.type = type;
    item.value = value;
    return item;
  };
  const select = (name, choices, selected) => {
    const item = el('select');
    item.name = name;
    for (const choice of choices) {
      const [value, label] = Array.isArray(choice) ? choice : [choice, choice];
      item.add(new Option(label, value));
    }
    if (selected != null) item.value = selected;
    return item;
  };
  let fieldSequence = 0;
  const field = (label, control) => {
    const wrapper = el('label', null, 'ac-field');
    const caption = el('span',label);
    caption.id = 'ls-field-' + (++fieldSequence);
    control.setAttribute('aria-labelledby',caption.id);
    wrapper.append(caption, control);
    return wrapper;
  };
  const status = () => {
    const out = el('div', null, 'ls-status');
    out.setAttribute('role','status');
    return out;
  };
  const table = (labels, rows, caption) => {
    const grid = el('table', null, 'ac-data');
    grid.setAttribute('aria-label', caption);
    const heading = grid.createTHead().insertRow();
    for (const label of labels) {
      const cell = el('th', label);
      cell.scope = 'col';
      heading.append(cell);
    }
    const body = grid.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const value of row) {
        const td = tr.insertCell();
        if (value instanceof Node) td.append(value);
        else td.textContent = value == null ? '—' : String(value);
      }
    }
    return group('ls-table', grid);
  };

  let active;
  function leave() {
    if (active) {
      clearTimeout(active.timer);
      active.host.replaceChildren();
      active = undefined;
    }
  }
  const current = ctx => active === ctx;
  const time = value => value ? new Date(value).toLocaleString() : '—';
  const diagnostic = code => (code || '').replaceAll('_',' ');
  const messages = {
    credential_required: 'Save a database password before testing or syncing this source.',
    catalog_not_synced: 'Sync this source to publish its first catalog.',
    catalog_stale: 'The connection has changed. Sync the current configuration to publish its catalog.',
    catalog_access_blocked: 'Catalog access is blocked. Verify the account and run a successful sync.',
    catalog_changed: 'A new catalog was published. Reload the catalog to continue.',
    preview_columns_denied: 'No columns on this table are approved for original values.',
    preview_not_supported: 'Row previews are unavailable for this object. Its fields are available in the catalog.',
    source_disabled: 'This source is disabled. Enable it in connection settings to continue.'
  };
  function failure(ctx, where, error) {
    if (!current(ctx)) return;
    if (error.status === 401) {
      showLogin(ctx, ctx.signingIn ? 'Token rejected or expired. Enter a valid token.' : 'Your session expired. Sign in again.');
      return;
    }
    let message = messages[error.code] || error.message || 'Request failed.';
    if (error.status === 403 && !messages[error.code]) message = 'Your token does not grant this operation.';
    if (error.status === 412) message = 'Another edit changed this source. Reload its current settings before saving.';
    if (error.status === 0) message = 'The Sources API is unreachable. Check the local service and retry.';
    where.replaceChildren(el('span', message));
    if (error.status === 412 || error.code === 'catalog_changed') {
      where.append(button('Reload', () => refresh(ctx), 'ac-link'));
    }
    where.classList.add('ls-error');
  }
  function progress(where, text) {
    where.classList.remove('ls-error');
    where.replaceChildren(el('span',text));
  }
  const refresh = ctx => render(ctx.host, ctx.view, ctx.params, ctx.navigation);
  const assetsRoute = ctx => ({source: ctx.params.source});

  function showLogin(ctx, text) {
    if (!current(ctx)) return;
    // Invalidate pending requests and discard source data when the session changes.
    const next = {...ctx};
    active = next;
    clearTimeout(ctx.timer);
    const form = el('form', null, 'ls-signin');
    const token = input('token', '', 'password');
    token.required = true;
    token.autocomplete = 'off';
    const submit = el('button', 'Connect', 'ac-btn ac-primary');
    submit.type = 'submit';
    const feedback = status();
    feedback.textContent = text;
    form.append(el('h2', 'Connect to Sources'), el('p', 'Use your workspace access token. For a local installation, copy it from .eu4-sources/admin.token in your user folder.', 'ac-muted'),
      field('Access token', token), group('ac-actions',submit), feedback);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const value = token.value.trim();
      if (!value) return;
      api.setToken(value);
      token.value = '';
      await render(next.host, next.view, next.params, next.navigation, true);
    });
    next.host.replaceChildren(form);
  }
  function logout(ctx) {
    api.clearToken();
    showLogin(ctx, '');
  }
  function bar(...contents) { return group('ls-bar', ...contents); }
  function back(label, handler) {
    const b = button('←', handler, 'ac-btn ls-back');
    b.title = label;
    b.setAttribute('aria-label',label);
    return b;
  }
  function appendList(ctx) {
    const {page, navigation, params} = ctx;
    const form = el('form', null, 'ls-filters');
    const name = input('name',params.name || '', 'search');
    name.placeholder = 'Source name';
    const corpus = select('corpus',[['','All corpora'], ...corpora], params.corpus || '');
    const filter = el('button','Search','ac-btn');
    filter.type = 'submit';
    const submitted = () => {
      const filters = {};
      if (name.value.trim()) filters.name = name.value.trim();
      if (corpus.value) filters.corpus = corpus.value;
      navigation.go('catalog', filters);
    };
    form.append(field('Search sources',name), field('Corpus',corpus), filter);
    form.onsubmit = event => {event.preventDefault(); submitted();};
    corpus.onchange = submitted;
    const results = group('ls-results'), feedback = status();
    page.append(form, bar(button('Add source', () => navigation.go('catalog',{create:'1'}),'ac-btn ac-primary'),
      button('Sign out', () => logout(ctx),'ac-link')), feedback, results);
    let serial = 0, nextCursor = null, items = [];
    async function load(cursor) {
      const version = ++serial;
      progress(feedback, 'Loading sources…');
      const filters = {limit:25};
      if (cursor) filters.cursor = cursor;
      if (params.name) filters.name = params.name;
      if (params.corpus) filters.corpus = params.corpus;
      try {
        const {data} = await api.listSources(filters);
        if (!current(ctx) || version !== serial) return;
        items = cursor ? [...items, ...data.items] : data.items;
        nextCursor = data.next_cursor;
        feedback.replaceChildren();
        if (!items.length) {
          results.replaceChildren(group('ls-empty', el('h2', params.name || params.corpus ? 'No matching sources' : 'No sources connected'),
            el('p', params.name || params.corpus ? 'Change the search or corpus to see other sources.' : 'Add a PostgreSQL connection to start building your catalog.', 'ac-muted')));
          return;
        }
        const rows = items.map(s => [
          button(s.name, () => navigation.go('connection',{source:s.id}),'ac-rowname'),
          s.corpus, 'PostgreSQL', s.connection.database, s.enabled ? 'Enabled' : 'Disabled'
        ]);
        results.replaceChildren(table(['Source','Corpus','Engine','Database','Status'],rows,'Sources'));
        if (nextCursor) results.append(button('Load more sources', () => load(nextCursor)));
      } catch (error) {
        if (error.status === 401 && current(ctx)) showLogin(ctx, ctx.signingIn ? 'Token rejected or expired. Enter a valid token.' : '');
        else if (current(ctx)) {
          failure(ctx,feedback,error);
          feedback.append(button('Retry', () => load(cursor),'ac-link'));
        }
      }
    }
    return load(null);
  }

  function editor(ctx, source, etag) {
    const {navigation, page} = ctx, existing = !!source;
    const conn = source?.connection || {};
    const close = () => existing ? navigation.go('connection',{source:source.id}) : navigation.go('catalog');
    const form = el('form',null,'ls-form');
    const feedback = status(), controls = el('fieldset');
    const name = input('name', source?.name || ''), corpus = select('corpus',corpora,source?.corpus || navigation.defaultCorpus);
    const host = input('host',conn.host || ''), port = input('port',conn.port || 5432,'number');
    const database = input('database',conn.database || ''), username = input('username',conn.username || '');
    const schemas = input('schemas',(conn.schemas || ['public']).join(', '));
    const tls = select('tls_profile',[['workspace-default','Verify certificate & hostname'],['local-development','Local development (loopback)']], conn.tls_profile);
    name.required = host.required = database.required = username.required = port.required = schemas.required = true;
    port.min = 1; port.max = 65535; host.placeholder = 'db.example.org';
    const password = input('password','','password');
    password.autocomplete = 'new-password';
    const keep = source?.credential_configured ? 'Keep saved password' : 'Do not save a password';
    const actions = [['keep', keep],['replace','Save this password']];
    if (source?.credential_configured) actions.push(['clear','Remove saved password']);
    const credential = select('credential',actions,'keep');
    const enabled = input('enabled','','checkbox');
    enabled.checked = source?.enabled ?? true;
    const targetChanged = () => existing && source.credential_configured && credential.value === 'keep'
      && (host.value.trim().toLowerCase() !== conn.host.toLowerCase() || Number(port.value) !== conn.port ||
        database.value.trim() !== conn.database || username.value.trim() !== conn.username || tls.value !== conn.tls_profile);
    const note = el('p',null,'ac-muted');
    function hint() {
      note.textContent = targetChanged() ? 'Changing the target, account or TLS profile removes the previous password.' :
        credential.value === 'clear' ? 'Saving removes the stored credential.' :
        'A draft test uses the password once and clears the field. Choose “Save this password” to use it for future syncs.';
    }
    hint();
    const connection = () => ({host:host.value.trim(), port:Number(port.value), database:database.value.trim(),
      username:username.value.trim(), schemas:schemas.value.split(',').map(v => v.trim()).filter(Boolean),tls_profile:tls.value});
    let keys = {};
    form.oninput = () => {keys = {}; hint();};
    const save = el('button', existing ? 'Save changes' : 'Create source', 'ac-btn ac-primary');
    save.type = 'submit';
    const probe = button('Test draft connection', () => send(true));
    async function send(testing) {
      if (controls.disabled) return;
      const values = connection();
      if (testing && [host,port,database,username,schemas].some(item => !item.reportValidity())) return;
      if (!values.schemas.length) {progress(feedback,'Enter at least one schema.'); return;}
      if ((testing || credential.value === 'replace') && !password.value) {
        progress(feedback,'Enter the database password for this operation.'); password.focus(); return;
      }
      const operation = testing ? 'test' : 'save';
      const key = keys[operation] ||= api.intent();
      controls.disabled = true;
      progress(feedback,testing ? 'Testing the connection…' : 'Saving…');
      try {
        if (testing) {
          const {data} = await api.testDraft({connection:values,password:password.value},key);
          if (!current(ctx)) return;
          password.value = '';
          delete keys.test;
          await displayTest(ctx,feedback,data);
        } else {
          const payload = {name:name.value.trim(),corpus:corpus.value,enabled:enabled.checked,connection:values};
          if (credential.value === 'replace') payload.credential = {action:'replace',password:password.value};
          if (credential.value === 'clear') payload.credential = {action:'clear'};
          const result = existing ? await api.updateSource(source.id,payload,etag,key) : await api.createSource(payload,key);
          if (!current(ctx)) return;
          password.value = '';
          navigation.go('connection',{source:result.data.id});
        }
      } catch (error) {
        if (!error.retryable) {delete keys[operation]; password.value = '';}
        failure(ctx,feedback,error);
      } finally {
        controls.disabled = false;
      }
    }
    const enabledLabel = el('label',null,'ls-check');
    enabledLabel.append(enabled,el('span','Source enabled'));
    controls.append(group('ls-grid',field('Source name',name),field('Corpus',corpus),field('Host',host),field('Port',port),
      field('Database',database),field('Schemas (comma separated)',schemas),field('Username',username),field('TLS profile',tls),
      field('Database password',password),field('Credential on save',credential)),note,enabledLabel,group('ac-actions',probe,save));
    form.append(controls,feedback);
    form.onsubmit = e => {e.preventDefault();send(false);};
    page.replaceChildren(bar(back(existing ? 'Back to connection' : 'Back to sources',close),
      el('h2', existing ? 'Edit PostgreSQL connection' : 'Add PostgreSQL source')), form);
  }
  async function displayTest(ctx, where, initial) {
    let probe = initial;
    while (current(ctx) && probe.status === 'running') {
      progress(where, 'Connection test in progress…');
      await new Promise(resolve => setTimeout(resolve,1500));
      if (!current(ctx)) return;
      probe = (await api.getTest(probe.id)).data;
    }
    if (!current(ctx)) return;
    progress(where,probe.status === 'succeeded' ? 'Connection succeeded · ' + probe.elapsed_ms + ' ms' :
      'Connection test ' + probe.status + ' · ' + diagnostic(probe.error_code || probe.status));
  }

  const properties = entries => {
    const dl = el('dl',null,'ac-kv');
    entries.forEach(([key,value]) => dl.append(el('dt',key),el('dd',value)));
    return dl;
  };
  function details(ctx, source) {
    const {page, navigation} = ctx, conn = source.connection;
    const controls = group('ac-actions'), state = group('ls-health'), feedback = status();
    const history = group('ls-history');
    let generation = 0, runCursor, runRows = [];
    let keys = {};
    async function health() {
      clearTimeout(ctx.timer);
      const expected = ++generation;
      try {
        const {data} = await api.health(source.id);
        if (!current(ctx) || generation !== expected) return;
        const test = data.latest_test, run = data.latest_sync_run;
        state.replaceChildren(properties([['Catalog',diagnostic(data.catalog_status)],['Last published',time(data.last_published_at)],
          ['Latest connection test',test ? [test.status,diagnostic(test.error_code)].filter(Boolean).join(' · ') : 'Never tested'],
          ['Latest sync',run ? [run.status,diagnostic(run.error_code)].filter(Boolean).join(' · ') : 'Never synced']]));
        if (run && waiting.has(run.status)) ctx.timer = setTimeout(health,2000);
      } catch (error) {failure(ctx,state,error);}
    }
    async function execute(operation) {
      const key = keys[operation] ||= api.intent();
      test.disabled = sync.disabled = true;
      progress(feedback,operation === 'sync' ? 'Requesting sync…' : 'Testing the saved connection…');
      try {
        if (operation === 'sync') {
          const {data} = await api.sync(source.id,key);
          if (!current(ctx)) return;
          progress(feedback,'Sync ' + data.status + '.');
        } else {
          const {data} = await api.testSaved(source.id,key);
          if (!current(ctx)) return;
          await displayTest(ctx,feedback,data);
        }
        delete keys[operation];
        if (current(ctx)) await health();
      } catch (error) {
        if (!error.retryable) delete keys[operation];
        failure(ctx,feedback,error);
      } finally {test.disabled = sync.disabled = false;}
    }
    async function loadHistory(cursor) {
      historyButton.disabled = true;
      try {
        const {data} = await api.listRuns(source.id,cursor ? {cursor} : {});
        if (!current(ctx)) return;
        runRows = cursor ? [...runRows,...data.items] : data.items;
        runCursor = data.next_cursor;
        history.replaceChildren(el('h3','Sync history'));
        if (runRows.length) history.append(table(['Started or queued','Status','Attempt','Assets','Diagnostic'],
          runRows.map(r => [time(r.started_at || r.created_at),r.status,r.attempts,r.asset_count,diagnostic(r.error_code) || '—']),'Sync history'));
        else history.append(el('p','No sync runs yet.','ac-muted'));
        if (runCursor) {
          const more = button('Load more runs', () => {more.disabled = true; loadHistory(runCursor);});
          history.append(more);
        }
      } catch (error) {failure(ctx,history,error);}
      finally {historyButton.disabled = false;}
    }
    const test = button('Test saved connection', () => execute('test'));
    const sync = button('Sync now', () => execute('sync'),'ac-btn ac-primary');
    const historyButton = button('Show sync history', () => loadHistory(null));
    const edit = button('Edit connection', () => navigation.go('connection',{source:source.id,edit:'1'}));
    controls.append(edit,test,sync);
    page.append(group('ls-panel',bar(el('h2','Connection settings'),controls),
      properties([['Host',conn.host],['Port',conn.port],['Database',conn.database],['Schemas',conn.schemas.join(', ')],
        ['Username',conn.username],['TLS profile',conn.tls_profile],['Saved password',source.credential_configured ? 'Configured' : 'Not configured'],
        ['Corpus',source.corpus],['Source',source.enabled ? 'Enabled' : 'Disabled']]),feedback),
      group('ls-panel',bar(el('h2','Synchronization'),historyButton),state,history));
    return health();
  }

  function assets(ctx, source) {
    const {page, navigation, params} = ctx;
    const name = input('asset-name',params.name || '','search');
    name.placeholder = 'Table or view name';
    const form = el('form',null,'ls-filters');
    const submit = el('button','Search','ac-btn');
    submit.type = 'submit';
    form.append(field('Search catalog',name),submit);
    form.onsubmit = e => {
      e.preventDefault();
      const filters = {source:source.id};
      if (name.value.trim()) filters.name = name.value.trim();
      navigation.go('preview',filters);
    };
    const result = group('ls-results'), feedback = status();
    page.append(form,feedback,result);
    let items = [];
    async function load(cursor) {
      progress(feedback,'Loading catalog…');
      const filters = {limit:25};
      if (params.name) filters.name = params.name;
      if (cursor) filters.cursor = cursor;
      try {
        const {data} = await api.listAssets(source.id,filters);
        if (!current(ctx)) return;
        feedback.replaceChildren();
        items = cursor ? [...items,...data.items] : data.items;
        if (!items.length) {
          result.replaceChildren(el('p',params.name ? 'No matching assets.' : 'No visible tables or views in the published schemas.','ac-muted'));
          return;
        }
        result.replaceChildren(table(['Schema','Object','Kind'],items.map(a => [
          a.schema,button(a.name, () => navigation.go('preview',{source:source.id,asset:a.id,snapshot:data.snapshot_id}),'ac-rowname'),
          diagnostic(a.kind)]),'Published catalog'));
        if (data.next_cursor) {
          const more = button('Load more assets', () => {more.disabled = true; load(data.next_cursor);});
          result.append(more);
        }
      } catch (error) {
        failure(ctx,feedback,error);
        if (current(ctx) && error.retryable) feedback.append(button('Retry', () => load(cursor),'ac-link'));
      }
    }
    return load(null);
  }

  function columnPolicy(ctx, source, etag, asset, clearSample) {
    const section = el('details',null,'ls-policy');
    section.append(el('summary','Original-value permissions'));
    const choices = group('ls-choices'), feedback = status();
    const approved = new Set(source.preview_columns[asset.id] || []);
    for (const col of asset.columns) {
      const check = input('column',col.name,'checkbox');
      check.checked = approved.has(col.name);
      const label = el('label',null,'ls-check');
      label.append(check,el('span',col.name));
      choices.append(label);
    }
    let key;
    choices.onchange = () => {key = null;};
    const save = button('Save column permissions',async () => {
      key ||= api.intent();
      const next = {...source.preview_columns};
      const names = [...choices.querySelectorAll('input:checked')].map(c => c.value);
      if (names.length) next[asset.id] = names;
      else delete next[asset.id];
      save.disabled = true;
      progress(feedback,'Saving permissions…');
      try {
        const result = await api.updateSource(source.id,{preview_columns:next},etag,key);
        if (!current(ctx)) return;
        source = result.data;
        etag = result.etag;
        key = null;
        clearSample();
        progress(feedback,'Column permissions saved.');
      } catch (error) {
        if (!error.retryable) key = null;
        failure(ctx,feedback,error);
      } finally {save.disabled = false;}
    });
    section.append(el('p','Select columns that a user with original-value access may read. Other columns stay masked.','ac-muted'),
      choices,save,feedback);
    return section;
  }

  async function assetDetail(ctx, source, etag) {
    const {navigation,page,params} = ctx;
    const listBack = () => navigation.go('preview',assetsRoute(ctx));
    const backButton = button('← Catalog',listBack,'ac-link');
    const feedback = status();
    page.append(backButton,feedback);
    progress(feedback,'Loading fields…');
    let asset;
    try {
      asset = (await api.getAsset(source.id,params.asset,params.snapshot)).data;
      if (!current(ctx)) return;
    } catch (error) {
      if (error.code === 'catalog_changed' && current(ctx)) {
        feedback.replaceChildren(el('span','A new catalog was published. '),button('Open current catalog',listBack,'ac-link'));
      } else failure(ctx,feedback,error);
      return;
    }
    feedback.remove();
    const fields = table(['Field','Type','Nullable'],asset.columns.map(col => [col.name,col.type,col.nullable ? 'Yes' : 'No']),'Field definitions');
    page.append(group('ls-panel',bar(el('h2',asset.qualified_name),el('span',diagnostic(asset.kind),'ac-tag')),fields));
    if (asset.kind === 'view') return;
    const mode = select('mode',[['masked','Masked values'],['raw','Approved original values']],'masked');
    const limit = input('limit',15,'number');
    limit.min = 1; limit.max = 50; limit.required = true;
    const controls = el('form',null,'ls-filters');
    const sample = el('button','Load sample','ac-btn ac-primary');
    sample.type = 'submit';
    const out = group('ls-sample-result');
    const msg = status();
    controls.append(field('Preview level',mode),field('Row limit (1–50)',limit),sample);
    let request = 0;
    function clearSample() {
      request++;
      sample.disabled = false;
      out.replaceChildren();
      msg.replaceChildren();
    }
    controls.oninput = clearSample;
    controls.onsubmit = async event => {
      event.preventDefault();
      const seq = ++request;
      out.replaceChildren();
      sample.disabled = true;
      progress(msg,'Loading sample…');
      try {
        const {data} = await api.preview(source.id,asset.id,{mode:mode.value,limit:Number(limit.value),snapshot_id:asset.snapshot_id});
        if (!current(ctx) || seq !== request) return;
        progress(msg,data.rows.length + (data.rows.length === 1 ? ' row' : ' rows') + (data.truncated ? ' · sample truncated' : ''));
        out.append(table(data.columns,data.rows.map(row => data.columns.map(name => row[name])),'Source row preview'));
      } catch (error) {if (seq === request) failure(ctx,msg,error);}
      finally {if (seq === request) sample.disabled = false;}
    };
    page.append(group('ls-panel',el('h2','Row preview'),controls,msg,out));
    if (source.preview_columns) page.append(columnPolicy(ctx,source,etag,asset,clearSample));
  }

  async function render(host, view, params, navigation, signingIn = false) {
    leave();
    const page = group('ls-page');
    const ctx = {host,page,view,params,navigation,signingIn,timer:null};
    active = ctx;
    host.replaceChildren(page);
    if (!api.hasToken()) {showLogin(ctx,'');return;}
    if (view === 'catalog') {
      if (params.create === '1') {
        if (signingIn) {
          const verifying = status();
          page.append(verifying);
          progress(verifying,'Checking access token…');
          try {await api.listSources({limit:1});}
          catch (error) {
            // An authenticated source manager may lack directory listing permission.
            if (error.status !== 403) {failure(ctx,verifying,error);return;}
          }
        }
        if (current(ctx)) editor(ctx,null,null);
      } else await appendList(ctx);
      return;
    }
    const msg = status();
    page.append(bar(back('Back to sources', () => navigation.go('catalog')),button('Sign out', () => logout(ctx),'ac-link')),msg);
    progress(msg,'Loading connection…');
    try {
      const {data:source,etag} = await api.getSource(params.source);
      if (!current(ctx)) return;
      if (view === 'connection' && params.edit === '1') {editor(ctx,source,etag);return;}
      const title = el('h2',source.name);
      page.replaceChildren(bar(group('ls-heading',back('Back to sources', () => navigation.go('catalog')),title),
        button('Sign out', () => logout(ctx),'ac-link')));
      const tabs = group('dm-tabs');
      tabs.setAttribute('aria-label','Source views');
      for (const [tab,label] of [['connection','Connection'],['preview','Asset preview']]) {
        const control = button(label, () => navigation.go(tab,{source:source.id}), '');
        if (view === tab) control.setAttribute('aria-current','page');
        tabs.append(control);
      }
      page.append(tabs);
      if (view === 'connection') await details(ctx,source);
      else if (params.asset) await assetDetail(ctx,source,etag);
      else await assets(ctx,source);
    } catch (error) {
      if (!current(ctx)) return;
      if (!msg.isConnected) page.append(msg);
      failure(ctx,msg,error);
    }
  }

  window.LiveSources = {render,leave};
})();
