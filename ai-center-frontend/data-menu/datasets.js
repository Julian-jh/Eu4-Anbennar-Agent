/* Dataset management, indexing configuration, and local retrieval preview. */
(() => {
  'use strict';

  const tabs = {overview:'Overview', preview:'Data preview', documents:'Documents', retrieval:'Retrieval', schedule:'Schedule', lineage:'Lineage'};
  const catalogSelection = {layer:'',query:'',page:1};
  const descriptions = {
    raw:'Raw datasets retain the selected source records, field names and evidence locations.',
    detail:'Detail datasets materialize records from a raw dataset at a defined grain, with optional deduplication.'
  };
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text != null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  };
  function button(text, action, primary = false) {
    const el = node('button',text,primary ? 'dm-btn dm-primary' : 'dm-btn');
    el.type = 'button';
    el.addEventListener('click',action);
    return el;
  }
  function iconButton(label,type,action) {
    const el = button('',action);
    el.className = type === 'back' ? 'dm-back-icon' : 'dm-icon-action';
    el.setAttribute('aria-label',label);
    el.title = label;
    const ns = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(ns,'svg');
    for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor',
      'stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'})) {
      icon.setAttribute(key,value);
    }
    const shapes = {
      add:'M12 4v16 M4 12h16',
      import:'M12 3v11 M7.5 9.5 12 14l4.5-4.5 M4 15v5h16v-5',
      layers:'M12 3 2.5 8 12 13 21.5 8 12 3Z M3 12.3l9 4.7 9-4.7 M3 16.4l9 4.7 9-4.7',
      back:'M20 12H4 M11 5l-7 7 7 7'
    };
    const shape = document.createElementNS(ns,'path');
    shape.setAttribute('d',shapes[type]);
    icon.append(shape);
    el.append(icon);
    return el;
  }
  function submit(text, primary = false) {
    const el = node('button',text,primary ? 'dm-btn dm-primary' : 'dm-btn');
    el.type = 'submit';
    return el;
  }
  function statusBadge(text) {
    const badge = node('span',text,'dm-badge');
    badge.dataset.status = text.toLowerCase();
    return badge;
  }
  function group(className, ...children) {
    const el = node('div',null,className);
    el.append(...children);
    return el;
  }
  function field(label, control) {
    const el = node('label',null,'dm-field');
    control.setAttribute('aria-label',label);
    el.append(node('span',label),control);
    return el;
  }
  function select(values, current) {
    const el = document.createElement('select');
    for (const entry of values) {
      const [value,label] = Array.isArray(entry) ? entry : [entry,entry];
      el.add(new Option(label,value));
    }
    if (current != null) el.value = String(current);
    return el;
  }
  function textInput(value = '') {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = value;
    el.required = true;
    return el;
  }
  function numberInput(value,min,max) {
    const el = document.createElement('input');
    Object.assign(el,{type:'number',value,min,max,step:1,required:true});
    return el;
  }
  function checkbox(label, checked) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    const wrap = node('label',null,'dm-check');
    wrap.append(input,document.createTextNode(' ' + label));
    return {wrap,input};
  }
  function panel(title, ...children) {
    const section = node('section',null,'dm-panel');
    section.append(node('h2',title),...children);
    return section;
  }
  function form(handler, ...children) {
    const el = document.createElement('form');
    el.append(...children);
    el.addEventListener('submit',event => {event.preventDefault(); handler();});
    return el;
  }
  function table(headers, rows) {
    const wrapper = node('div',null,'dm-table-wrap');
    const el = node('table',null,'dm-table');
    const header = el.createTHead().insertRow();
    for (const title of headers) {
      const th = node('th',title);
      th.scope = 'col';
      header.append(th);
    }
    const body = el.createTBody();
    for (const values of rows) {
      const row = body.insertRow();
      for (const value of values) {
        const cell = row.insertCell();
        if (value instanceof Node) cell.append(value);
        else cell.textContent = value == null ? '—' : String(value);
      }
    }
    wrapper.append(el);
    return wrapper;
  }
  function sourceAssets(source) {
    if (!source) return [];
    const names = (source.assets || []).map(asset => typeof asset === 'string' ? asset : asset.object || asset.name);
    return [...new Set((names.length ? names : [source.object]).filter(Boolean))];
  }
  function optionList(values, current) {
    return [...new Set([...values,current].filter(Boolean))];
  }
  function render(host,ctx) {
    const {store,sources,params,go} = ctx;
    const preview = params.tab === 'preview' && params.dataset ? store.previewMetadata(params.dataset) : null;
    const snapshot = preview || store.snapshot();
    const datasets = snapshot.datasets || [];
    const locations = snapshot.storageLocations || [];
    const layers = snapshot.layers || [];
    const folders = snapshot.folders || [];
    const requestedFolder = params.folder;
    const selectedFolder = requestedFolder === 'unfiled' || folders.some(f => f.id === requestedFolder) ? requestedFolder : null;
    const browse = id => go('datasets',id ? {folder:id} : {});
    const layerFor = dataset => layers.find(layer => layer.code === dataset.layer);
    const isDetail = dataset => layerFor(dataset)?.kind === 'detail';
    const active = datasets.find(item => item.id === params.dataset);
    const importing = params.tab === 'import' && !params.dataset;
    const rail = document.getElementById('ac-folder-rail');
    if (rail && (active || importing)) {
      rail.replaceChildren();
      rail.hidden = true;
    }
    const view = node('section',null,'dm-datasets');
    const message = node('p',null,'dm-notice');
    message.dataset.datasetMessage = '';
    message.hidden = true;
    message.setAttribute('role','status');
    const status = (text, error = false) => {
      // A mutation can redraw the shared workspace; announce in the current view.
      const output = host.querySelector('[data-dataset-message]') || message;
      output.hidden = false;
      output.setAttribute('role',error ? 'alert' : 'status');
      output.textContent = text;
    };
    function execute(action, success, onDone) {
      try {
        const result = action();
        if (onDone) onDone(result);
        else ctx.refresh();
        if (success) status(typeof success === 'function' ? success() : success);
      } catch (error) {
        status(error.message || 'The operation could not be completed.',true);
      }
    }
    const open = (id,tab = 'overview') => go('datasets',{dataset:id,tab,...(selectedFolder ? {folder:selectedFolder} : {})});
    function indexNotice(prefix) {
      const saved = store.snapshot().datasets.find(d => d.id === active.id);
      if (saved.indexStatus === 'Ready') return prefix + ' The index is current.';
      if (saved.indexStatus === 'Rebuild required') return prefix + ' Rebuild the index to apply changes.';
      return prefix + (saved.docs.length ? ' Build an index to enable lookup.' : ' Populate the dataset before building an index.');
    }
    host.replaceChildren(view);
    view.append(message);
    if (importing) {
      if (Object.hasOwn(params,'fromQuery')) catalogSelection.query = params.fromQuery;
      if (Object.hasOwn(params,'fromLayer')) catalogSelection.layer = params.fromLayer;
      if (Object.hasOwn(params,'fromPage')) catalogSelection.page = Math.max(1,Number.parseInt(params.fromPage,10) || 1);
      const returnToCatalog = () => browse(selectedFolder);
      const back = iconButton('Back to datasets','back',returnToCatalog);
      window.DatasetImportView.render(view,{
        store,databases:sources.filter(s => s.kind === 'database').map(({id,name}) => ({id,name})),
        layers:layers.filter(l => l.kind === 'raw'),locations,folders,selectedFolder,preferredLayer:catalogSelection.layer,
        sourceId:params.source,back,openDataset:id => open(id,'preview')
      },{node,button,select,field,table,group});
      return;
    }
    if (!active) {
      view.setAttribute('aria-label','Datasets');
      if (params.dataset) status('That dataset is unavailable. Select a dataset from this catalog.',true);
      else if (requestedFolder && !selectedFolder) status('That folder is unavailable. Showing all datasets.');
      drawCatalog();
      return;
    }

    const currentTab = Object.hasOwn(tabs,params.tab) ? params.tab : 'overview';
    const heading = node('div',null,'dm-head');
    const back = iconButton(selectedFolder ? 'Back to folder' : 'All datasets','back',() => browse(selectedFolder));
    const rowCount = active.recordCount ?? active.docs.length;
    const availability = active.dataType === 'table' ? (rowCount ? 'Materialized' : 'Empty') : active.indexStatus;
    heading.append(group('dm-toolbar',back,node('h1',active.name),node('span',active.layer,'dm-badge'),statusBadge(active.archived ? 'Archived' : availability)));
    view.prepend(heading);
    const navigation = node('nav',null,'dm-tabs');
    navigation.setAttribute('aria-label','Dataset views');
    for (const [key,label] of Object.entries(tabs)) {
      const tab = button(key === 'documents' && active.dataType === 'table' ? 'Fields' : label,() => open(active.id,key));
      if (currentTab === key) tab.setAttribute('aria-current','page');
      navigation.append(tab);
    }
    view.append(navigation);
    if (active.archived) view.append(node('p',active.dataType === 'table' ? 'Archived tables are read-only. Restore this dataset to query its retained rows.' :
      'Archived documents are read-only. Restore this dataset and rebuild its index to enable retrieval.','dm-notice'));
    if (currentTab === 'overview') drawOverview();
    if (currentTab === 'preview') {
      const container = node('div');
      view.append(container);
      window.DataPreviewView.render(container,{store,dataset:active},{node,field,select,button,submit,form,group,table});
    }
    if (currentTab === 'documents') drawDocuments();
    if (currentTab === 'retrieval') drawRetrieval();
    if (currentTab === 'schedule' || currentTab === 'lineage') {
      const container = node('div');
      view.append(container);
      const renderer = currentTab === 'schedule' ? window.DataScheduleView : window.DataLineageView;
      renderer.render(container,{...ctx,dataset:active});
    }

    function drawCatalog() {
      const editor = panel('Create dataset'), layerEditor = panel('Warehouse layers');
      editor.hidden = layerEditor.hidden = true;
      const createDataset = iconButton('Create dataset','add',() => {
        if (!editor.querySelector('form')) drawCreate(editor,createDataset);
        editor.hidden = false;
        layerEditor.hidden = true;
        editor.querySelector('input').focus();
      });
      const manageLayers = iconButton('Manage layers','layers',() => {editor.hidden = true;layerEditor.hidden = false;layerEditor.querySelector('input').focus();});
      const importTables = iconButton('Import tables','import',() => go('datasets',{
        tab:'import',...(selectedFolder ? {folder:selectedFolder} : {}),
        ...(catalogSelection.query ? {fromQuery:catalogSelection.query} : {}),
        ...(catalogSelection.layer ? {fromLayer:catalogSelection.layer} : {}),
        ...(catalogSelection.page > 1 ? {fromPage:String(catalogSelection.page)} : {})
      }));
      createDataset.title = 'Define a dataset from a file, folder, URL or upstream dataset';
      importTables.title = 'Import one or more database tables as populated datasets';
      const tools = group('dm-catalog-tools',createDataset,importTables,manageLayers);
      tools.setAttribute('role','group');
      tools.setAttribute('aria-label','Dataset actions');
      const code = textInput(), name = textInput();
      const kind = select([['raw','Raw source records'],['detail','Derived detail records']]);
      const layerRows = layers.map(l => [l.code,l.name,descriptions[l.kind]]);
      layerEditor.append(table(['Code','Layer name','Purpose'],layerRows),
        form(() => {
          const layerCode = code.value.trim().toUpperCase();
          if (!layerCode || !name.value.trim()) {status('Enter both a layer code and a name.',true);return;}
          if (layers.some(l => l.code.toUpperCase() === layerCode)) {status('This layer code already exists.',true);return;}
          execute(() => store.saveLayer({code:layerCode,name:name.value.trim(),kind:kind.value}),'Warehouse layer created.');
        },group('dm-grid',field('New layer code',code),field('Layer name',name),field('Layer behavior',kind)),
        group('dm-actions',submit('Add layer',true),button('Close',() => {layerEditor.hidden = true;manageLayers.focus();}))));
      const browser = node('div');
      const changeFolder = id => {catalogSelection.page = 1;browse(id);};
      const folderRail = rail || node('aside',null,'dm-catalog-rail-fallback');
      if (!rail) view.append(folderRail);
      folderRail.hidden = false;
      window.DatasetCatalog.render(browser,{folders,datasets,sources,layers,locations,store,tools,rail:folderRail,
        selected:selectedFolder,onSelect:changeFolder,afterMutation:changeFolder,refresh:ctx.refresh,onOpen:open,
        selection:catalogSelection,status,esc:ctx.esc},{node,field,select,button,iconButton,group,table,statusBadge});
      view.append(editor,layerEditor,browser);
    }
    function drawCreate(editor,trigger) {
      const name = textInput(), grain = textInput();
      grain.placeholder = 'One row per ruler and country';
      const storage = select(locations.map(s => [s.id,s.name]));
      const destination = select(window.DatasetCatalog.folderChoices(folders),selectedFolder === 'unfiled' ? '' : selectedFolder || '');
      const layer = select(layers.map(l => [l.code,l.code + ' · ' + l.name]),catalogSelection.layer || layers[0]?.code);
      const nonDatabases = sources.filter(s => s.kind !== 'database');
      const src = select(nonDatabases.map(s => [s.id,s.name])), assets = select([]);
      const raw = datasets.filter(d => !d.archived && !isDetail(d));
      const upstream = select(raw.map(d => [d.id,d.layer + ' · ' + d.name]));
      const key = select([]);
      const rawFields = group('dm-grid',field('Source',src),field('Source asset',assets));
      const derivedFields = group('dm-grid',field('Upstream raw dataset',upstream),field('Row grain',grain),field('Deduplication key (optional)',key));
      const description = node('p',null,'dm-muted');
      const create = submit('Save dataset',true);
      function updateForm() {
        const definition = layers.find(l => l.code === layer.value);
        const detail = definition?.kind === 'detail';
        rawFields.hidden = detail;
        derivedFields.hidden = !detail;
        grain.disabled = !detail;
        const inputReady = detail ? Boolean(upstream.value) : Boolean(src.value && assets.value);
        create.disabled = !definition || !storage.value || !inputReady;
        const missing = detail ? ' Create an active raw dataset first.' : ' Register a file, folder or URL source first.';
        description.textContent = (descriptions[definition?.kind] || '') + (inputReady ? '' : missing);
      }
      function updateAssets() {
        const source = nonDatabases.find(s => s.id === src.value);
        assets.replaceChildren(...sourceAssets(source).map(a => new Option(a,a)));
        updateForm();
      }
      function updateKeys() {
        const fields = upstream.value ? store.fieldsFor(upstream.value) : [];
        key.replaceChildren(new Option('Keep all rows',''),...fields.map(f => new Option(f,f)));
        updateForm();
      }
      src.addEventListener('change',updateAssets);
      upstream.addEventListener('change',updateKeys);
      layer.addEventListener('change',updateForm);
      updateAssets(); updateKeys();
      editor.append(form(() => {
        const datasetName = name.value.trim();
        if (!datasetName) {status('Enter a dataset name.',true);name.focus();return;}
        const detail = layers.find(l => l.code === layer.value)?.kind === 'detail';
        const input = {name:datasetName,layer:layer.value,storage:storage.value,folderId:destination.value || null};
        if (detail) Object.assign(input,{upstreamId:upstream.value,grain:grain.value.trim(),keyField:key.value});
        else Object.assign(input,{sourceId:src.value,asset:assets.value});
        execute(() => store.addDataset(input),detail ? 'Detail definition created. Materialize records from its upstream dataset.' :
          'Raw dataset created. Ingest its source asset to populate records.',id => open(id));
      },group('dm-grid',field('Dataset name',name),field('Dataset layer',layer),field('Storage location',storage),field('Folder',destination)),
      description,rawFields,derivedFields,group('dm-actions',create,button('Cancel',() => {editor.hidden = true;trigger.focus();}))));
    }
    function runJob(type) {
      const detail = isDetail(active);
      const messages = {ingest:detail ? 'Detail records materialized.' : 'Source records ingested.',
        refresh:detail ? 'Detail records refreshed from upstream.' : 'Source records refreshed.',rebuild:'Index rebuilt.'};
      execute(() => store.run(active.id,type),messages[type]);
    }
    function drawOverview() {
      const detail = isDetail(active), upstream = datasets.find(d => d.id === active.upstreamId);
      const layer = layerFor(active);
      const source = sources.find(s => s.id === active.sourceId);
      const location = locations.find(s => s.id === active.storage);
      const sourceName = source?.name || 'Unavailable source';
      const inputRows = detail ? [
        ['Upstream raw dataset',upstream?.name || 'Unavailable dataset'],
        ['Row grain',active.grain],['Deduplication key',active.keyField || 'Keep all rows']
      ] : [['Source',sourceName],['Source asset',active.asset]];
      const folderPath = id => window.DatasetFolderTree.path(folders,id).join(' / ') || 'Unfiled';
      const folder = group('dm-overview-value',node('span',folderPath(active.folderId)));
      if (!active.archived) {
        const move = button('Move to folder',() => window.DatasetFolderPicker.open({
          folders,currentId:active.folderId || null,title:'Move dataset to folder',confirmLabel:'Move dataset',rootLabel:'Unfiled',trigger:move,
          onConfirm(folderId) {
            store.moveDataset(active.id,folderId);
            ctx.refresh();
            status('Dataset moved to ' + folderPath(folderId) + '.');
            requestAnimationFrame(() => host.querySelector('[data-move-dataset]')?.focus());
          }
        }));
        move.dataset.moveDataset = '';
        move.classList.add('dm-overview-action');
        folder.append(move);
      }
      const plan = active.schedule;
      let schedule = 'No active schedule';
      if (plan?.enabled) {
        schedule = window.DataSchedule.description(plan);
        if (plan.nextAt) schedule += ' · Next run ' + window.DataSchedule.display(plan.nextAt,window.DataSchedule.settings(plan).zone);
      }
      const pairId = active.domainSubjectId || '';
      const classification = group('dm-overview-value',node('span',window.TaxonomyAssignment.describe(snapshot,pairId)));
      if (!active.archived) {
        const asset = {kind:'dataset',id:active.id,name:active.name,pairId};
        const returnFocus = () => host.querySelector('[data-dataset-assignment]')?.focus();
        const assign = button(pairId ? 'Change' : 'Assign',() => window.TaxonomyAssignment.open(view,{
          store,asset,trigger:assign,refresh:ctx.refresh,onSaved() {status('Dataset classification saved.');returnFocus();}
        }));
        assign.dataset.datasetAssignment = '';
        if (pairId) assign.setAttribute('aria-label','Change assignment');
        assign.classList.add('dm-overview-action');
        const actions = group('dm-actions dm-overview-value-actions',assign);
        if (pairId) {
          const remove = button('Remove',() => execute(() => store.assignAssetPair('dataset',active.id,''),'Dataset classification removed.',() => {
            ctx.refresh();
            returnFocus();
          }));
          remove.classList.add('dm-overview-action');
          remove.setAttribute('aria-label','Remove assignment');
          actions.append(remove);
        }
        classification.append(actions);
      }
      const links = table(['Dataset property','Value'],[
        ['Folder',folder],['Domain / Subject',classification],
        ['Warehouse layer',layer ? layer.code + ' · ' + layer.name : active.layer],...inputRows,
        ['Storage',location ? location.name : active.storage],['Rows',active.docs.length],['Schedule',schedule],
        ['Retrieval',active.dataType === 'table' ? 'Structured table lookup' : 'Document search'],
        ...(active.dataType === 'table' ? [] : [['Retrieval index',active.indexStatus],['Last indexed',active.indexedAt ? new Date(active.indexedAt).toLocaleString() : 'Not yet indexed']])
      ]);
      const title = node('h2','Dataset details');
      title.id = 'dm-dataset-overview-title';
      title.tabIndex = -1;
      const header = group('dm-overview-header',title);
      const overview = node('section',null,'dm-panel dm-overview');
      overview.setAttribute('aria-labelledby',title.id);
      overview.append(header,links);
      view.append(overview);
      if (active.archived) return;
      const edit = node('details');
      edit.append(node('summary','Edit dataset details'));
      const nameInput = textInput(active.name);
      const storage = select(locations.map(s => [s.id,s.name]),active.storage);
      edit.append(form(() => {
        const name = nameInput.value.trim();
        if (!name) {status('Enter a dataset name.',true);return;}
        execute(() => store.updateDataset(active.id,{name,storage:storage.value}),'Dataset details saved.');
      },group('dm-grid',field('Dataset name',nameInput),field('Storage location',storage)),
      group('dm-actions',submit('Save details'))));
      overview.append(edit);
      const populated = active.docs.length > 0;
      const runLabel = populated ? (detail ? 'Refresh from upstream' : 'Refresh now') : (detail ? 'Materialize detail records' : 'Ingest source');
      const run = button(runLabel,() => {
        runJob(populated ? 'refresh' : 'ingest');
        host.querySelector('[data-overview-run]')?.focus();
      },true);
      run.dataset.overviewRun = '';
      const warning = node('p',active.dataType === 'table' ? 'Archiving pauses scheduling and table lookup. Restoring the dataset makes its retained rows queryable again. Its schedule stays off.' :
        'Archiving removes the index and turns off the schedule. Documents and configuration are retained. After restoration the schedule stays off. Rebuild the index before retrieval and re-enable scheduling when ready.');
      warning.id = 'dm-overview-archive-warning';
      const confirmBox = group('dm-notice',warning);
      confirmBox.id = 'dm-overview-archive-confirm';
      confirmBox.hidden = true;
      const start = button('Archive dataset',() => {
        confirmBox.hidden = false;
        start.setAttribute('aria-expanded','true');
        confirm.focus();
      });
      start.setAttribute('aria-controls',confirmBox.id);
      start.setAttribute('aria-expanded','false');
      const confirm = button('Confirm archive',() => execute(() => store.archive(active.id),'Dataset archived.',() => {
        ctx.refresh();
        host.querySelector('#dm-dataset-overview-title')?.focus();
      }));
      confirm.setAttribute('aria-describedby',warning.id);
      function cancelArchive() {
        confirmBox.hidden = true;
        start.setAttribute('aria-expanded','false');
        start.focus();
      }
      const cancel = button('Cancel',cancelArchive);
      confirmBox.addEventListener('keydown',event => {
        if (event.key === 'Escape') {event.preventDefault();cancelArchive();}
      });
      confirmBox.append(group('dm-actions',confirm,cancel));
      const actions = group('dm-actions',run,start);
      actions.setAttribute('role','group');
      actions.setAttribute('aria-label','Dataset actions');
      header.append(actions);
      header.after(confirmBox);
    }
    function drawDocuments() {
      if (active.dataType === 'table') {
        const types = store.fieldTypesFor(active.id);
        const {filterFields,returnFields,indexedFields} = active.lookup;
        const rows = Object.entries(types).map(([name,type]) => [
          name,type,filterFields.includes(name) ? 'Yes' : 'No',
          returnFields.includes(name) ? 'Yes' : 'No',indexedFields.includes(name) ? 'Yes' : 'No'
        ]);
        view.append(panel('Table fields',table(['Field','Type','Filterable','Returned','Indexed'],rows)));
        return;
      }
      if (!active.docs.length) {
        const p = panel('Documents',node('p',isDetail(active) ? 'No detail records have been materialized.' : 'No source records have been ingested.','dm-muted'));
        view.append(p);
        return;
      }
      const selected = new Set(active.docs.filter(d => d.included).map(d => d.id));
      const rows = active.docs.map(doc => {
        const include = checkbox(doc.title,selected.has(doc.id));
        include.input.disabled = active.archived;
        include.input.addEventListener('change',() => {
          if (include.input.checked) selected.add(doc.id);
          else selected.delete(doc.id);
          counter.textContent = selected.size + ' of ' + active.docs.length + ' selected';
        });
        const excerpt = node('details');
        excerpt.append(node('summary','Read document'),node('p',doc.text));
        return [include.wrap,doc.locator,excerpt];
      });
      const counter = node('span',selected.size + ' of ' + active.docs.length + ' selected','dm-muted');
      const section = panel('Included documents',table(['Include in index','Source locator','Content'],rows));
      const actions = group('dm-actions',counter);
      if (!active.archived) actions.append(button('Save inclusion',() => {
        if (active.docs.every(d => selected.has(d.id) === Boolean(d.included))) {
          status('Document inclusion is unchanged.');return;
        }
        execute(() => store.setDocuments(active.id,[...selected]),() => indexNotice('Document choices saved.'));
      },true));
      section.append(actions);
      view.append(section);
    }
    function drawRetrieval() {
      if (active.dataType === 'table') {
        window.StructuredRetrieval.render(view,{store,dataset:active,execute,status},{node,field,select,button,submit,group,table,form,panel});
        return;
      }
      const config = active.config;
      const parser = select(optionList(['Auto','Structured rows','Plain text','PDF','HTML'],config.parser),config.parser);
      const size = numberInput(config.chunkSize,64,8192);
      const overlap = numberInput(config.chunkOverlap,0,Number(size.value) - 1);
      size.addEventListener('input',() => {overlap.max = Number(size.value) - 1;});
      const embedding = select(optionList(['Multilingual','English'],config.embedding),config.embedding);
      const indexType = select(optionList(['Hybrid','Keyword','Semantic'],config.indexType),config.indexType);
      const mode = select(optionList(['Hybrid','Keyword','Semantic'],config.mode),config.mode);
      const topK = numberInput(config.topK,1,50);
      function updateConfig(patch,notice) {
        if (Object.entries(patch).every(([key,value]) => config[key] === value)) {
          status('Configuration is unchanged.');return;
        }
        execute(() => store.setConfig(active.id,patch),notice);
      }
      const indexForm = form(() => updateConfig({
        parser:parser.value,chunkSize:size.valueAsNumber,chunkOverlap:overlap.valueAsNumber,embedding:embedding.value,indexType:indexType.value
      },() => indexNotice('Index configuration saved.')),group('dm-grid',
        field('Parser',parser),field('Chunk size (tokens)',size),field('Chunk overlap (tokens)',overlap),field('Embedding profile',embedding),field('Index type',indexType)),
        group('dm-actions',submit('Save index configuration')));
      const searchForm = form(() => updateConfig({mode:mode.value,topK:topK.value},
        'Retrieval settings saved.'),group('dm-grid',field('Retrieval mode',mode),field('Top K results',topK)),group('dm-actions',submit('Save retrieval settings')));
      const index = panel('Dataset index',node('p','Build a searchable index from the included dataset documents. Parser, chunking, embedding and index changes take effect on the next rebuild.','dm-muted'),indexForm);
      const runtime = panel('Retrieval defaults',node('p','Retrieval mode and Top K are dataset query defaults. Assistant instructions and answer generation are configured in AI Center.','dm-muted'),searchForm);
      if (active.archived) {
        [indexForm,searchForm].forEach(f => Array.from(f.elements).forEach(el => {el.disabled = true;}));
        view.append(index,runtime);
        return;
      }
      if (active.docs.length) index.append(button('Rebuild index',() => runJob('rebuild')));
      view.append(index,runtime);
    }
  }
  window.DataDatasetView = {render};
})();
