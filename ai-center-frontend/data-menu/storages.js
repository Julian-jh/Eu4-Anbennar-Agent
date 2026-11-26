/* Manage the logical destinations referenced by workspace datasets. */
(() => {
  'use strict';
  const sessions = new WeakMap();
  const fields = {
    folder:[{key:'path',label:'Folder path',example:'workspace/datasets',wide:true}],
    postgresql:[
      {key:'host',label:'Host',example:'db.example.test'},
      {key:'port',label:'Port',value:'5432',number:true},
      {key:'database',label:'Database name',example:'history'},
      {key:'schema',label:'Schema',value:'public'},
      {key:'username',label:'Username (optional)',optional:true},
      {key:'password',label:'Demo password (optional)',optional:true}
    ],
    s3:[{key:'bucket',label:'Bucket',example:'history-samples'},
      {key:'prefix',label:'Prefix (optional)',example:'datasets/history/',optional:true}]
  };

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
      const leave = () => { if (overlay.open) overlay.close(); };
      window.addEventListener('hashchange',leave);
      overlay.addEventListener('close',() => {
        window.removeEventListener('hashchange',leave);
        overlay.remove();
        if (trigger.isConnected) trigger.focus();
      },{once:true});
      overlay.showModal();
      return overlay;
    }
    function trialMessage(result) {
      return 'Simulated test passed. Destination: ' + result.locator;
    }
    function editor(trigger) {
      const locked = linked.length > 0;
      const lockHint = locked ? '<p class="dm-muted dm-storage-hint">Linked datasets use this destination. Reassign them to change its type or address.</p>' : '';
      const overlay = dialog(target ? 'Edit storage' : 'Add storage',
        '<div class="dm-storage-fields"><label class="dm-field">Storage name<input name="label" type="text" required></label>' +
        '<label class="dm-field">Storage type<select name="type" aria-label="Storage type">' + options(target?.type || 'folder') + '</select></label></div>' +
        '<fieldset class="dm-storage-connection"><legend></legend><div class="dm-storage-fields" data-fields></div>' + lockHint + '</fieldset>' +
        '<label class="dm-field">Description (optional)<textarea name="detail" rows="2"></textarea></label>' +
        '<div class="dm-storage-trial"><button type="button" class="dm-btn" data-test>Test connection</button>' +
        '<small class="dm-muted" id="dm-storage-test-hint">Optional local simulation. Checks settings without contacting the destination.</small></div>' +
        '<p class="dm-storage-result" role="status" aria-live="polite" hidden></p>',trigger);
      overlay.classList.add('dm-storage-editor');
      const form = overlay.querySelector('form');
      form.autocomplete = 'off';
      form.noValidate = true;
      const {label,type,detail} = form.elements;
      const confirm = form.querySelector('[type=submit]');
      const test = form.querySelector('[data-test]');
      test.setAttribute('aria-describedby','dm-storage-test-hint');
      const group = form.querySelector('[data-fields]');
      const output = form.querySelector('.dm-storage-result');
      const error = form.querySelector('[role=alert]');
      const drafts = new Map(target ? [[target.type,target.connection]] : []);
      let previousType = type.value;
      let attemptedTrial = false;
      label.value = target?.name || '';
      detail.value = target?.detail || '';
      type.disabled = locked;
      function drawFields() {
        const config = drafts.get(type.value) || {};
        group.replaceChildren();
        form.querySelector('legend').textContent = type.value === 'postgresql' ? 'PostgreSQL connection' :
          type.value === 's3' ? 'S3 destination' : 'Local destination';
        for (const field of fields[type.value]) {
          const wrap = document.createElement('label');
          wrap.className = 'dm-field' + (field.wide ? ' dm-storage-full' : '');
          wrap.textContent = field.label;
          const input = document.createElement('input');
          input.name = field.key;
          input.type = field.number ? 'number' : field.key === 'password' ? 'password' : 'text';
          input.spellcheck = false;
          input.required = !field.optional;
          input.readOnly = locked && !['username','password'].includes(field.key);
          if (field.number) { input.min = '1'; input.max = '65535'; }
          if (field.key === 'password') {
            input.autocomplete = 'new-password';
            input.placeholder = 'Discarded after test or save';
          } else {
            input.placeholder = field.example || '';
            input.value = config[field.key] ?? field.value ?? '';
          }
          wrap.append(input);
          group.append(wrap);
        }
      }
      function connection() {
        return Object.fromEntries([...group.querySelectorAll('input')].filter(input => input.name !== 'password')
          .map(input => [input.name,input.value]));
      }
      function clearPassword() {
        const password = form.elements.namedItem('password');
        if (password) password.value = '';
      }
      function resetTrial() {
        error.hidden = true;
        if (attemptedTrial) {
          output.hidden = false;
          output.dataset.result = 'pending';
          output.textContent = 'Settings changed since the last test.';
        }
      }
      function fail(message) {
        error.textContent = message;
        error.hidden = false;
      }
      type.onchange = () => {
        clearPassword();
        drafts.set(previousType,connection());
        previousType = type.value;
        drawFields();
        resetTrial();
      };
      group.oninput = resetTrial;
      test.onclick = () => {
        attemptedTrial = true;
        output.hidden = true;
        error.hidden = true;
        try {
          const invalid = group.querySelector('input:invalid');
          if (invalid) {
            invalid.focus();
            throw new Error(invalid.name === 'port' ? 'Enter a port from 1 to 65535.' :
              'Enter the ' + fields[type.value].find(field => field.key === invalid.name).label.toLowerCase() + '.');
          }
          const result = store.testStorage({type:type.value,connection:connection()});
          output.textContent = trialMessage(result);
          output.dataset.result = 'passed';
          output.hidden = false;
        } catch (err) { fail('Simulated test failed. ' + err.message); }
        finally { clearPassword(); }
      };
      drawFields();
      const initialConnection = connection();
      confirm.textContent = target ? 'Save changes' : 'Add storage';
      form.addEventListener('invalid',clearPassword,true);
      overlay.addEventListener('close',clearPassword,{once:true});
      form.onsubmit = event => {
        event.preventDefault();
        clearPassword();
        if (!label.reportValidity()) return;
        const current = connection();
        const changed = !target || type.value !== target.type ||
          Object.keys(current).some(key => current[key] !== initialConnection[key]);
        if (changed && !form.reportValidity()) return;
        const values = {name:label.value,detail:detail.value};
        if (changed) Object.assign(values,{type:type.value,connection:current});
        try {
          const id = target ? store.updateStorage(target.id,values) : store.addStorage(values);
          overlay.close();
          navigate(id,target ? 'Storage updated.' : 'Storage added.');
        } catch (err) { fail(err.message); }
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
      const properties = (fields[target.type] || []).filter(field => field.key !== 'password').map(field =>
        '<dt>' + esc(field.label.replace(' (optional)','')) + '</dt><dd>' + esc(target.connection?.[field.key] || '—') + '</dd>').join('');
      view.innerHTML = '<header class="dm-head"><div class="dm-toolbar"><button type="button" class="dm-back-icon" data-st="back" aria-label="Back to storages" title="Back to storages">←</button>' +
        '<h1 tabindex="-1">' + esc(target.name) + '</h1></div><button type="button" class="dm-btn" data-st="edit">Edit storage</button></header>' +
        '<section class="dm-panel"><h2>Storage details</h2><dl class="dm-kv"><dt>Storage type</dt><dd>' + esc(typeName(target.type)) +
        '</dd>' + properties + (target.type === 'folder' ? '' : '<dt>Destination</dt><dd><code>' + esc(target.locator) + '</code></dd>') +
        '<dt>Description</dt><dd>' + esc(target.detail || '—') +
        '</dd></dl><div class="dm-storage-trial"><button type="button" class="dm-btn" data-st="test">Test connection</button>' +
        '<small class="dm-muted">Local simulation checks the saved settings without contacting the destination.</small></div>' +
        '<p class="dm-storage-result" role="status" aria-live="polite" data-trial hidden></p></section>' +
        '<section class="dm-panel"><h2>Linked datasets</h2>' + (refs ? grid('Linked datasets',['Dataset','Layer','Status'],refs) : '<p class="dm-muted">No datasets use this storage.</p>') + '</section>' +
        '<div class="dm-actions"><button type="button" class="dm-btn dm-delete" data-st="delete"' + (linked.length ? ' disabled aria-describedby="dm-storage-usage"' : '') + '>Delete storage</button>' +
        (linked.length ? '<p class="dm-muted" id="dm-storage-usage">Reassign the linked datasets before deleting this storage.' +
          (linked.some(ds => ds.archived) ? ' Restore archived datasets to change their storage.' : '') + '</p>' : '') + '</div>';
    } else {
      view.innerHTML = '<header class="dm-head"><div><h1 class="sr-only" tabindex="-1">Storages</h1><p class="dm-subtitle">Manage dataset destinations. Sample records stay in this browser.</p></div>' +
        '<button class="dm-btn dm-primary" type="button" data-st="add">Add storage</button></header>' +
        '<div class="dm-toolbar dm-storage-filters"><label class="dm-field">Search storages<input type="search" placeholder="Name or destination"></label>' +
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
        view.querySelector('[data-list]').innerHTML = grid('Storage destinations',['Storage','Type','Destination','Datasets'],
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
        case 'test': {
          const output = view.querySelector('[data-trial]');
          try {
            output.textContent = trialMessage(store.testStorage({type:target.type,connection:target.connection}));
            output.dataset.result = 'passed';
          } catch (error) {
            output.textContent = 'Simulated test failed. ' + error.message;
            output.dataset.result = 'failed';
          }
          output.hidden = false;
          break;
        }
        case 'delete': confirmDelete(trigger);break;
      }
    });
  }
  window.DataStorageView = {render};
})();
