(() => {
  'use strict';

  const unassigned = ':unassigned';
  const searches = new WeakMap();

  function foldersFor(assets,kind,definitions) {
    const makeFolder = definition => ({...definition,source:0,dataset:0,members:[]});
    const folders = new Map(definitions.map(d => [d.id,makeFolder(d)]));
    folders.set(unassigned,makeFolder({id:unassigned,name:'Unassigned'}));
    for (const asset of assets) {
      const memberships = kind === 'domain' ? [asset.domainId || unassigned] :
        asset.subjectIds.length ? asset.subjectIds : [unassigned];
      for (const id of memberships) {
        const folder = folders.get(id);
        if (!folder) continue;
        folder.members.push(asset);
        folder[asset.kind]++;
      }
    }
    for (const folder of folders.values()) folder.members.sort((a,b) => a.name.localeCompare(b.name));
    return [...folders.values()];
  }

  function mount(host, ctx) {
    const {kind,store,data,assets,esc,openFolderIds = [],changeFolders,assetFilter = {}} = ctx;
    const isDomain = kind === 'domain';
    const label = isDomain ? 'Domain' : 'Subject';
    const definitions = [...(isDomain ? data.domains : data.subjects)].sort((a,b) => a.name.localeCompare(b.name));
    const folders = foldersFor(assets,kind,definitions);
    const relatedLabel = isDomain ? 'Subjects' : 'Domain';
    const {definitionNames} = window.Taxonomy;
    const counterparts = definitionNames(isDomain ? data.subjects : data.domains);
    const names = definitionNames(definitions);
    const expanded = new Set(openFolderIds);
    const scope = JSON.stringify([kind,assetFilter.domain,assetFilter.subject]);
    let search = searches.get(store);
    if (!search || search.scope !== scope) {
      search = {scope,term:'',collapsed:new Set()};
      searches.set(store,search);
    }
    const section = document.createElement('section');
    section.setAttribute('aria-label',label + ' definitions');
    section.className = 'dm-tax-assets td-definitions';
    section.dataset.projection = kind;
    section.innerHTML = `<div class="dm-head"><strong>${definitions.length} ${kind}${definitions.length === 1 ? '' : 's'}</strong>
      <div class="dm-actions"><label class="td-search"><span class="sr-only">Search ${kind}s and assets</span><input type="search" placeholder="Find ${kind} or asset" value="${esc(search.term)}"></label>
      <button type="button" class="dm-btn dm-primary" data-add>Add ${kind}</button></div></div>
      <div class="dm-table-wrap"><table class="dm-table td-folders" aria-label="${label} folders"><thead><tr><th scope="col">${label}</th><th scope="col">Definition</th>
      <th scope="col">Sources</th><th scope="col">Datasets</th><th scope="col">Actions</th>
      </tr></thead></table></div>
      <output class="dm-muted" aria-live="polite"></output>`;
    host.replaceChildren(section);
    const table = section.querySelector('.td-folders');
    const stableHost = host.closest('main') || host;
    const liveSection = () => stableHost.querySelector('.td-definitions[data-projection="' + kind + '"]');
    const assetByKey = new Map(assets.map(asset => [JSON.stringify([asset.kind,asset.id]),asset]));
    function counterpart(asset) {
      if (!isDomain) return counterparts.get(asset.domainId) || 'No domain';
      return asset.subjectIds.map(id => counterparts.get(id) || id).join(', ') || 'No subjects';
    }
    function matches(asset,term) {
      if (assetFilter.domain && assetFilter.domain !== (asset.domainId || 'unassigned')) return false;
      if (assetFilter.subject && !(asset.subjectIds.length ? asset.subjectIds : ['unassigned']).includes(assetFilter.subject)) return false;
      return !term || [asset.name,asset.id,asset.kind,counterpart(asset)].some(s => s.toLowerCase().includes(term));
    }
    function memberTable(folder,members) {
      if (!members.length) return '<p class="td-empty">' +
        (folder.members.length ? 'No matching assets.' : folder.id === unassigned ? 'All active assets have a ' + kind + '.' : 'No assets assigned.') + '</p>';
      const rows = members.map(asset => {
        const action = isDomain ? 'Set domain' : 'Edit subjects';
        return `<tr><th scope="row">${esc(asset.name)}</th><td>${asset.kind === 'source' ? 'Source' : 'Dataset'}</td>
          <td>${esc(counterpart(asset))}</td>
          <td><button type="button" class="dm-link" data-assignment="${esc(JSON.stringify([asset.kind,asset.id]))}">${action}</button></td></tr>`;
      }).join('');
      return `<table class="td-members" aria-label="Assets in ${esc(folder.name)}"><thead><tr><th scope="col">Asset</th><th scope="col">Type</th>
        <th scope="col">${relatedLabel}</th><th scope="col">Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    function drawFolders() {
      const term = search.term.trim().toLowerCase();
      const found = new Set();
      const rows = folders.map((folder,i) => {
        const pseudo = folder.id === unassigned;
        const name = names.get(folder.id) || folder.name;
        const foundFolder = term && name.toLowerCase().includes(term);
        const members = folder.members.filter(member => matches(member,foundFolder ? '' : term));
        if (term && !members.length && !foundFolder) return '';
        if (term) members.forEach(asset => found.add(asset));
        const open = expanded.has(folder.id) || Boolean(term && members.length && !search.collapsed.has(folder.id));
        const childrenId = 'td-' + kind + '-children-' + i;
        const addDatasets = pseudo ? '' : '<button type="button" class="dm-link" data-add-datasets="' + esc(folder.id) +
          '" aria-label="Add datasets to ' + esc(name) + '">Add datasets</button>';
        return `<tbody><tr data-definition="${esc(folder.id)}"><th scope="row"><button type="button" class="td-folder" data-folder="${esc(folder.id)}"
          aria-expanded="${open}" aria-controls="${childrenId}"><span class="td-caret" aria-hidden="true"></span><span class="td-folder-icon" aria-hidden="true"></span>
          <span>${esc(name)}</span></button></th><td>${esc(folder.description || '—')}</td>
          <td>${folder.source}</td><td>${folder.dataset}</td><td>${pseudo ? '' : '<div class="td-folder-actions">' + (!open ? addDatasets : '') +
            '<button type="button" class="dm-link" data-edit>Edit</button></div>'}</td></tr></tbody>
          <tbody id="${childrenId}" data-owner="${esc(folder.id)}"${open ? '' : ' hidden'}><tr><td class="td-children" colspan="5">${open ?
            (addDatasets ? '<div class="td-member-action">' + addDatasets + '</div>' : '') + memberTable(folder,members) : ''}</td></tr></tbody>`;
      }).join('');
      while (table.tBodies.length) table.tBodies[0].remove();
      table.insertAdjacentHTML('beforeend',rows || '<tbody><tr><td colspan="5" class="dm-muted">No matching ' + kind + 's or assets.</td></tr></tbody>');
      if (term) section.querySelector('output').textContent = found.size + (found.size === 1 ? ' matching asset.' : ' matching assets.');
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
      dialog.innerHTML = `<h2 id="dm-tax-edit-title">${record ? 'Edit' : 'Add'} ${kind}</h2>
        <form class="td-form"><label class="dm-field">${label} name<input name="name" required maxlength="100" value="${esc(record?.name || '')}"></label>
        <label class="dm-field">Definition<textarea name="description" rows="3" maxlength="500">${esc(record?.description || '')}</textarea></label>
        <p class="dm-notice" role="alert" hidden></p><div class="dm-actions">
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
          const id = isDomain ? store.saveDomain(change) : store.saveSubject(change);
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
      if (button.hasAttribute('data-add-datasets')) {
        const folderId = button.dataset.addDatasets;
        window.TaxonomyAssignment.addDatasets(section,{store,kind,definition:definitions.find(d => d.id === folderId),
          sources:ctx.sources,trigger:button,onSaved(count,name) {
            search.term = '';
            search.collapsed.delete(folderId);
            if (!expanded.has(folderId)) changeFolders([...expanded,folderId]);
            else ctx.refresh();
            const current = liveSection();
            if (!current) return;
            current.querySelector('output').textContent = count + (count === 1 ? ' dataset added to ' : ' datasets added to ') + name + '.';
            const replacement = [...current.querySelectorAll('[data-add-datasets]')].find(b => b.dataset.addDatasets === folderId);
            if (replacement) replacement.focus();
            else focusFolder(folderId);
          }});
      }
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
        window.TaxonomyAssignment.open(section,{store,asset,axis:kind,trigger:button,refresh:ctx.refresh,onSaved() {
          const current = liveSection();
          if (!current) return;
          current.querySelector('output').textContent = 'Assignment saved for ' + asset.name + '.';
          const target = [...current.querySelectorAll('[data-assignment]')].find(b => b.dataset.assignment === button.dataset.assignment &&
            b.closest('[data-owner]')?.dataset.owner === folderId);
          if (target) target.focus();
          else focusFolder(folderId);
        }});
      }
    });
  }
  window.TaxonomyDefinitions = {mount};
})();
