(() => {
  'use strict';

  function render(host,ctx,ui) {
    const {store,databases,layers,locations,folders,selectedFolder,preferredLayer,sourceId,back,openDataset} = ctx;
    const {node,button,select,field,table,group} = ui;
    const heading = group('dm-head',group('dm-toolbar',back,node('h1','Import database tables')));
    const section = node('section',null,'dm-panel dm-import');
    host.replaceChildren(heading,section);
    if (!databases.length) {
      section.append(node('h2','Database connection'),node('p','Register a database connection in Sources to import its tables.','dm-muted'));
      return;
    }
    const form = node('form',null,'dm-import-form');
    const source = select(databases.map(s => [s.id,s.name]),databases.some(s => s.id === sourceId) ? sourceId : databases[0].id);
    const layer = select(layers.map(l => [l.code,l.code + ' · ' + l.name]),layers.some(l => l.code === preferredLayer) ? preferredLayer : layers[0]?.code);
    const storage = select(locations.map(s => [s.id,s.name]),locations.find(s => s.id === 'warehouse')?.id || locations[0]?.id);
    const folder = select(window.DatasetCatalog.folderChoices(folders),selectedFolder === 'unfiled' ? '' : selectedFolder || '');
    const search = node('input');
    search.type = 'search';
    search.placeholder = 'Table or field name';
    const list = node('div',null,'dm-import-list');
    const destination = group('dm-grid',field('Warehouse layer',layer),field('Storage location',storage),field('Destination folder',folder));
    const feedback = node('p',null,'dm-notice');
    feedback.setAttribute('role','alert');
    feedback.hidden = true;
    const results = node('section',null,'dm-panel dm-import-result');
    results.hidden = true;
    const count = node('span',null,'dm-muted');
    count.setAttribute('role','status');
    const submit = node('button','Import tables','dm-btn dm-primary');
    submit.type = 'submit';
    form.append(group('dm-import-filters',field('Database connection',source),field('Search tables',search)),
      list,node('h2','Destination'),destination,feedback,group('dm-import-submit',count,submit));
    section.append(form);
    host.append(results);
    const selected = new Set();
    let inventory = [], pending = false;
    function loadInventory() {
      inventory = store.databaseImportInventory(source.value);
      const eligible = new Set(inventory.filter(a => !a.datasetId).map(a => a.object));
      for (const object of selected) if (!eligible.has(object)) selected.delete(object);
    }
    function announce(text) {
      feedback.textContent = text;
      feedback.hidden = !text;
    }
    function draw() {
      const term = search.value.trim().toLocaleLowerCase();
      const shown = inventory.filter(a => [a.object,...a.fields].some(s => s.toLocaleLowerCase().includes(term)));
      const eligible = shown.filter(a => !a.datasetId);
      const all = node('input');
      all.type = 'checkbox';
      all.setAttribute('aria-label',term ? 'Select all matching available tables' : 'Select all available tables');
      all.disabled = !eligible.length || pending;
      const boxes = new Map();
      function syncSelection() {
        all.checked = Boolean(eligible.length) && eligible.every(a => selected.has(a.object));
        all.indeterminate = !all.checked && eligible.some(a => selected.has(a.object));
        boxes.forEach((box,object) => {box.checked = selected.has(object);});
        count.textContent = selected.size + ' selected · ' + shown.length + ' of ' + inventory.length + ' tables shown';
        submit.textContent = pending ? 'Importing…' : selected.size ? 'Import ' + selected.size + (selected.size === 1 ? ' table' : ' tables') : 'Import tables';
        submit.disabled = pending || !selected.size || !layer.value || !storage.value;
      }
      all.addEventListener('change',() => {
        for (const a of eligible) if (all.checked) selected.add(a.object); else selected.delete(a.object);
        syncSelection();
      });
      const rows = shown.map(asset => {
        const box = node('input');
        box.type = 'checkbox';
        box.setAttribute('aria-label','Select ' + asset.object);
        box.disabled = Boolean(asset.datasetId) || pending;
        boxes.set(asset.object,box);
        box.addEventListener('change',() => {
          if (box.checked) selected.add(asset.object); else selected.delete(asset.object);
          syncSelection();
        });
        const name = group('dm-import-object',node('strong',asset.object),
          node('small',asset.fields.slice(0,5).join(', ') + (asset.fields.length > 5 ? '…' : ''),'dm-muted'));
        const badge = node('span',asset.archived ? 'Archived dataset' : asset.datasetId ? 'Imported' : 'Available','dm-badge');
        badge.dataset.status = asset.datasetId ? 'manual' : 'ready';
        const state = asset.datasetId ? group('dm-import-object',badge,node('small',asset.datasetName,'dm-muted')) : badge;
        return [box,name,asset.rowCount,state];
      });
      if (rows.length) {
        const wrapper = table(['','Source table','Sample rows','Import status'],rows);
        wrapper.querySelector('table').setAttribute('aria-label','Database table inventory');
        wrapper.querySelector('th').append(all);
        list.replaceChildren(wrapper);
      } else {
        list.replaceChildren(node('p',term ? 'No tables match this search.' : 'No tables were found in this connection.','dm-muted'));
      }
      syncSelection();
    }
    function refreshInventory() {
      try {loadInventory();}
      catch (error) {inventory = [];selected.clear();announce(error.message);}
      draw();
    }
    source.addEventListener('change',() => {
      selected.clear();
      search.value = '';
      announce('');
      results.hidden = true;
      refreshInventory();
    });
    search.addEventListener('input',draw);
    form.addEventListener('submit',async event => {
      event.preventDefault();
      if (pending || !selected.size) return;
      pending = true;
      source.disabled = layer.disabled = storage.disabled = folder.disabled = true;
      announce('');
      results.hidden = true;
      draw();
      try {
        const imported = await store.importDatabaseTables({sourceId:source.value,assets:[...selected],layer:layer.value,
          storage:storage.value,folderId:folder.value || null});
        if (!host.isConnected) return;
        selected.clear();
        const caption = node('h2',imported.length === 1 ? '1 table imported' : imported.length + ' tables imported');
        caption.tabIndex = -1;
        const rows = imported.map(r => [button(r.name,() => openDataset(r.datasetId)),r.rowCount,r.jobId]);
        results.replaceChildren(caption,table(['Dataset','Imported rows','Ingestion job'],rows));
        results.hidden = false;
        caption.focus();
      } catch (error) {
        announce('No tables were imported. ' + error.message);
      } finally {
        source.disabled = layer.disabled = storage.disabled = folder.disabled = pending = false;
        refreshInventory();
      }
    });
    refreshInventory();
    if (sourceId && !databases.some(s => s.id === sourceId)) {
      announce('The requested database connection is unavailable. Choose a connection from the list.');
    }
  }
  window.DatasetImportView = {render};
})();
