(() => {
  'use strict';

  function totals(data, assets, kind, definitions) {
    const axis = kind === 'domain' ? 'domainId' : 'subjectId';
    const counts = new Map(definitions.map(d => [d.id, {links:0,source:0,dataset:0}]));
    const pairById = new Map();
    for (const pair of data.domainSubjects) {
      pairById.set(pair.id,pair);
      if (pair.active) counts.get(pair[axis]).links++;
    }
    for (const asset of assets) {
      const pair = pairById.get(asset.pairId);
      if (pair) counts.get(pair[axis])[asset.kind]++;
    }
    return counts;
  }

  function mount(host, ctx) {
    const {kind,store,assets,esc,openAssignments} = ctx;
    const data = store.snapshot();
    const isDomain = kind === 'domain';
    const label = isDomain ? 'Domain' : 'Subject';
    const definitions = [...(isDomain ? data.domains : data.subjects)].sort((a,b) => a.name.localeCompare(b.name));
    const counts = totals(data,assets,kind,definitions);
    const duplicates = new Set();
    const seen = new Set();
    for (const {name} of definitions) {
      const key = name.toLowerCase();
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    const rows = definitions.map(d => {
      const count = counts.get(d.id);
      const qualifier = duplicates.has(d.name.toLowerCase()) ? ' <small class="dm-muted">' + esc(d.id) + '</small>' : '';
      return `<tr data-definition="${esc(d.id)}"><th scope="row">${esc(d.name)}${qualifier}</th>
        <td>${esc(d.description || '—')}</td><td>${count.links}</td><td>${count.source}</td><td>${count.dataset}</td>
        <td><div class="dm-actions"><button type="button" class="dm-link" data-edit>Edit</button>
        <button type="button" class="dm-link" data-assets>View assets</button></div></td></tr>`;
    }).join('');
    const section = document.createElement('section');
    section.setAttribute('aria-label',label + ' definitions');
    section.className = 'dm-tax-assets td-definitions';
    section.innerHTML = `<div class="dm-head"><strong>${definitions.length} ${kind}${definitions.length === 1 ? '' : 's'}</strong>
      <div class="dm-actions">${isDomain ? '<button type="button" class="dm-btn" data-all-assets>Asset assignments</button>' : ''}
      <button type="button" class="dm-btn dm-primary" data-add>Add ${kind}</button></div></div>
      <p class="dm-muted">Counts include active sources and datasets with a saved assignment, including assignments to retired links.</p>
      <div class="dm-table-wrap"><table class="dm-table"><thead><tr><th scope="col">${label}</th><th scope="col">Definition</th>
      <th scope="col">${isDomain ? 'Linked subjects' : 'Linked domains'}</th><th scope="col">Sources</th><th scope="col">Datasets</th><th scope="col">Actions</th>
      </tr></thead><tbody>${rows || '<tr><td colspan="6">No definitions yet.</td></tr>'}</tbody></table></div>
      <output class="dm-muted" aria-live="polite"></output>`;
    host.replaceChildren(section);

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
          mount(host,ctx);
          host.querySelector('output').textContent = change.name + ' saved.';
          Array.from(host.querySelectorAll('[data-definition]')).find(row => row.dataset.definition === id)?.querySelector('[data-edit]')?.focus();
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
      if (button.hasAttribute('data-assets')) openAssignments({[kind]:id});
      if (button.hasAttribute('data-all-assets')) openAssignments({});
    });
  }
  window.TaxonomyDefinitions = {mount};
})();
