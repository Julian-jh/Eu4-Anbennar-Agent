/* Manage the logical destinations referenced by workspace datasets. */
(() => {
  'use strict';
  const sessions = new WeakMap();

  function render(host,{store,go,params = {},esc}) {
    const data = store.snapshot(true);
    const locations = data.storageLocations;
    const types = store.storageTypes;
    const target = locations.find(item => item.id === params.storage);
    const state = sessions.get(store) || {query:'',type:'',notice:''};
    sessions.set(store,state);
    const connected = new Map();
    for (const ds of data.datasets) {
      if (!connected.has(ds.storage)) connected.set(ds.storage,[]);
      connected.get(ds.storage).push(ds);
    }
    const linked = target ? connected.get(target.id) || [] : [];
    const typeName = type => types.find(item => item.id === type)?.name || type;
    const options = selected => types.map(t => '<option value="' + esc(t.id) + '"' + (selected === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
    const view = document.createElement('section');
    view.className = 'dm-storages';
    host.replaceChildren(view);
    const note = document.createElement('p');
    note.className = 'dm-notice';
    note.setAttribute('role','status');
    note.hidden = !state.notice;
    note.textContent = state.notice;
    state.notice = '';
    if (params.storage && !target) {
      note.hidden = false;
      note.textContent = 'This storage is unavailable. Choose a destination from the list.';
    }
    const navigate = (id,notice = '') => {
      state.notice = notice;
      go('storages',id ? {storage:id} : {});
      host.querySelector('h1')?.focus();
    };
    function grid(label,headers,rows) {
      return '<div class="dm-table-wrap"><table class="dm-table" aria-label="' + esc(label) + '"><thead><tr>' +
        headers.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    function dialog(title,markup,trigger) {
      const overlay = document.createElement('dialog');
      overlay.className = 'dm-storage-dialog';
      overlay.setAttribute('aria-labelledby','dm-storage-dialog-title');
      overlay.innerHTML = '<form><h2 id="dm-storage-dialog-title">' + esc(title) + '</h2>' + markup +
        '<p class="dm-notice" role="alert" hidden></p><div class="dm-actions"><button type="button" class="dm-btn" data-cancel>Cancel</button>' +
        '<button type="submit" class="dm-btn dm-primary"></button></div></form>';
      view.append(overlay);
      overlay.querySelector('[data-cancel]').onclick = () => overlay.close();
      overlay.addEventListener('close',() => {overlay.remove();if (trigger.isConnected) trigger.focus();},{once:true});
      overlay.showModal();
      return overlay;
    }
    function editor(trigger) {
      const locked = linked.length > 0;
      const lockHint = locked ? '<p class="dm-muted">Reassign the linked datasets before changing the storage type or locator.</p>' : '';
      const overlay = dialog(target ? 'Edit storage' : 'Add storage',
        '<label class="dm-field">Storage name<input name="label" type="text" required></label>' +
        '<label class="dm-field">Storage type<select aria-label="Storage type" name="type">' + options(target?.type || 'folder') + '</select></label>' +
        '<label class="dm-field">Locator<input name="locator" type="text" aria-describedby="dm-storage-example" required></label>' +
        '<small class="dm-muted" id="dm-storage-example"></small>' + lockHint +
        '<label class="dm-field">Description (optional)<textarea name="detail" rows="2"></textarea></label>',trigger);
      const form = overlay.querySelector('form');
      const {label,type,locator,detail} = form.elements;
      label.value = target?.name || '';
      detail.value = target?.detail || '';
      locator.value = target?.locator || '';
      type.disabled = locked;
      locator.readOnly = locked;
      const samples = new Map();
      let previousType = type.value;
      function example() {
        const sample = types.find(t => t.id === type.value)?.example || '';
        locator.placeholder = sample;
        overlay.querySelector('#dm-storage-example').textContent = 'Example: ' + sample;
      }
      example();
      type.onchange = () => {
        samples.set(previousType,locator.value);
        previousType = type.value;
        locator.value = samples.get(type.value) || '';
        example();
      };
      overlay.querySelector('[type=submit]').textContent = target ? 'Save changes' : 'Add storage';
      form.onsubmit = event => {
        event.preventDefault();
        const values = {name:label.value,type:type.value,locator:locator.value,detail:detail.value};
        try {
          const id = target ? store.updateStorage(target.id,values) : store.addStorage(values);
          overlay.close();
          navigate(id,target ? 'Storage updated.' : 'Storage added.');
        } catch (error) {
          const output = overlay.querySelector('[role=alert]');
          output.hidden = false;
          output.textContent = error.message;
        }
      };
      label.focus();
    }
    function confirmDelete(trigger) {
      const overlay = dialog('Delete storage','<p>Remove <strong>' + esc(target.name) + '</strong> from the workspace storage list?</p>',trigger);
      const confirm = overlay.querySelector('[type=submit]');
      confirm.textContent = 'Delete storage';
      confirm.className = 'dm-btn dm-delete';
      overlay.querySelector('[data-cancel]').focus();
      overlay.querySelector('form').onsubmit = event => {
        event.preventDefault();
        try {
          store.removeStorage(target.id);
          overlay.close();
          navigate(null,'Storage deleted.');
        } catch (error) {
          const output = overlay.querySelector('[role=alert]');
          output.textContent = error.message;
          output.hidden = false;
        }
      };
    }
    if (target) {
      const refs = linked.map(ds => '<tr><td>' + esc(ds.name) + '</td><td>' + esc(ds.layer) + '</td><td>' +
        (ds.archived ? 'Archived' : 'Active') + '</td></tr>').join('');
      view.innerHTML = '<header class="dm-head"><div class="dm-toolbar"><button type="button" class="dm-back-icon" data-st="back" aria-label="Back to storages" title="Back to storages">←</button>' +
        '<h1 tabindex="-1">' + esc(target.name) + '</h1></div><button type="button" class="dm-btn" data-st="edit">Edit storage</button></header>' +
        '<section class="dm-panel"><h2>Storage details</h2><dl class="dm-kv"><dt>Storage type</dt><dd>' + esc(typeName(target.type)) +
        '</dd><dt>Locator</dt><dd><code>' + esc(target.locator) + '</code></dd><dt>Description</dt><dd>' + esc(target.detail || '—') +
        '</dd><dt>Demo data</dt><dd>Sample records are stored in this browser.</dd></dl></section>' +
        '<section class="dm-panel"><h2>Linked datasets</h2>' + (refs ? grid('Linked datasets',['Dataset','Layer','Status'],refs) : '<p class="dm-muted">No datasets use this storage.</p>') + '</section>' +
        '<div class="dm-actions"><button type="button" class="dm-btn dm-delete" data-st="delete"' + (linked.length ? ' disabled aria-describedby="dm-storage-usage"' : '') + '>Delete storage</button>' +
        (linked.length ? '<p class="dm-muted" id="dm-storage-usage">Reassign the linked datasets before deleting this storage.' +
          (linked.some(ds => ds.archived) ? ' Restore archived datasets to change their storage.' : '') + '</p>' : '') + '</div>';
    } else {
      view.innerHTML = '<header class="dm-head"><div><h1 class="sr-only" tabindex="-1">Storages</h1><p class="dm-subtitle">Manage dataset destinations. Sample records stay in this browser.</p></div>' +
        '<button class="dm-btn dm-primary" type="button" data-st="add">Add storage</button></header>' +
        '<div class="dm-toolbar dm-storage-filters"><label class="dm-field">Search storages<input type="search" placeholder="Name or locator"></label>' +
        '<label class="dm-field">Storage type<select aria-label="Storage type"><option value="">All types</option>' + options(state.type) + '</select></label>' +
        '<span class="dm-muted" role="status" data-count></span></div><div data-list></div>';
      const query = view.querySelector('input[type=search]'), filter = view.querySelector('select');
      query.value = state.query;
      function draw() {
        state.query = query.value;
        state.type = filter.value;
        const term = state.query.trim().toLowerCase();
        const matches = locations.filter(s => (!state.type || state.type === s.type) &&
          [s.name,s.locator].some(value => value.toLowerCase().includes(term)));
        view.querySelector('[data-count]').textContent = matches.length + (matches.length === 1 ? ' storage' : ' storages');
        const rows = matches.map(s => '<tr><td><button type="button" class="dm-link" data-st="open" data-id="' +
          esc(s.id) + '">' + esc(s.name) + '</button></td><td>' + esc(typeName(s.type)) + '</td><td><code>' +
          esc(s.locator) + '</code></td><td>' + (connected.get(s.id)?.length || 0) + '</td></tr>').join('');
        const empty = locations.length ? 'No storages match these filters.' : 'No storages yet.';
        view.querySelector('[data-list]').innerHTML = grid('Storage destinations',['Storage','Type','Locator','Datasets'],
          rows || '<tr><td colspan="4" class="dm-muted">' + empty + '</td></tr>');
      }
      query.oninput = filter.onchange = draw;
      draw();
    }
    view.querySelector('header').after(note);
    view.addEventListener('click',event => {
      const trigger = event.target.closest('[data-st]');
      if (!trigger) return;
      switch (trigger.dataset.st) {
        case 'open': navigate(trigger.dataset.id);break;
        case 'back': navigate(null);break;
        case 'edit': case 'add': editor(trigger);break;
        case 'delete': confirmDelete(trigger);break;
      }
    });
  }
  window.DataStorageView = {render};
})();
