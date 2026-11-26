/* Dataset management, indexing configuration, and local retrieval preview. */
(() => {
  'use strict';

  const tabs = {overview:'Overview', documents:'Documents', retrieval:'Retrieval', schedule:'Schedule', lineage:'Lineage'};
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
    const snapshot = store.snapshot();
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
    const rail = document.getElementById('ac-folder-rail');
    if (rail && active) {
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
    heading.append(group('dm-toolbar',back,node('h1',active.name),node('span',active.layer,'dm-badge'),statusBadge(active.archived ? 'Archived' : active.indexStatus)));
    view.prepend(heading);
    const navigation = node('nav',null,'dm-tabs');
    navigation.setAttribute('aria-label','Dataset views');
    for (const [key,label] of Object.entries(tabs)) {
      const tab = button(label,() => open(active.id,key));
      if (currentTab === key) tab.setAttribute('aria-current','page');
      navigation.append(tab);
    }
    view.append(navigation);
    if (active.archived) view.append(node('p','Archived datasets are read-only and excluded from retrieval. Restoring a dataset retains its configuration and requires a new index.','dm-notice'));
    if (currentTab === 'overview') drawOverview();
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
      const tools = group('dm-catalog-tools',createDataset,manageLayers);
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
      const src = select(sources.map(s => [s.id,s.name])), assets = select([]);
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
        const missing = detail ? ' Create an active raw dataset first.' : ' Register a source with at least one asset first.';
        description.textContent = (descriptions[definition?.kind] || '') + (inputReady ? '' : missing);
      }
      function updateAssets() {
        const source = sources.find(s => s.id === src.value);
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
      const folder = group('dm-toolbar',node('span',folderPath(active.folderId)));
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
        folder.append(move);
      }
      const links = table(['Dataset property','Value'],[
        ['Folder',folder],
        ['Warehouse layer',layer ? layer.code + ' · ' + layer.name : active.layer],...inputRows,
        ['Storage',location ? location.name : active.storage],['Rows',active.docs.length],
        ['Retrieval index',active.indexStatus],['Last indexed',active.indexedAt ? new Date(active.indexedAt).toLocaleString() : 'Not yet indexed']
      ]);
      const overview = panel('Dataset details',links);
      view.append(overview);
      const records = active.docs.filter(doc => doc.values && typeof doc.values === 'object');
      const rows = panel(detail ? 'Materialized detail records' : 'Materialized source records');
      if (records.length) {
        const fields = [...new Set(records.flatMap(doc => Object.keys(doc.values)))];
        const tableHolder = node('div');
        let expanded = false;
        function drawRecords() {
          const displayed = expanded ? records : records.slice(0,8);
          const fmt = v => v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
          tableHolder.replaceChildren(table([...fields,'Source evidence'],displayed.map(doc => [
            ...fields.map(f => fmt(doc.values[f])),doc.locator
          ])));
          if (records.length > 8) tableHolder.append(button(expanded ? 'Show first 8 rows' : 'Show all ' + records.length + ' rows',() => {
            expanded = !expanded;drawRecords();
          }));
        }
        drawRecords();
        rows.append(tableHolder);
        const recordActions = group('dm-actions');
        if (!active.archived) recordActions.append(button('Download records',() => {
          const exportData = {
            datasetId:active.id,name:active.name,layer:active.layer,grain:active.grain || null,
            sourceId:active.sourceId,sourceAsset:active.asset,upstreamId:active.upstreamId || null,
            records:records.map(doc => ({values:doc.values,sourceLocator:doc.locator}))
          };
          const file = new Blob([JSON.stringify(exportData,null,2)],{type:'application/json;charset=utf-8'});
          const url = URL.createObjectURL(file);
          const link = document.createElement('a');
          link.href = url;
          link.download = active.layer.toLowerCase() + '-' + active.id + '.json';
          link.hidden = true;
          view.append(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url),1000);
        }));
        if (recordActions.childElementCount) rows.append(recordActions);
      } else {
        rows.append(node('p',detail ? 'Materialize the dataset to preview its structured records and source evidence.' :
          'Ingest the source asset to preview its fields, records and evidence locations.','dm-muted'));
      }
      view.append(rows);
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
      const jobActions = group('dm-actions');
      if (!active.docs.length) jobActions.append(button(detail ? 'Materialize detail records' : 'Ingest source',() => runJob('ingest'),true));
      else jobActions.append(button(detail ? 'Refresh from upstream' : 'Refresh now',() => runJob('refresh'),true));
      const jobs = panel(detail ? 'Materialization & refresh' : 'Ingestion & refresh',jobActions);
      const nextRun = active.schedule?.enabled && active.schedule?.nextAt ? 'Next run: ' + new Date(active.schedule.nextAt).toLocaleString() :
        active.schedule?.enabled ? 'Scheduled' : 'No active schedule';
      jobs.append(node('p',nextRun,'dm-muted'));
      view.append(jobs);
      const archive = panel('Archive dataset');
      const confirmBox = group('dm-notice',node('p','Archiving removes the index and turns off the schedule. Documents and configuration are retained. After restoration the schedule stays off. Rebuild the index before retrieval and re-enable scheduling when ready.'));
      confirmBox.hidden = true;
      const start = button('Archive dataset',() => {confirmBox.hidden = false;confirm.focus();});
      const confirm = button('Confirm archive',() => execute(() => store.archive(active.id),'Dataset archived.'));
      const cancel = button('Cancel',() => {confirmBox.hidden = true;start.focus();});
      confirmBox.append(group('dm-actions',confirm,cancel));
      archive.append(start,confirmBox);
      view.append(archive);
    }
    function drawDocuments() {
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
      if (active.indexStatus === 'Not built' && !active.indexedAt) {
        const note = active.docs.length ? 'Build an index to search these documents.' :
          isDetail(active) ? 'Materialize the detail dataset before building its index.' : 'Ingest the source before building its index.';
        const lookup = panel('Document lookup',node('p',note,'dm-muted'));
        view.append(index,runtime,lookup);
        return;
      }
      const query = textInput();
      const question = field('Search indexed documents',query);
      const output = node('div');
      output.setAttribute('aria-live','polite');
      const lookup = form(() => {
        const term = query.value.trim();
        if (!term) {status('Enter a search term.',true);return;}
        try {
          const hits = store.search(active.id,term);
          if (!hits.length) {output.replaceChildren(node('p','No indexed documents matched.','dm-muted'));return;}
          output.replaceChildren(table(['Document','Source locator','Matched text'],hits.map(doc => [doc.title,doc.locator,doc.text])));
        } catch (error) {output.replaceChildren(node('p',error.message,'dm-notice'));}
      },question,group('dm-actions',submit('Search index',true)));
      view.append(index,runtime,panel('Document lookup',node('p','This local preview matches text in the last built index.','dm-muted'),lookup,output));
    }
  }
  window.DataDatasetView = {render};
})();
