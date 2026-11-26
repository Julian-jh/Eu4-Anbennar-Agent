(() => {
  'use strict';

  const unassigned = ':unassigned';
  const searches = new WeakMap();

  function foldersFor(data, assets, kind, definitions) {
    const axis = kind + 'Id';
    const makeFolder = definition => ({...definition,links:0,source:0,dataset:0,members:[]});
    const folders = new Map(definitions.map(d => [d.id,makeFolder(d)]));
    folders.set(unassigned,makeFolder({id:unassigned,name:'Unassigned'}));
    const byPair = new Map();
    for (const pair of data.domainSubjects) {
      byPair.set(pair.id,pair);
      const folder = folders.get(pair[axis]);
      if (pair.active && folder) folder.links++;
    }
    const seen = new Set();
    for (const asset of assets) {
      const key = JSON.stringify([asset.kind,asset.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      const pair = byPair.get(asset.pairId);
      const folder = folders.get(asset.pairId ? pair?.[axis] : unassigned);
      if (folder) {
        folder.members.push({asset,pair});
        folder[asset.kind]++;
      }
    }
    for (const folder of folders.values()) folder.members.sort((a,b) => a.asset.name.localeCompare(b.asset.name));
    return [...folders.values()];
  }

  function mount(host, ctx) {
    const {kind,store,assets,esc,openFolderIds = [],changeFolders,assetFilter = {}} = ctx;
    const data = store.snapshot();
    const isDomain = kind === 'domain';
    const label = isDomain ? 'Domain' : 'Subject';
    const definitions = [...(isDomain ? data.domains : data.subjects)].sort((a,b) => a.name.localeCompare(b.name));
    const folders = foldersFor(data,assets,kind,definitions);
    const relatedLabel = isDomain ? 'Subject' : 'Domain';
    const counterparts = new Map((isDomain ? data.subjects : data.domains).map(d => [d.id,d.name]));
    const expanded = new Set(openFolderIds);
    const scope = JSON.stringify([kind,assetFilter.domain,assetFilter.subject]);
    let search = searches.get(store);
    if (!search || search.scope !== scope) {
      search = {scope,term:'',collapsed:new Set()};
      searches.set(store,search);
    }
    const duplicates = new Set();
    const seen = new Set();
    for (const {name} of definitions) {
      const key = name.toLowerCase();
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    const section = document.createElement('section');
    section.setAttribute('aria-label',label + ' definitions');
    section.className = 'dm-tax-assets td-definitions';
    section.dataset.projection = kind;
    section.innerHTML = `<div class="dm-head"><strong>${definitions.length} ${kind}${definitions.length === 1 ? '' : 's'}</strong>
      <div class="dm-actions"><label class="td-search"><span class="sr-only">Search assets</span><input type="search" placeholder="Search assets" value="${esc(search.term)}"></label>
      <button type="button" class="dm-btn dm-primary" data-add>Add ${kind}</button></div></div>
      <div class="dm-table-wrap"><table class="dm-table td-folders" aria-label="${label} folders"><thead><tr><th scope="col">${label}</th><th scope="col">Definition</th>
      <th scope="col">${isDomain ? 'Linked subjects' : 'Linked domains'}</th><th scope="col">Sources</th><th scope="col">Datasets</th><th scope="col">Actions</th>
      </tr></thead></table></div>
      <output class="dm-muted" aria-live="polite"></output>`;
    host.replaceChildren(section);
    const table = section.querySelector('.td-folders');
    const stableHost = host.closest('main') || host;
    const liveSection = () => stableHost.querySelector('.td-definitions[data-projection="' + kind + '"]');
    const assetByKey = new Map(assets.map(asset => [JSON.stringify([asset.kind,asset.id]),asset]));
    function counterpart(pair) {
      return pair ? counterparts.get(pair[isDomain ? 'subjectId' : 'domainId']) || 'Unavailable' : '—';
    }
    function matches({asset,pair},term) {
      if (assetFilter.domain && assetFilter.domain !== pair?.domainId) return false;
      if (assetFilter.subject && assetFilter.subject !== pair?.subjectId) return false;
      return !term || [asset.name,asset.id,asset.kind,counterpart(pair)].some(s => s.toLowerCase().includes(term));
    }
    function memberTable(folder,members) {
      if (!members.length) return '<p class="td-empty">' +
        (folder.members.length ? 'No matching assets.' : folder.id === unassigned ? 'All assets have an assignment.' : 'No assets assigned.') + '</p>';
      const rows = members.map(({asset,pair}) => {
        const action = pair ? 'Edit assignment' : 'Assign';
        return `<tr><th scope="row">${esc(asset.name)}</th><td>${asset.kind === 'source' ? 'Source' : 'Dataset'}</td>
          <td>${esc(counterpart(pair))}${pair && !pair.active ? ' <span class="td-retired">Retired</span>' : ''}</td>
          <td><button type="button" class="dm-link" data-assignment="${esc(JSON.stringify([asset.kind,asset.id]))}">${action}</button></td></tr>`;
      }).join('');
      return `<table class="td-members" aria-label="Assets in ${esc(folder.name)}"><thead><tr><th scope="col">Asset</th><th scope="col">Type</th>
        <th scope="col">${relatedLabel}</th><th scope="col">Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    function drawFolders() {
      const term = search.term.trim().toLowerCase();
      let matchCount = 0;
      const rows = folders.map((folder,i) => {
        const pseudo = folder.id === unassigned;
        const members = folder.members.filter(member => matches(member,term));
        matchCount += members.length;
        if (term && !members.length && !pseudo) return '';
        const open = expanded.has(folder.id) || Boolean(term && members.length && !search.collapsed.has(folder.id));
        const childrenId = 'td-' + kind + '-children-' + i;
        const qualifier = !pseudo && duplicates.has(folder.name.toLowerCase()) ? ' <small>' + esc(folder.id) + '</small>' : '';
        return `<tbody><tr data-definition="${esc(folder.id)}"><th scope="row"><button type="button" class="td-folder" data-folder="${esc(folder.id)}"
          aria-expanded="${open}" aria-controls="${childrenId}"><span class="td-caret" aria-hidden="true"></span><span class="td-folder-icon" aria-hidden="true"></span>
          <span>${esc(folder.name)}${qualifier}</span></button></th><td>${esc(folder.description || '—')}</td><td>${pseudo ? '—' : folder.links}</td>
          <td>${folder.source}</td><td>${folder.dataset}</td><td>${pseudo ? '' : '<button type="button" class="dm-link" data-edit>Edit</button>'}</td></tr></tbody>
          <tbody id="${childrenId}" data-owner="${esc(folder.id)}"${open ? '' : ' hidden'}><tr><td class="td-children" colspan="6">${open ? memberTable(folder,members) : ''}</td></tr></tbody>`;
      }).join('');
      while (table.tBodies.length) table.tBodies[0].remove();
      table.insertAdjacentHTML('beforeend',rows);
      if (term) section.querySelector('output').textContent = matchCount + (matchCount === 1 ? ' matching asset.' : ' matching assets.');
    }
    function focusFolder(id) {
      const control = [...(liveSection()?.querySelectorAll('[data-folder]') || [])].find(b => b.dataset.folder === id);
      (control || liveSection()?.querySelector('.td-search input'))?.focus();
    }
    section.querySelector('.td-search input').addEventListener('input',event => {
      search.term = event.target.value;
      search.collapsed.clear();
      section.querySelector('output').textContent = '';
      drawFolders();
    });
    drawFolders();

    function edit(record) {
      const dialog = document.createElement('dialog');
      dialog.className = 'dm-bulk-dialog';
      dialog.setAttribute('aria-labelledby','dm-tax-edit-title');
      const related = new Set(data.domainSubjects.filter(p => p.subjectId === record?.id && p.active).map(p => p.domainId));
      let relatedFields = '';
      if (!isDomain) {
        const domains = [...data.domains].sort((a,b) => a.name.localeCompare(b.name));
        relatedFields = `<fieldset class="td-domains"><legend>Linked domains</legend>
          <p class="dm-muted">Optional. Removing a link preserves existing assignments.</p>
          ${domains.map(d => '<label class="dm-check"><input type="checkbox" name="domainIds" value="' + esc(d.id) + '"' +
            (related.has(d.id) ? ' checked' : '') + '> ' + esc(d.name) + '</label>').join('') ||
            '<p class="dm-muted">Domains added in the Domains tab will appear here.</p>'}</fieldset>`;
      }
      dialog.innerHTML = `<h2 id="dm-tax-edit-title">${record ? 'Edit' : 'Add'} ${kind}</h2>
        <form class="td-form"><label class="dm-field">${label} name<input name="name" required maxlength="100" value="${esc(record?.name || '')}"></label>
        <label class="dm-field">Definition<textarea name="description" rows="3" maxlength="500">${esc(record?.description || '')}</textarea></label>
        ${relatedFields}<p class="dm-notice" role="alert" hidden></p><div class="dm-actions">
        <button type="button" class="dm-btn" data-cancel>Cancel</button>
        <button type="submit" class="dm-btn dm-primary">Save ${kind}</button></div></form>`;
      section.append(dialog);
      dialog.addEventListener('close',() => dialog.remove(),{once:true});
      dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
      dialog.querySelector('form').onsubmit = event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const change = {id:record?.id,name:fields.get('name').trim(),description:fields.get('description').trim()};
        try {
          const id = isDomain ? store.saveDomain(change) : store.saveSubject({...change,domainIds:fields.getAll('domainIds')});
          dialog.close();
          search.term = '';
          search.collapsed.clear();
          ctx.refresh();
          const current = liveSection();
          current.querySelector('output').textContent = change.name + ' saved.';
          Array.from(current.querySelectorAll('[data-definition]')).find(row => row.dataset.definition === id)?.querySelector('[data-edit]')?.focus();
        } catch (error) {
          const feedback = dialog.querySelector('[role=alert]');
          feedback.hidden = false;
          feedback.textContent = error.message;
        }
      };
      dialog.showModal();
      dialog.querySelector('[name=name]').focus();
    }
    section.addEventListener('click',event => {
      const button = event.target.closest('button');
      if (!button || !section.contains(button)) return;
      const id = button.closest('[data-definition]')?.dataset.definition;
      if (button.hasAttribute('data-add')) edit();
      if (button.hasAttribute('data-edit')) edit(definitions.find(d => d.id === id));
      if (button.hasAttribute('data-folder')) {
        const next = new Set(expanded);
        if (button.getAttribute('aria-expanded') === 'true') { next.delete(id); search.collapsed.add(id); }
        else { next.add(id); search.collapsed.delete(id); }
        if (expanded.has(id) === next.has(id)) drawFolders();
        else changeFolders([...next]);
        focusFolder(id);
      }
      if (button.hasAttribute('data-assignment')) {
        const asset = assetByKey.get(button.dataset.assignment);
        const folderId = button.closest('[data-owner]')?.dataset.owner;
        if (!asset || !folderId) return;
        window.TaxonomyAssignment.open(section,{store,assets,asset,refresh:ctx.refresh,onSaved() {
          const current = liveSection();
          if (!current) return;
          current.querySelector('output').textContent = 'Assignment saved for ' + asset.name + '.';
          const target = [...current.querySelectorAll('[data-assignment]')].find(b => b.dataset.assignment === button.dataset.assignment);
          if (target) target.focus();
          else focusFolder(folderId);
        }});
      }
    });
  }
  window.TaxonomyDefinitions = {mount};
})();
