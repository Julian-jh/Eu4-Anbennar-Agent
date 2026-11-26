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
    controls.append(count);
    const list = node('div',null,'dm-catalog-list');
    const paging = group('dm-catalog-pages');
    const batch = group('dm-catalog-batch');
    const selectedCount = node('strong');
    const selectedIds = new Set();
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
    batch.append(selectedCount,move,button('Clear selection',() => {selectedIds.clear();draw();}));
    content.append(controls,batch,list,paging);

    function draw() {
      selection.query = query.value;
      selection.layer = layer.value;
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
        return [check,identity,node('span',d.layer,'dm-badge'),input,storageNames.get(d.storage) || d.storage,d.docs.length,statusBadge(d.indexStatus)];
      });
      const sheet = table(['','Dataset','Layer','Input','Storage','Rows','Index'],records);
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
