(() => {
  'use strict';

  function describe(data,pairId) {
    if (!pairId) return 'Unassigned';
    const pair = data.domainSubjects.find(row => row.id === pairId);
    if (!pair) return 'Unavailable assignment';
    const domain = data.domains.find(row => row.id === pair.domainId);
    const subject = data.subjects.find(row => row.id === pair.subjectId);
    const repeated = subject && data.subjects.some(other => other.id !== subject.id && other.name === subject.name);
    return (domain?.name || pair.domainId) + ' / ' + (subject?.name || pair.subjectId) +
      (repeated ? ' · ' + subject.id : '') + (pair.active ? '' : ' (retired)');
  }

  function mountDialog(host,dialog,trigger) {
    const onNavigate = () => { if (dialog.open) dialog.close(); };
    window.addEventListener('hashchange',onNavigate);
    dialog.addEventListener('close',() => {
      window.removeEventListener('hashchange',onNavigate);
      dialog.remove();
      if (dialog.returnValue !== 'saved' && trigger?.isConnected) trigger.focus();
    },{once:true});
    host.append(dialog);
    dialog.showModal();
  }

  function open(host,{store,asset,refresh,onSaved,trigger = document.activeElement}) {
    const data = store.snapshot();
    const label = pair => describe(data,pair.id);
    const available = data.domainSubjects.filter(pair => pair.active || pair.id === asset.pairId)
      .sort((a,b) => label(a).localeCompare(label(b)));

    const dialog = document.createElement('dialog');
    dialog.className = 'dm-bulk-dialog';
    dialog.setAttribute('aria-labelledby','td-assignment-title');
    dialog.innerHTML = `<h2 id="td-assignment-title">Asset assignment</h2>
      <p class="dm-muted" data-asset-name></p>
      <form class="td-form">
        <label class="dm-field">Domain / Subject<select name="pairId"></select></label>
        <p class="dm-muted" data-empty hidden>To assign this asset, first link a subject to a domain in Subjects.</p>
        <p class="dm-notice" role="alert" hidden></p>
        <div class="dm-actions"><button type="button" class="dm-btn" data-cancel>Cancel</button>
          <button type="submit" class="dm-btn dm-primary">Save assignment</button></div>
      </form>`;
    dialog.querySelector('[data-asset-name]').textContent = (asset.kind === 'source' ? 'Source' : 'Dataset') + ' · ' + asset.name;
    const select = dialog.querySelector('select');
    select.add(new Option('Unassigned',''));
    for (const pair of available) {
      const option = new Option(label(pair),pair.id);
      option.disabled = !pair.active;
      select.add(option);
    }
    select.value = asset.pairId || '';
    dialog.querySelector('[data-empty]').hidden = available.some(pair => pair.active);
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const target = select.value;
      if (target !== asset.pairId) {
        try { store.assignAssetPair(asset.kind,asset.id,target); }
        catch (error) {
          const message = dialog.querySelector('[role=alert]');
          message.hidden = false;
          message.textContent = error.message;
          return;
        }
      }
      dialog.close('saved');
      refresh?.();
      onSaved?.();
    };
    mountDialog(host,dialog,trigger);
    select.focus();
  }

  function addDatasets(host,{store,kind,definition,sources,trigger,onSaved,onLinked}) {
    let data = store.snapshot();
    const isDomain = kind === 'domain';
    const counterpart = isDomain ? 'subject' : 'domain';
    const choices = isDomain ? data.subjects : data.domains;
    const selected = new Set();
    const original = new Map();
    let linked = false;
    const dialog = document.createElement('dialog');
    dialog.className = 'dm-bulk-dialog td-dataset-picker';
    dialog.setAttribute('aria-labelledby','td-picker-title');
    dialog.innerHTML = `<h2 id="td-picker-title">Add datasets</h2>
      <form class="td-form">
        <label class="dm-field" data-destination>Domain / Subject<select name="pair"></select></label>
        <div class="dm-field td-fixed-destination" data-fixed hidden>Domain / Subject<strong></strong></div>
        <div data-link-panel hidden>
          <p class="dm-muted" data-link-hint></p>
          <label class="dm-field"><span data-counterpart></span><select name="counterpart"></select></label>
          <button type="button" class="dm-btn" data-link></button>
        </div>
        <div class="td-dataset-choices" data-choices>
          <label class="dm-field">Find datasets<input type="search" placeholder="Name, folder or source asset"></label>
          <fieldset class="td-dataset-list"><legend class="sr-only">Available datasets</legend></fieldset>
          <output class="dm-muted" aria-live="polite"></output>
        </div>
        <p class="dm-notice" role="alert" hidden></p>
        <div class="dm-actions"><button type="button" class="dm-btn" data-cancel>Cancel</button>
          <button type="submit" class="dm-btn dm-primary">Add datasets</button></div>
      </form>`;
    const pairSelect = dialog.querySelector('[name=pair]');
    const counterpartSelect = dialog.querySelector('[name=counterpart]');
    const form = dialog.querySelector('form');
    const search = dialog.querySelector('[type=search]');
    const list = dialog.querySelector('fieldset');
    const confirm = dialog.querySelector('[type=submit]');
    const alert = dialog.querySelector('[role=alert]');
    const sourceNames = new Map(sources.map(source => [source.id,source.name]));
    const paths = new Map(window.DatasetFolderTree.folderOptions(data.folders,null,false).map(item => [item.value,item.label]));
    const labels = new Map();
    const datasets = data.datasets.filter(ds => !ds.archived).map(ds => {
      const folder = paths.get(ds.folderId) || 'Unfiled';
      const input = [sourceNames.get(ds.sourceId) || ds.sourceId,ds.asset].filter(Boolean).join(' / ');
      const location = [ds.layer,folder,input].filter(Boolean).join(' · ');
      if (!labels.has(ds.domainSubjectId)) labels.set(ds.domainSubjectId,describe(data,ds.domainSubjectId));
      const current = labels.get(ds.domainSubjectId);
      original.set(ds.id,ds.domainSubjectId || '');
      return {id:ds.id,name:ds.name,location,current,search:[ds.name,ds.id,location,current].join(' ').toLowerCase()};
    }).sort((a,b) => a.name.localeCompare(b.name));
    const options = [...choices].sort((a,b) => a.name.localeCompare(b.name));
    const names = new Set(), repeated = new Set();
    for (const choice of options) {
      if (names.has(choice.name)) repeated.add(choice.name);
      names.add(choice.name);
    }
    for (const choice of options) counterpartSelect.add(new Option(choice.name + (repeated.has(choice.name) ? ' · ' + choice.id : ''),choice.id));
    const linkButton = dialog.querySelector('[data-link]');
    linkButton.textContent = 'Link ' + counterpart;
    linkButton.disabled = !options.length;
    dialog.querySelector('[data-counterpart]').textContent = isDomain ? 'Subject' : 'Domain';
    dialog.querySelector('[data-link-hint]').textContent = options.length ?
      'Link a ' + counterpart + ' to “' + definition.name + '” before assigning datasets.' :
      'Create a ' + counterpart + ' in ' + (isDomain ? 'Subjects' : 'Domains') + ' to enable assignments to “' + definition.name + '”.';

    function summary() {
      const count = selected.size;
      const replaced = [...selected].filter(id => original.get(id)).length;
      dialog.querySelector('output').textContent = count + ' selected' + (replaced ?
        ' · ' + replaced + ' existing classification' + (replaced === 1 ? ' will' : 's will') + ' be replaced.' : '');
      confirm.disabled = !pairSelect.value || !count;
    }
    function drawRows() {
      dialog.querySelector('[data-choices]').hidden = !pairSelect.value;
      const term = search.value.trim().toLowerCase();
      const fragment = document.createDocumentFragment();
      for (const ds of datasets) {
        if (!ds.search.includes(term)) continue;
        const row = document.createElement('label');
        row.className = 'td-dataset-option';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.value = ds.id;
        check.disabled = original.get(ds.id) === pairSelect.value;
        check.checked = selected.has(ds.id);
        const details = document.createElement('span');
        const name = document.createElement('strong'), location = document.createElement('small'), current = document.createElement('small');
        name.textContent = ds.name;
        location.textContent = ds.location;
        current.textContent = check.disabled ? 'Already assigned here' : 'Current classification: ' + ds.current;
        details.append(name,location,current);
        row.append(check,details);
        fragment.append(row);
      }
      if (!fragment.childElementCount) {
        const empty = document.createElement('p');
        empty.className = 'td-empty';
        empty.textContent = datasets.length ? 'No matching datasets.' : 'No active datasets available.';
        fragment.append(empty);
      }
      list.replaceChildren(list.querySelector('legend'),fragment);
      summary();
    }
    function destinations(preferred) {
      const pairs = data.domainSubjects.filter(p => p.active && p[kind + 'Id'] === definition.id)
        .map(pair => ({id:pair.id,name:describe(data,pair.id)})).sort((a,b) => a.name.localeCompare(b.name));
      pairSelect.replaceChildren();
      if (pairs.length > 1) pairSelect.add(new Option('Choose a domain / subject pair',''));
      for (const pair of pairs) pairSelect.add(new Option(pair.name,pair.id));
      if (preferred && pairs.some(pair => pair.id === preferred)) pairSelect.value = preferred;
      dialog.querySelector('[data-destination]').hidden = pairs.length < 2;
      const fixed = dialog.querySelector('[data-fixed]');
      fixed.hidden = pairs.length !== 1;
      fixed.querySelector('strong').textContent = pairs.length === 1 ? pairs[0].name : '';
      dialog.querySelector('[data-link-panel]').hidden = !!pairs.length;
      drawRows();
    }
    function report(error) {
      alert.hidden = false;
      alert.textContent = error.message;
    }
    linkButton.onclick = () => {
      try {
        const id = counterpartSelect.value;
        const pair = store.setDomainSubject(isDomain ? definition.id : id,isDomain ? id : definition.id,true);
        linked = true;
        data = store.snapshot();
        alert.hidden = true;
        destinations(pair);
        search.focus();
      } catch (error) { report(error); }
    };
    pairSelect.onchange = () => {
      for (const id of selected) if (original.get(id) === pairSelect.value) selected.delete(id);
      drawRows();
    };
    search.oninput = drawRows;
    search.onkeydown = event => { if (event.key === 'Enter') event.preventDefault(); };
    list.onchange = ({target}) => {
      if (!target.matches('input[type=checkbox]')) return;
      if (target.checked) selected.add(target.value);
      else selected.delete(target.value);
      summary();
    };
    form.onsubmit = event => {
      event.preventDefault();
      if (confirm.disabled) return;
      const ids = [...selected];
      const expected = Object.fromEntries(ids.map(id => [id,original.get(id)]));
      try { store.assignDatasetsToPair(ids,pairSelect.value,expected); }
      catch (error) { report(error); return; }
      dialog.close('saved');
      onSaved(ids.length,pairSelect.selectedOptions[0].text);
    };
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.addEventListener('close',() => {
      if (linked && dialog.returnValue !== 'saved' && host.isConnected) onLinked();
    },{once:true});
    destinations();
    mountDialog(host,dialog,trigger);
    const initial = pairSelect.options.length ? (pairSelect.value ? search : pairSelect) : counterpartSelect;
    (initial.options?.length === 0 ? dialog.querySelector('[data-cancel]') : initial).focus();
  }
  window.TaxonomyAssignment = {open,describe,addDatasets};
})();
