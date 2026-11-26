(() => {
  'use strict';

  const corpora = {
    'EU4': [['FRA', 'France', 'Charles VII'], ['ENG', 'England', 'Henry VI']],
    'Anbennar': [['A01', 'Lorent', 'Kylian VI'], ['A03', 'Redglades', 'Elthariel']],
    'Real History': [['FR', 'Kingdom of France', 'Charles VII'], ['EN', 'Kingdom of England', 'Henry VI']]
  };
  const types = {
    database: {label: 'Database', detail: 'Tables and views', formats: ['PostgreSQL'], location: 'Database address'},
    file: {label: 'File', detail: 'CSV, JSON or PDF', formats: ['CSV', 'JSON', 'PDF'], location: 'File path'},
    folder: {label: 'Folder', detail: 'A group of files', formats: ['Folder'], location: 'Folder path'},
    url: {label: 'URL', detail: 'API or web page', formats: ['REST / JSON', 'HTML'], location: 'URL'}
  };

  function sampleLocation(kind, corpus, format) {
    const space = corpus.toLowerCase().replace(/ /g, '-');
    switch (kind) {
      case 'database': return 'archive.example.test:5432/' + space.replace(/-/g, '_');
      case 'folder': return 'samples/' + space + '/';
      case 'file': return 'samples/' + space + '/countries.' + format.toLowerCase();
      case 'url': return 'https://archive.example.test/' + space + (format === 'HTML' ? '/guide' : '/catalog.json');
    }
  }

  function sampleAssets(kind, corpus, format, location) {
    const examples = corpora[corpus];
    const idField = corpus === 'Real History' ? 'catalog_id' : 'country_tag';
    const countries = {fields: [idField, 'country'], rows: examples.map(([id, name]) => [id, name])};
    const rulers = {
      fields: [idField, 'ruler', 'as_of'],
      rows: examples.map(([id, , ruler]) => [id, ruler, '1444-11-11'])
    };
    const sections = {
      fields: [format === 'PDF' ? 'page' : 'section', 'heading', 'sample_text'],
      rows: examples.map(([, country, ruler], i) => [String(i + 1), country, ruler + ' · 11 November 1444'])
    };
    const resource = (object, dataset) => ({object, ...dataset});
    const file = location.split(/[\\/]/).pop();
    if (kind === 'database') return [resource('public.countries', countries), resource('public.ruler_snapshots', rulers)];
    if (kind === 'folder') return [resource('countries.csv', countries), resource('ruler_snapshots.json', rulers)];
    if (kind === 'url') {
      if (format === 'HTML') return [resource('Page sections', sections)];
      return [resource('$.countries', countries), resource('$.ruler_snapshots', rulers)];
    }
    if (format === 'PDF') return [resource(file + ' · pages', sections)];
    if (format === 'JSON') return [resource(file + ' · $.countries', countries), resource(file + ' · $.ruler_snapshots', rulers)];
    return [resource(file, countries)];
  }

  function locationError(kind, format, value) {
    if (!value) return 'Enter a sample location.';
    if (kind === 'database' && !/^[a-z0-9.-]+(?::\d{1,5})?\/[a-z0-9_-]+$/i.test(value)) {
      return 'Use host:port/database, such as archive.example.test:5432/atlas.';
    }
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

  function open({onSave, defaultCorpus} = {}) {
    if (typeof onSave !== 'function') throw new TypeError('SourceEditor needs an onSave callback.');
    if (document.querySelector('dialog.ac-source-dialog[open]')) return;
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'ac-source-dialog';
    dialog.setAttribute('aria-labelledby', 'se-title');
    dialog.setAttribute('aria-describedby', 'se-demo');
    dialog.innerHTML = `
      <form autocomplete="off">
        <header class="se-header">
          <h2 id="se-title">Add data source</h2>
          <button type="button" class="se-close ac-btn" aria-label="Close dialog">×</button>
        </header>
        <ol class="se-steps" aria-label="Source setup">
          <li aria-current="step">Configure source</li><li>Discover &amp; preview</li>
        </ol>
        <div class="se-body">
          <p class="se-notice" id="se-demo">Demo mode · Discovery and previews use built-in samples. Use sample locations only.</p>
          <section class="se-config">
            <fieldset class="se-types"><legend>Source type</legend></fieldset>
            <div class="se-grid">
              <label class="se-field">Source name<input name="sourceName" maxlength="90" required placeholder="e.g. Country archive"></label>
              <label class="se-field">Corpus<select name="corpus"></select></label>
              <label class="se-field">Format<select name="format"></select></label>
              <label class="se-field"><span class="se-loc-label">Location</span><input name="location" maxlength="320" required spellcheck="false"></label>
            </div>
          </section>
          <section class="se-discovery" hidden>
            <h3 class="se-result-title" tabindex="-1">Discovered assets</h3>
            <p class="se-summary"></p>
            <fieldset class="se-assets"><legend>Select assets to include</legend></fieldset>
            <section class="se-preview">
              <h3>Sample preview</h3>
              <label class="se-field">Preview asset<select name="preview"></select></label>
              <div class="ac-sheet se-table"></div>
            </section>
          </section>
          <p class="se-error" role="alert" hidden></p>
        </div>
        <footer class="se-footer">
          <button type="button" class="ac-btn se-back">Cancel</button>
          <button type="submit" class="ac-btn ac-primary se-next">Discover sample assets</button>
        </footer>
      </form>`;
    const el = selector => dialog.querySelector(selector);
    const form = el('form');
    const {sourceName, corpus, format, location, preview} = form.elements;
    const error = el('.se-error');
    const back = el('.se-back');
    const next = el('.se-next');
    const assetList = el('.se-assets');
    let kind = 'database';
    let step = 1;
    let assets = [];
    let signature = '';
    let defaultLocation = '';

    function refreshLocation() {
      const nextLocation = sampleLocation(kind, corpus.value, format.value);
      if (!location.value || location.value === defaultLocation) location.value = nextLocation;
      location.placeholder = nextLocation;
      defaultLocation = nextLocation;
      location.setCustomValidity('');
    }

    function refreshType() {
      const type = types[kind];
      format.replaceChildren(...type.formats.map(name => new Option(name, name)));
      el('.se-loc-label').textContent = type.location;
      refreshLocation();
    }

    function setStep(number) {
      step = number;
      el('.se-config').hidden = step !== 1;
      el('.se-discovery').hidden = step !== 2;
      [...dialog.querySelectorAll('.se-steps li')].forEach((item, i) => {
        if (i + 1 === step) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
      error.hidden = true;
      next.textContent = step === 1 ? 'Discover sample assets' : 'Save source';
      back.textContent = step === 1 ? 'Cancel' : 'Back';
      next.disabled = false;
      if (step === 1) sourceName.focus();
      else el('.se-result-title').focus();
    }

    function selectedAssets() {
      return Array.from(assetList.querySelectorAll('input:checked'), input => assets[Number(input.value)]);
    }

    function refreshPreview() {
      const selected = selectedAssets();
      const current = preview.value;
      preview.replaceChildren(...selected.map(asset => new Option(asset.object, asset.object)));
      if (selected.some(asset => asset.object === current)) preview.value = current;
      next.disabled = selected.length === 0;
      el('.se-preview').hidden = !selected.length;
      const asset = selected.find(item => item.object === preview.value);
      if (asset) drawTable(el('.se-table'), asset);
      else el('.se-table').replaceChildren();
    }

    function discover() {
      const current = JSON.stringify([kind, corpus.value, format.value, location.value.trim()]);
      if (current !== signature) {
        signature = current;
        assets = sampleAssets(kind, corpus.value, format.value, location.value.trim());
        assetList.querySelectorAll('label').forEach(label => label.remove());
        assets.forEach((asset, i) => {
          const label = document.createElement('label');
          label.className = 'se-asset';
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.setAttribute('aria-label', asset.object);
          check.value = String(i);
          check.checked = i === 0;
          label.append(check, node('span', asset.object), node('small', asset.fields.length + ' fields'));
          assetList.append(label);
        });
      }
      el('.se-summary').textContent = assets.length + ' sample ' + (assets.length === 1 ? 'asset' : 'assets') + ' · ' + corpus.value + ' · ' + format.value;
      setStep(2);
      refreshPreview();
    }

    corpus.replaceChildren(...Object.keys(corpora).map(name => new Option(name, name)));
    corpus.value = Object.hasOwn(corpora, defaultCorpus) ? defaultCorpus : 'Real History';
    for (const [key, type] of Object.entries(types)) {
      const label = document.createElement('label');
      label.className = 'se-type';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'sourceType';
      radio.value = key;
      radio.checked = key === kind;
      radio.setAttribute('aria-label', type.label);
      radio.setAttribute('aria-describedby', 'se-help-' + key);
      const caption = document.createElement('span');
      const help = node('small', type.detail);
      help.id = 'se-help-' + key;
      caption.append(node('strong', type.label), help);
      label.append(radio, caption);
      el('.se-types').append(label);
    }
    el('.se-types').addEventListener('change', event => {
      kind = event.target.value;
      location.value = '';
      refreshType();
    });
    corpus.addEventListener('change', refreshLocation);
    format.addEventListener('change', refreshLocation);
    location.addEventListener('input', () => location.setCustomValidity(''));
    sourceName.addEventListener('input', () => sourceName.setCustomValidity(''));
    assetList.addEventListener('change', refreshPreview);
    preview.addEventListener('change', refreshPreview);
    back.addEventListener('click', () => step === 1 ? dialog.close() : setStep(1));
    el('.se-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    }, {once: true});
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (step === 1) {
        sourceName.setCustomValidity(sourceName.value.trim() ? '' : 'Enter a source name.');
        location.setCustomValidity(locationError(kind, format.value, location.value.trim()));
        if (form.reportValidity()) discover();
        return;
      }
      const selected = selectedAssets();
      if (!selected.length) return;
      const primary = selected[0];
      const record = {
        name: sourceName.value.trim(), kind, format: format.value,
        access: kind === 'url' || kind === 'database' ? 'Read only' : 'Snapshot',
        loc: location.value.trim(), credential: 'Demo · no credentials',
        object: primary.object, fields: primary.fields, rows: primary.rows,
        corpus: corpus.value, assets: selected
      };
      try {
        onSave(record);
        dialog.close();
      } catch {
        error.textContent = 'The source could not be saved. Try again.';
        error.hidden = false;
      }
    });
    refreshType();
    (document.getElementById('ac-workbench') || document.body).append(dialog);
    dialog.showModal();
    sourceName.focus();
  }

  window.SourceEditor = {open};
})();
