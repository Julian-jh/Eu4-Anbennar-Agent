(() => {
  'use strict';

  function choicePicker(host,{trigger,title,context,searchLabel,choices,multiple,selected,emptyText,action,summary,canSave,save,onSaved}) {
    const dialog = document.createElement('dialog');
    dialog.className = 'dm-bulk-dialog td-dataset-picker';
    dialog.setAttribute('aria-labelledby','td-picker-title');
    dialog.innerHTML = `<h2 id="td-picker-title"></h2><p class="dm-muted" data-context></p>
      <form class="td-form"><label class="dm-field"><span data-search-label></span><input type="search"></label>
        <fieldset class="td-dataset-list"><legend class="sr-only"></legend></fieldset>
        <button type="button" class="dm-btn" data-more hidden>Show more</button>
        <output class="dm-muted" aria-live="polite"></output>
        <p class="dm-notice" role="alert" hidden></p>
        <div class="dm-actions"><button type="button" class="dm-btn" data-cancel>Cancel</button>
        <button type="submit" class="dm-btn dm-primary"></button></div>
      </form>`;
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('[data-context]').textContent = context;
    dialog.querySelector('[data-search-label]').textContent = searchLabel;
    const form = dialog.querySelector('form'), search = form.querySelector('[type=search]');
    const list = form.querySelector('fieldset'), legend = list.querySelector('legend');
    legend.textContent = title;
    const confirm = form.querySelector('[type=submit]'), more = form.querySelector('[data-more]');
    confirm.textContent = action;
    const count = form.querySelector('output'), alert = form.querySelector('[role=alert]');
    let visible = 50;
    function update() {
      count.textContent = summary(selected);
      confirm.disabled = !canSave(selected);
    }
    function draw() {
      const term = search.value.trim().toLowerCase();
      const matches = choices.filter(item => item.search.includes(term));
      const rows = document.createDocumentFragment();
      for (const item of matches.slice(0,visible)) {
        const row = document.createElement('label');
        row.className = 'td-dataset-option';
        const input = document.createElement('input');
        input.type = multiple ? 'checkbox' : 'radio';
        input.name = 'selection';
        input.value = item.id;
        input.checked = selected.has(item.id);
        input.disabled = !!item.disabled;
        const description = document.createElement('span'), name = document.createElement('strong');
        const key = 'td-choice-' + rows.childElementCount;
        name.id = key;
        input.setAttribute('aria-labelledby',key);
        name.textContent = item.name;
        description.append(name);
        const descriptions = [];
        for (const line of item.notes) if (line) {
          const note = document.createElement('small');
          note.id = key + '-note-' + descriptions.length;
          descriptions.push(note.id);
          note.textContent = line;
          description.append(note);
        }
        if (descriptions.length) input.setAttribute('aria-describedby',descriptions.join(' '));
        row.append(input,description);
        rows.append(row);
      }
      if (!matches.length) {
        const empty = document.createElement('p');
        empty.className = 'td-empty';
        empty.textContent = choices.length ? 'No matches.' : emptyText;
        rows.append(empty);
      }
      list.replaceChildren(legend,rows);
      more.hidden = matches.length <= visible;
      update();
    }
    more.onclick = () => {
      const firstNew = visible;
      visible += 50;
      draw();
      list.querySelectorAll('input')[firstNew]?.closest('label')?.scrollIntoView({block:'nearest'});
      const available = [...list.querySelectorAll('input')].slice(firstNew).find(input => !input.disabled);
      (available || (more.hidden ? search : more)).focus();
    };
    list.onchange = ({target}) => {
      if (!target.matches('input[name=selection]')) return;
      if (!multiple) selected.clear();
      if (target.checked) selected.add(target.value);
      else selected.delete(target.value);
      update();
    };
    search.oninput = () => { visible = 50; draw(); };
    search.onkeydown = event => { if (event.key === 'Enter') event.preventDefault(); };
    form.onsubmit = event => {
      event.preventDefault();
      if (confirm.disabled) return;
      let result;
      try { result = save(selected); }
      catch (error) { alert.textContent = error.message; alert.hidden = false; return; }
      dialog.close('saved');
      onSaved?.(result);
    };
    form.querySelector('[data-cancel]').onclick = () => dialog.close();
    const closeOnNavigation = () => { if (dialog.open) dialog.close(); };
    window.addEventListener('hashchange',closeOnNavigation);
    dialog.addEventListener('close',() => {
      window.removeEventListener('hashchange',closeOnNavigation);
      dialog.remove();
      if (dialog.returnValue !== 'saved' && trigger?.isConnected) trigger.focus();
    },{once:true});
    draw();
    host.append(dialog);
    dialog.showModal();
    search.focus();
  }

  function open(host,{store,asset,axis,trigger = document.activeElement,refresh,onSaved}) {
    const data = store.snapshot();
    const domain = axis === 'domain';
    const definitions = domain ? data.domains : data.subjects;
    const names = window.Taxonomy.definitionNames(definitions);
    const ds = asset.kind === 'dataset' ? data.datasets.find(row => row.id === asset.id) : null;
    const field = domain ? 'domainId' : 'subjectIds';
    const original = asset.kind === 'dataset' ? ds?.[field] : (domain ? data.sourceDomainIds : data.sourceSubjectIds)[asset.id];
    const ids = domain ? [original || ''] : (original || []);
    const selected = new Set(ids);
    const choices = definitions.map(def => {
      const name = names.get(def.id);
      return {id:def.id,name,notes:[def.description],search:[name,def.description].join(' ').toLowerCase()};
    }).sort((a,b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || a.name.localeCompare(b.name));
    if (domain) choices.unshift({id:'',name:'Unassigned',notes:[],search:'unassigned'});
    choicePicker(host,{
      title:domain ? 'Assign domain' : 'Assign subjects',context:(asset.kind === 'source' ? 'Source' : 'Dataset') + ' · ' + asset.name,
      searchLabel:domain ? 'Find a domain' : 'Find subjects',multiple:!domain,action:domain ? 'Save domain' : 'Save subjects',
      choices,selected,trigger,emptyText:'Create a subject in Taxonomy to assign it here.',
      summary:selection => domain ? (names.get([...selection][0]) || 'Unassigned') : selection.size + ' selected',
      canSave:selection => selection.size !== ids.length || ids.some(id => !selection.has(id)),
      save(selection) {
        const value = domain ? [...selection][0] : [...selection];
        store.setAssetClassification(asset.kind,asset.id,{[field]:value},{[field]:domain ? ids[0] : ids});
      },
      onSaved() { refresh?.(); onSaved?.(); }
    });
  }

  function addDatasets(host,{store,kind,definition,sources,trigger,onSaved}) {
    const data = store.snapshot();
    const domain = kind === 'domain';
    const sourceNames = new Map(sources.map(source => [source.id,source.name]));
    const paths = new Map(window.DatasetFolderTree.folderOptions(data.folders,null,false).map(item => [item.value,item.label]));
    const names = window.Taxonomy.definitionNames(domain ? data.domains : data.subjects);
    const original = new Map();
    const choices = data.datasets.filter(ds => !ds.archived).map(ds => {
      const current = domain ? ds.domainId : ds.subjectIds;
      original.set(ds.id,current);
      const assigned = domain ? current === definition.id : current.includes(definition.id);
      const classification = domain ? (names.get(current) || 'Unassigned') : (current.map(id => names.get(id) || id).join(', ') || 'None');
      const source = [sourceNames.get(ds.sourceId) || ds.sourceId,ds.asset].filter(Boolean).join(' / ');
      const location = [ds.layer,paths.get(ds.folderId) || 'Unfiled',source].filter(Boolean).join(' · ');
      const notes = [location,assigned ? 'Already assigned here' : (domain ? 'Domain · ' : 'Subjects · ') + classification];
      return {id:ds.id,name:ds.name,notes,disabled:assigned,search:[ds.name,ds.id,location,classification].join(' ').toLowerCase()};
    }).sort((a,b) => a.name.localeCompare(b.name));
    choicePicker(host,{
      title:'Add datasets',context:(domain ? 'Domain' : 'Subject') + ' · ' + names.get(definition.id),searchLabel:'Find datasets',
      choices,multiple:true,selected:new Set(),emptyText:'No active datasets available.',action:'Add datasets',trigger,
      summary(selected) {
        const replaced = domain ? [...selected].filter(id => original.get(id)).length : 0;
        return selected.size + ' selected' + (replaced ? ' · ' + replaced + ' existing domain assignment' + (replaced === 1 ? '' : 's') + ' will be replaced.' : '');
      },
      canSave:selected => selected.size > 0,
      save(selected) {
        const ids = [...selected], expected = Object.fromEntries(ids.map(id => [id,original.get(id)]));
        return store.classifyDatasets(ids,kind,definition.id,expected);
      },
      onSaved(count) { onSaved(count,definition.name); }
    });
  }
  window.TaxonomyAssignment = {open,addDatasets};
})();
