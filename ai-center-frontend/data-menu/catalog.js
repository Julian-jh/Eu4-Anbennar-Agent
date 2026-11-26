/* Folder-scoped browsing and filing of active warehouse datasets. */
(() => {
  'use strict';
  const pageSize = 25;
  function folderChoices(folders) {
    return [['','Unfiled'],...window.DatasetFolderTree.folderOptions(folders,null,false).map(o => [o.value,o.label])];
  }

  function render(host,config,ui) {
    const {folders,datasets,sources,layers,locations,selected,store,onSelect,onOpen,afterMutation,selection,status} = config;
    const {node,field,select,button,iconButton,group,table,statusBadge} = ui;
    const content = node('section',null,'dm-catalog-contents');
    content.setAttribute('aria-label','Dataset catalog');
    host.className = 'dm-catalog-browser';
    host.replaceChildren(content);
    window.DatasetFolderTree.render(config.rail,{...config,onSelect,afterMutation,tools:config.tools});
    const paths = new Map(folderChoices(folders));
    const scopeName = selected === 'unfiled' ? 'Unfiled' : selected ? paths.get(selected) : 'All datasets';
    const scope = selected && selected !== 'unfiled' ? window.DatasetFolderTree.idsInSubtree(folders,selected) : null;
    const subset = datasets.filter(d => !d.archived && (scope ? scope.has(d.folderId) : selected === 'unfiled' ? !d.folderId : true));
    const inputNames = new Map(sources.map(s => [s.id,s.name]));
    const upstreamNames = new Map(datasets.map(d => [d.id,d.name]));
    const storageNames = new Map(locations.map(s => [s.id,s.name]));
    const inputName = d => d.upstreamId ? upstreamNames.get(d.upstreamId) : inputNames.get(d.sourceId);
    const folderPath = d => paths.get(d.folderId || '') || 'Unfiled';
    const query = node('input');
    query.type = 'search';
    query.placeholder = 'Name, input or folder';
    query.value = selection.query;
    const layer = select([['','All layers'],...layers.map(l => [l.code,l.code + ' · ' + l.name])],selection.layer);
    const count = node('span',null,'dm-catalog-count');
    count.setAttribute('aria-live','polite');
    const crumb = node('nav',null,'dm-catalog-crumb');
    crumb.setAttribute('aria-label','Folder path');
    if (selected) {
      crumb.append(iconButton('All datasets','back',() => onSelect(null)),node('span',scopeName));
      content.append(crumb);
    }
    const controls = group('dm-catalog-filters',field('Search datasets',query),field('Warehouse layer',layer));
    const filters = node('section',null,'dm-filter-panel');
    filters.setAttribute('aria-label','Dataset filters');
    const clearFilters = button('Clear filters',() => {
      query.value = layer.value = '';
      changeFilter();
      query.focus();
    });
    filters.append(group('dm-filter-heading',node('h2','Filters'),clearFilters),controls);
    const results = node('section',null,'dm-catalog-results');
    results.setAttribute('aria-label','Dataset results');
    const list = node('div',null,'dm-catalog-list');
    const paging = group('dm-catalog-pages');
    const batch = group('dm-catalog-batch');
    const selectedCount = node('strong');
    const selectedIds = new Set(selection.afterRunIds);
    delete selection.afterRunIds;
    let page = selection.page || 1;
    const move = button('Move selected',() => {
      if (!selectedIds.size) return;
      const current = new Set(subset.filter(d => selectedIds.has(d.id)).map(d => d.folderId || null));
      window.DatasetFolderPicker.open({
        folders,currentId:current.size === 1 ? [...current][0] : undefined,title:'Move selected datasets',confirmLabel:'Move selected',rootLabel:'Unfiled',trigger:move,
        onConfirm(folderId) {
          const moved = store.moveDatasets([...selectedIds],folderId);
          afterMutation(selected);
          status(moved + (moved === 1 ? ' dataset filed in ' : ' datasets filed in ') + paths.get(folderId || '') + '.');
          requestAnimationFrame(() => document.querySelector('.dm-catalog-filters input[type="search"]')?.focus());
        }
      });
    },true);
    function confirmBatch(operation,trigger) {
      const records = subset.filter(ds => selectedIds.has(ds.id));
      if (!records.length) return;
      const deleting = operation === 'delete';
      const quantity = records.length + (records.length === 1 ? ' dataset' : ' datasets');
      const dialog = node('dialog',null,'dm-bulk-dialog');
      const title = node('h2',(deleting ? 'Permanently delete ' : 'Archive ') + quantity + '?');
      title.id = 'dm-bulk-confirm-title';
      dialog.setAttribute('aria-labelledby',title.id);
      let explanation = 'Stored data, configuration, schedules and indexes will be permanently removed. This cannot be undone. Past jobs remain in job history.';
      if (!deleting) {
        explanation = 'Schedules will stop. Restore from Archive to recover the data and configuration, then re-enable any schedules you need.';
        if (records.some(ds => ds.dataType === 'table')) explanation += ' Restored tables are immediately available for lookup.';
        if (records.some(ds => ds.dataType !== 'table')) explanation += ' Document retrieval indexes will be removed. Rebuild them after restoring the documents.';
      }
      const description = node('p',explanation);
      description.id = 'dm-bulk-description';
      dialog.setAttribute('aria-describedby',description.id);
      const details = node('details');
      details.append(node('summary','Selected datasets (' + records.length + ')'));
      const names = node('ul');
      for (const ds of records) names.append(node('li',ds.name));
      details.append(names);
      const notice = node('p',null,'dm-notice');
      notice.hidden = true;
      notice.setAttribute('role','alert');
      const cancel = button('Cancel',() => dialog.close());
      cancel.autofocus = true;
      const confirm = button(deleting ? 'Delete permanently' : 'Confirm archive',() => {
        const ids = records.map(ds => ds.id);
        try {
          if (deleting) store.deleteDatasets(ids);
          else store.archiveDatasets(ids);
        } catch (error) {
          notice.textContent = error.message || 'The change could not be saved.';
          notice.hidden = false;
          return;
        }
        dialog.close();
        config.refresh();
        status(quantity + (deleting ? ' permanently deleted.' : ' archived. Restore from Archive.'));
        requestAnimationFrame(() => document.querySelector('.dm-catalog-filters input[type="search"]')?.focus());
      },true);
      dialog.append(title,description);
      if (!deleting) {
        const downstream = datasets.filter(ds => !ds.archived && !selectedIds.has(ds.id) && selectedIds.has(ds.upstreamId));
        if (downstream.length) dialog.append(node('p','Restore the upstream data before refreshing ' + downstream.map(ds => ds.name).join(', ') + '.'));
      }
      dialog.append(details,notice,group('dm-actions',cancel,confirm));
      const closeOnNavigation = () => dialog.close();
      window.addEventListener('hashchange',closeOnNavigation);
      dialog.addEventListener('close',() => {
        window.removeEventListener('hashchange',closeOnNavigation);
        dialog.remove();
        if (trigger.isConnected && trigger.getClientRects().length) trigger.focus();
      },{once:true});
      document.body.append(dialog);
      dialog.showModal();
    }
    const archive = button('Archive selected',() => confirmBatch('archive',archive));
    const remove = button('Delete selected',() => confirmBatch('delete',remove));
    const taskActions = window.DatasetBatch.actions({store,status,getSelected:() => subset.filter(ds => selectedIds.has(ds.id)),
      refresh:() => {selection.afterRunIds = [...selectedIds];config.refresh();}},ui);
    batch.append(selectedCount,...taskActions,move,archive,remove,button('Clear selection',() => {selectedIds.clear();draw();}));
    results.append(count,batch,list,paging);
    content.append(filters,results);

    function draw() {
      selection.query = query.value;
      selection.layer = layer.value;
      clearFilters.hidden = !query.value && !layer.value;
      const term = query.value.trim().toLocaleLowerCase();
      const matches = subset.filter(d => (!layer.value || d.layer === layer.value) && (!term ||
        [d.name,d.asset,d.layer,d.grain,inputName(d),folderPath(d)].some(v => String(v || '').toLocaleLowerCase().includes(term))));
      const pages = Math.max(1,Math.ceil(matches.length/pageSize));
      selection.page = page = Math.max(1,Math.min(pages,page));
      const start = (page-1)*pageSize;
      const rows = matches.slice(start,start+pageSize);
      count.textContent = matches.length + (matches.length === 1 ? ' dataset' : ' datasets');
      paging.replaceChildren();
      paging.hidden = pages === 1;
      if (pages > 1) {
        const previous = button('Previous',() => {page--;draw();});
        const next = button('Next',() => {page++;draw();});
        previous.disabled = page === 1;
        next.disabled = page === pages;
        paging.append(node('span',(start+1) + '–' + (start+rows.length) + ' of ' + matches.length),previous,next);
      }
      const checks = [];
      const pageCheck = node('input');
      pageCheck.type = 'checkbox';
      pageCheck.setAttribute('aria-label','Select datasets on this page');
      function updateChecks() {
        checks.forEach(([check,id]) => {check.checked = selectedIds.has(id);});
        pageCheck.checked = rows.length > 0 && rows.every(d => selectedIds.has(d.id));
        pageCheck.indeterminate = !pageCheck.checked && rows.some(d => selectedIds.has(d.id));
        selectedCount.textContent = selectedIds.size + ' selected';
        batch.hidden = !selectedIds.size;
      }
      if (!rows.length) {
        const empty = query.value || layer.value ? 'No datasets match these filters.' : 'This folder has no active datasets.';
        list.replaceChildren(node('p',empty,'dm-catalog-empty'));
        updateChecks();
        return;
      }
      pageCheck.onchange = () => {
        for (const d of rows) {if (pageCheck.checked) selectedIds.add(d.id); else selectedIds.delete(d.id);}
        updateChecks();
      };
      const records = rows.map(d => {
        const check = node('input');
        check.type = 'checkbox';
        check.setAttribute('aria-label','Select ' + d.name);
        checks.push([check,d.id]);
        check.onchange = () => {if (check.checked) selectedIds.add(d.id); else selectedIds.delete(d.id);updateChecks();};
        const identity = group('dm-catalog-identity',button(d.name,() => onOpen(d.id)),node('small',folderPath(d),'dm-catalog-path'));
        const input = group('dm-source-identity',node('span',inputName(d) || 'Unavailable'),node('small',d.upstreamId ? d.grain : d.asset,'dm-catalog-path'));
        const retrieval = d.dataType === 'table' ? 'Structured lookup' : d.indexStatus;
        return [check,identity,node('span',d.layer,'dm-badge'),input,storageNames.get(d.storage) || d.storage,d.docs.length,statusBadge(retrieval)];
      });
      const sheet = table(['','Dataset','Layer','Input','Storage','Rows','Retrieval'],records);
      sheet.querySelector('th').append(pageCheck);
      list.replaceChildren(sheet);
      updateChecks();
    }
    function changeFilter() {selectedIds.clear();page = 1;draw();}
    query.addEventListener('input',changeFilter);
    layer.addEventListener('change',changeFilter);
    draw();
  }
  window.DatasetCatalog = {render,folderChoices};
})();
