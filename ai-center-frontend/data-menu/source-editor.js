(() => {
  'use strict';
  const profile = window.SourceProfile;
  const corpora = Object.keys(profile.roots);
  const types = {
    database:{label:'Database',detail:'Tables and views',formats:Object.keys(profile.engines)},
    file:{label:'File',detail:'CSV, JSON or PDF',formats:['CSV','JSON','PDF']},
    folder:{label:'Managed folder',detail:'Directory inventory',formats:['Folder']},
    url:{label:'URL',detail:'API or web page',formats:['REST / JSON','HTML']}
  };
  function locationError(kind, format, value) {
    if (!value) return 'Enter a sample location.';
    if (kind === 'url') {
      try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
          return 'Enter an HTTP or HTTPS address without credentials, query parameters or fragments.';
        }
      } catch {
        return 'Enter a complete URL, such as https://archive.example.test/catalog.json.';
      }
    }
    if (kind === 'file' && !value.toLowerCase().endsWith('.' + format.toLowerCase())) {
      return 'Enter a file path ending in .' + format.toLowerCase() + '.';
    }
    return '';
  }

  function node(tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  }

  function drawTable(container, asset) {
    const table = document.createElement('table');
    table.className = 'ac-data';
    table.setAttribute('aria-label', 'Sample rows for ' + asset.object);
    const header = table.createTHead().insertRow();
    for (const field of asset.fields) {
      const cell = node('th', field);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    for (const row of asset.rows) {
      const tr = body.insertRow();
      for (const value of row) tr.insertCell().textContent = value;
    }
    container.replaceChildren(table);
  }


  function open({onSave, defaultCorpus, source} = {}) {
    if (typeof onSave !== 'function') throw new TypeError('SourceEditor needs an onSave callback.');
    if (document.querySelector('dialog.ac-source-dialog[open]')) return;
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'ac-source-dialog';
    dialog.setAttribute('aria-labelledby','se-title');
    dialog.setAttribute('aria-describedby','se-demo');
    dialog.innerHTML = `
      <form autocomplete="off">
        <header class="se-header"><h2 id="se-title"></h2>
          <button type="button" class="se-close ac-btn" aria-label="Close dialog">×</button></header>
        <ol class="se-steps" aria-label="Source setup"><li>Configure source</li><li>Preview inventory</li></ol>
        <div class="se-body"><p class="se-notice" id="se-demo">Local simulation. Connection tests and previews use built-in sample data. No server or file system is contacted.</p>
          <section class="se-config"><fieldset class="se-types"><legend>Source type</legend></fieldset>
            <div class="se-grid">
              <label class="se-field">Source name<input name="sourceName" maxlength="100" required></label>
              <label class="se-field">Corpus<select name="corpus"></select></label>
              <label class="se-field"><span class="se-format-label">Format</span><select name="format"></select></label>
              <label class="se-field se-location"><span class="se-location-label">Location</span><input name="location" spellcheck="false" maxlength="320"></label>
            </div>
            <fieldset class="se-db"><legend>Database connection</legend><div class="se-grid">
              <label class="se-field">Host<input name="dbHost" maxlength="253" spellcheck="false" required></label>
              <label class="se-field">Port<input name="dbPort" type="number" min="1" max="65535" required></label>
              <label class="se-field">Database name<input name="dbName" maxlength="128" required></label>
              <label class="se-field">Username<input name="dbUser" maxlength="128" placeholder="Optional · demo reader"></label>
              <label class="se-field">Demo password (optional)<input name="ephemeral" type="password" autocomplete="new-password" placeholder="Discarded after the simulated test"></label>
              <label class="se-field">SQLite file<input name="sqliteFile" spellcheck="false" required></label>
            </div></fieldset>
            <fieldset class="se-folder"><legend>Managed directory settings</legend>
              <label class="se-legacy"><input type="checkbox" name="keepLegacy"> Keep existing directory inventory</label>
              <div class="se-grid"><label class="se-field">Managed root path<input name="root" list="se-roots" required spellcheck="false"><datalist id="se-roots"></datalist></label>
              <label class="se-field">Subdirectory (optional)<input name="subdirectory" placeholder="e.g. history/countries" spellcheck="false"></label>
              <label class="se-field">File parser<select name="parser"><option value="content">Parse CSV/JSON rows and document text</option><option value="manifest">File metadata only</option></select></label></div>
              <fieldset class="se-ext"><legend>Allowed file extensions</legend></fieldset>
              <label><input type="checkbox" name="recursive"> Include subdirectories</label>
              <p class="se-folder-note ac-muted"></p>
            </fieldset>
          </section>
          <section class="se-discovery" hidden><h3 class="se-result-title" tabindex="-1">Source inventory</h3>
            <p class="se-summary"></p><fieldset class="se-assets"><legend></legend></fieldset>
            <section class="se-preview"><label class="se-field">Preview asset<select name="preview"></select></label><div class="ac-sheet se-table"></div></section>
          </section><p class="se-error" role="alert" hidden></p>
        </div><footer class="se-footer"><button class="ac-btn se-back" type="button">Cancel</button>
          <button type="submit" class="ac-btn ac-primary se-next"></button></footer>
      </form>`;
    const el = sel => dialog.querySelector(sel);
    const form = el('form'), f = form.elements, next = el('.se-next'), back = el('.se-back'), error = el('.se-error');
    let kind = source?.kind || 'database', step = 1, assets = [], draft, previousLocation = '';
    const legacyFolder = source?.kind === 'folder' && !source.folderPolicy;
    const previousAssets = source?.assets || (source ? [source] : []);
    const option = text => new Option(text,text);
    function toggle(control, visible) {
      control.disabled = !visible;
      control.closest('label').hidden = !visible;
    }
    function updateLocation() {
      const space = f.corpus.value.toLowerCase().replace(/ /g,'-');
      const loc = kind === 'url' ? 'https://archive.example.test/'+space+(f.format.value === 'HTML' ? '/guide' : '/catalog.json') :
        'samples/'+space+'/countries.'+f.format.value.toLowerCase();
      if (!f.location.value || f.location.value === previousLocation) f.location.value = loc;
      previousLocation = loc;
    }
    function refreshFields(resetDatabase = false) {
      const db = kind === 'database', folder = kind === 'folder', sqlite = db && f.format.value === 'SQLite';
      const retained = folder && legacyFolder && f.keepLegacy.checked;
      el('.se-db').hidden = !db; el('.se-folder').hidden = !folder;
      el('.se-format-label').textContent = db ? 'Database engine' : 'Format';
      el('.se-location-label').textContent = kind === 'url' ? 'URL' : 'File path';
      toggle(f.location,!db && !folder);
      f.location.required = !f.location.disabled;
      for (const ctrl of [f.dbHost,f.dbPort,f.dbName,f.dbUser,f.ephemeral]) toggle(ctrl,db && !sqlite);
      toggle(f.sqliteFile,sqlite);
      el('.se-legacy').hidden = !legacyFolder;
      f.root.disabled = !folder || retained; f.subdirectory.disabled = !folder || retained; f.parser.disabled = !folder || retained;
      f.recursive.disabled = !folder || retained;
      for (const input of el('.se-ext').querySelectorAll('input')) input.disabled = !folder || retained;
      el('.se-folder-note').textContent = retained ? 'Existing source and asset paths are retained. Clear this option to configure managed discovery.' :
        'Enter the connector’s root path. Preview uses a fixture with archive, missions and history/countries subdirectories.';
      if (db && resetDatabase) {
        const settings = profile.databaseSettings(source?.format === f.format.value ? source : {}, f.format.value);
        f.dbHost.value = settings.host || ''; f.dbPort.value = settings.port || '';
        f.dbName.value = settings.database || ''; f.dbUser.value = settings.username || '';
        f.sqliteFile.value = settings.file || ''; f.ephemeral.value = '';
      }
      if (!db && !folder) updateLocation();
      next.textContent = db ? 'Test connection & preview' : 'Discover sample assets';
    }
    function changeKind() {
      f.format.replaceChildren(...types[kind].formats.map(option));
      if (source?.kind === kind) f.format.value = source.format;
      if (!f.format.value) f.format.selectedIndex = 0;
      f.ephemeral.value = '';
      refreshFields(true);
    }
    function setStep(value) {
      step = value;
      el('.se-config').hidden = step !== 1; el('.se-discovery').hidden = step !== 2;
      el('.se-config').inert = step !== 1; el('.se-discovery').inert = step !== 2;
      [...dialog.querySelectorAll('.se-steps li')].forEach((li,i) => {
        if (i+1 === step) li.setAttribute('aria-current','step'); else li.removeAttribute('aria-current');
      });
      error.hidden = true; next.disabled = false;
      back.textContent = step === 1 ? 'Cancel' : 'Back';
      if (step === 1) {refreshFields(); f.sourceName.focus();}
      else {next.textContent = source ? 'Save connection' : 'Save source'; el('.se-result-title').focus();}
    }
    const fullCatalog = () => kind === 'database' || kind === 'folder';
    function selection() {
      return fullCatalog() ? assets : [...el('.se-assets').querySelectorAll(':checked')].map(c => assets[Number(c.value)]);
    }
    function previewSelection() {
      const list = selection(), prev = f.preview.value;
      f.preview.replaceChildren(...list.map(a => option(a.object)));
      if (list.some(a => a.object === prev)) f.preview.value = prev;
      const asset = list.find(a => a.object === f.preview.value);
      el('.se-preview').hidden = !asset; next.disabled = !asset && kind !== 'folder';
      if (asset) drawTable(el('.se-table'),asset);
    }
    function discover() {
      const corpus = f.corpus.value, format = f.format.value;
      draft = {name:f.sourceName.value.trim(),kind,format,corpus,credential:'Local sample',
        access:kind === 'url' || kind === 'database' ? 'Read only' : 'Snapshot'};
      if (!draft.name) throw new Error('Enter a source name.');
      if (kind === 'database') {
        draft.connection = profile.connection({engine:format,host:f.dbHost.value,port:f.dbPort.value,
          database:f.dbName.value,username:f.dbUser.value,file:f.sqliteFile.value});
        draft.loc = profile.address(draft.connection);
      } else if (kind === 'folder') {
        if (legacyFolder && f.keepLegacy.checked) draft.loc = source.loc;
        else {
          draft.folderPolicy = profile.policy({root:f.root.value,subdirectory:f.subdirectory.value,parser:f.parser.value,recursive:f.recursive.checked,
            extensions:[...el('.se-ext').querySelectorAll(':checked')].map(c => c.value)});
          draft.loc = draft.folderPolicy.root;
        }
      } else {
        draft.loc = f.location.value.trim();
        const issue = locationError(kind,format,draft.loc);
        if (issue) throw new Error(issue);
      }
      const sameAsset = source && kind === source.kind && format === source.format && corpus === source.corpus;
      if (kind === 'folder' && !draft.folderPolicy) assets = previousAssets;
      else if (sameAsset && ['url','file'].includes(kind) && draft.loc === source.loc) assets = previousAssets;
      else {
        assets = profile.inventory(draft);
        if (sameAsset && kind === 'database') {
          const prior = profile.databaseSettings(source);
          if (format === 'SQLite' ? prior.file === draft.connection.file : prior.database === draft.connection.database) {
            assets = [...previousAssets,...assets.filter(a => !previousAssets.some(p => p.object === a.object))];
          }
        }
      }
      const list = el('.se-assets');
      list.replaceChildren(node('legend',fullCatalog() ? 'Discovered inventory' : 'Select assets to include'));
      assets.forEach((asset,i) => {
        const row = document.createElement(fullCatalog() ? 'div' : 'label');
        row.className = 'se-asset';
        if (!fullCatalog()) {
          const check = document.createElement('input'); check.type='checkbox'; check.value=String(i);
          check.checked = source ? previousAssets.some(a => a.object === asset.object) || i === 0 : i === 0;
          row.append(check);
        }
        row.append(node('span',asset.object),node('small',' · '+asset.fields.length+' fields')); list.append(row);
      });
      el('.se-summary').textContent = !assets.length ? 'No sample files match this policy. You can save the directory or adjust its settings.' :
        (kind === 'database' ? 'Simulated connection passed. ' : '') + assets.length+' sample asset'+(assets.length === 1 ? '' : 's')+
        (fullCatalog() ? '. Saving registers this catalog. Dataset import is a separate action.' : '.');
      setStep(2); previewSelection();
    }
    el('#se-title').textContent = source ? 'Edit connection' : 'Add data source';
    f.corpus.replaceChildren(...corpora.map(option));
    f.corpus.value = source?.corpus || (corpora.includes(defaultCorpus) ? defaultCorpus : 'Real History');
    f.sourceName.value = source?.name || '';
    f.location.value = source?.loc || '';
    for (const [key,type] of Object.entries(types)) {
      const label = document.createElement('label'); label.className='se-type';
      const radio = document.createElement('input'); radio.type='radio'; radio.name='sourceType'; radio.value=key;
      radio.checked=key === kind; radio.disabled=!!source; radio.setAttribute('aria-label',type.label);
      const caption = node('span',''); caption.append(node('strong',type.label),node('small',type.detail)); label.append(radio,caption);
      el('.se-types').append(label);
    }
    el('.se-types').hidden = !!source;
    const pol = profile.folderSettings(source || {corpus:f.corpus.value});
    el('#se-roots').replaceChildren(...Object.values(profile.roots).map(option));
    f.keepLegacy.checked = legacyFolder;
    f.root.value = legacyFolder ? source.loc : pol.root;
    f.subdirectory.value = pol.subdirectory || '';
    f.parser.value = pol.parser; f.recursive.checked = pol.recursive;
    for (const ext of profile.extensions) {
      const label = node('label',''), input = document.createElement('input');
      input.type='checkbox'; input.value=ext; input.checked=pol.extensions.includes(ext);
      label.append(input,document.createTextNode(' .'+ext+' ')); el('.se-ext').append(label);
    }
    el('.se-types').addEventListener('change',e => {kind=e.target.value; f.location.value=''; changeKind();});
    f.format.addEventListener('change',() => refreshFields(true));
    f.corpus.addEventListener('change',() => {
      if (!source && kind === 'folder' && Object.values(profile.roots).includes(f.root.value)) f.root.value = profile.roots[f.corpus.value];
      refreshFields();
    });
    f.keepLegacy.addEventListener('change',() => refreshFields());
    el('.se-assets').addEventListener('change',previewSelection); f.preview.addEventListener('change',previewSelection);
    back.onclick = () => step === 2 ? setStep(1) : dialog.close();
    el('.se-close').onclick = () => dialog.close();
    dialog.addEventListener('close',() => {
      f.ephemeral.value = ''; dialog.remove();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    },{once:true});
    form.addEventListener('submit',e => {
      e.preventDefault();
      try {
        if (step === 1) {f.ephemeral.value=''; discover(); return;}
        const selected = selection(), primary = selected[0] || {object:'',fields:[],rows:[]};
        if (!selected.length && kind !== 'folder') throw new Error('Select an asset.');
        onSave(profile.publicRecord({...draft,assets:selected,object:primary.object,fields:primary.fields,
          rows:primary.rows,...(primary.dataType ? {dataType:primary.dataType} : {})}));
        dialog.close();
      } catch (e) { error.textContent = e.message; error.hidden = false; }
    });
    changeKind();
    (document.getElementById('ac-workbench') || document.body).append(dialog);
    dialog.showModal(); setStep(1);
  }
  window.SourceEditor = {open};
})();
