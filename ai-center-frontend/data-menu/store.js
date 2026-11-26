// The local demo keeps the source catalog in the workbench and dataset lifecycle records here.
window.createDataMenuStore = function createDataMenuStore(sources, notify) {
  const key = 'ai-center.data-menu.v1';
  const now = () => new Date().toISOString();
  const newId = prefix => prefix + '-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  const sourceFor = id => sources.find(source => source.id === id);
  const defaults = {parser:'Auto', chunkSize:512, chunkOverlap:64, embedding:'Multilingual', indexType:'Hybrid', topK:5, mode:'Hybrid'};
  const buildFields = ['parser','chunkSize','chunkOverlap','embedding','indexType'];
  const defaultLayers = [
    {code:'ODS',name:'Operational data store',kind:'raw'},
    {code:'DWD',name:'Data warehouse detail',kind:'detail'}
  ];
  const titleFields = ['title','ruler_name','display_name','alias','file_name','heading','country','ruler'];
  const storageLocations = [
    {id:'library',name:'Research library',detail:'Local workspace · documents and guides'},
    {id:'warehouse',name:'History warehouse',detail:'Local workspace · structured records'}
  ];
  function named(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a ' + label + '.');
    return value.trim();
  }
  function sourceAsset(sourceId, asset) {
    const source = sourceFor(sourceId);
    return source && (source.assets || [source]).find(item => item.object === asset);
  }
  function documentFromValues(id, locator, values) {
    const fields = Object.keys(values);
    const titleField = fields.find(field => titleFields.includes(field));
    return {id,locator,values,included:true,
      title:String(values[titleField] || values[fields[0]] || 'Record ' + id.replace(/^doc-/,'')),
      text:fields.map(field => field + ' · ' + (values[field] ?? '')).join(' | ')};
  }
  function readDocuments(source, asset) {
    const object = source && sourceAsset(source.id, asset);
    if (!object) throw new Error('Choose an asset from the selected source.');
    return object.rows.map((row, i) => documentFromValues('doc-' + (i + 1), object.object + ' / ' + (i + 1),
      Object.fromEntries(object.fields.map((field, column) => [field,row[column] ?? null]))));
  }
  function datasetRecord(id, name, sourceId, asset, storage) {
    return {id,name,sourceId,asset,storage,folderId:null,layer:'ODS',upstreamId:null,grain:'',keyField:'',subjectId:'',archived:false,archivedAt:null,
      docs:[],config:{...defaults},snapshotDocs:[],buildSignature:null,indexedAt:null,indexStatus:'Not built',
      schedule:{type:'refresh',frequency:'Daily',enabled:false,nextAt:null}};
  }
  function signature(ds) {
    return JSON.stringify([buildFields.map(k => ds.config[k]), ds.docs.filter(d => d.included).map(d => [d.id,d.title,d.text,d.locator])]);
  }
  function updateIndexStatus(ds) {
    ds.indexStatus = !ds.buildSignature ? 'Not built' : signature(ds) === ds.buildSignature ? 'Ready' : 'Rebuild required';
  }
  function build(ds, stamp) {
    ds.snapshotDocs = ds.docs.filter(d => d.included).map(d => ({...d}));
    ds.buildSignature = signature(ds);
    ds.indexedAt = stamp;
    updateIndexStatus(ds);
  }
  const daysFrom = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString();
  function fieldsForRecord(ds) {
    const fields = new Set();
    for (const doc of ds.docs) for (const field of Object.keys(doc.values || {})) fields.add(field);
    return fields.size ? [...fields] : [...(sourceAsset(ds.sourceId, ds.asset)?.fields || [])];
  }
  function materialize(upstream, keyField) {
    if (!upstream || upstream.archived) throw new Error('Restore the upstream raw dataset before refreshing this detail dataset.');
    if (!upstream.docs.length) throw new Error('Ingest rows into the upstream raw dataset before building detail records.');
    if (keyField && !fieldsForRecord(upstream).includes(keyField)) throw new Error('The upstream dataset has no field named ' + keyField + '.');
    const seen = new Set();
    const docs = [];
    for (const input of upstream.docs) {
      const entries = Object.entries(input.values || {});
      if (!entries.length) throw new Error('Refresh the upstream raw dataset to supply structured field values.');
      const values = Object.fromEntries(entries.map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
      const key = keyField && values[keyField];
      // Keep rows with missing keys. Two unknown keys do not identify the same record.
      if (key !== undefined && key !== null && key !== '') {
        const token = JSON.stringify(key);
        if (seen.has(token)) continue;
        seen.add(token);
      }
      docs.push(documentFromValues(input.id, input.locator, values));
    }
    return docs;
  }
  function addSampleDetail(datasets) {
    const upstream = datasets.find(ds => ds.id === 'reigns');
    if (!upstream || upstream.archived || upstream.layer !== 'ODS' || !upstream.docs.length ||
        datasets.some(ds => ds.id === 'reign-detail' || ds.name.toLowerCase() === 'reign detail') ||
        !upstream.docs.every(doc => Object.keys(doc.values || {}).length)) return;
    const detail = datasetRecord('reign-detail','Reign detail',upstream.sourceId,upstream.asset,upstream.storage);
    Object.assign(detail,{layer:'DWD',upstreamId:upstream.id,grain:'One reign per ruler and country',subjectId:upstream.subjectId});
    detail.docs = materialize(upstream, '');
    build(detail,now());
    datasets.push(detail);
  }
  function initialFolders(datasets) {
    const placement = new Map([
      ['reigns','folder-reigns'], ['reign-detail','folder-reigns'],
      ['missions','folder-missions'], ['early-names','folder-governance']
    ]);
    for (const dataset of datasets) dataset.folderId = placement.get(dataset.id) ?? null;
    return [
      {id:'folder-governance',name:'Governance',parentId:null},
      {id:'folder-reigns',name:'Reigns',parentId:'folder-governance'},
      {id:'folder-game-systems',name:'Game systems',parentId:null},
      {id:'folder-missions',name:'Missions',parentId:'folder-game-systems'}
    ];
  }
  function seed() {
    const stamp = now();
    const reigns = datasetRecord('reigns','Monarchs and reigns','register','public.reigns','warehouse');
    const missions = datasetRecord('missions','Mission reference','guides','mission-notes.html','library');
    const old = datasetRecord('early-names','Country names · prior edition','names','country_aliases.csv','warehouse');
    const datasets = [reigns,missions,old];
    for (const ds of datasets) ds.docs = readDocuments(sourceFor(ds.sourceId),ds.asset);
    reigns.subjectId = 'monarchs';
    reigns.schedule = window.DataSchedule.save(reigns.schedule,{type:'refresh',frequency:'Daily',time:'09:00',zone:'UTC',enabled:true},stamp);
    missions.subjectId = 'missions-and-events';
    old.subjectId = 'monarchs';
    old.archived = true;
    old.archivedAt = daysFrom(stamp,-8);
    build(reigns,daysFrom(stamp,-1));
    const jobs = [
      {id:'J-1003',type:'refresh',datasetId:missions.id,sourceId:'guides',status:'Failed',createdAt:daysFrom(stamp,-1),detail:'The sample source timed out. The previous documents were retained. Retry to run the refresh again.'},
      {id:'J-1002',type:'rebuild',datasetId:reigns.id,sourceId:'register',status:'Succeeded',createdAt:reigns.indexedAt,detail:'Published two reign records to the searchable index.'},
      {id:'J-1001',type:'sync',sourceId:'register',status:'Succeeded',createdAt:daysFrom(stamp,-2),detail:'Discovered public.reigns and synchronized its source inventory.'}
    ];
    addSampleDetail(datasets);
    return {datasets,jobs,storageLocations,folders:initialFolders(datasets),layers:defaultLayers.map(layer => ({...layer})),domains:[{id:'governance',name:'Governance & succession'},{id:'gameplay',name:'Game systems'}],
      subjects:[{id:'monarchs',domainId:'governance',name:'Monarchs and reigns'},{id:'missions-and-events',domainId:'gameplay',name:'Missions and events'}],
      sourceSubjects:{register:'monarchs',guides:'missions-and-events'},sourceOverrides:{},version:3};
  }
  function legacyValues(doc, knownFields) {
    // The old text format concatenated the field name and value in source order.
    if (typeof doc.text !== 'string') return {};
    let fields = knownFields;
    if (!fields.length || !doc.text.startsWith(fields[0] + ' · ')) {
      fields = [...doc.text.matchAll(/(?:^| \| )([^|·]+?) · /g)].map(match => match[1]);
    }
    if (!fields.length) return {};
    const values = [];
    let start = fields[0].length + 3;
    for (let i = 0; i < fields.length; i++) {
      const next = i + 1 < fields.length ? ' | ' + fields[i + 1] + ' · ' : '';
      const end = next ? doc.text.indexOf(next, start) : doc.text.length;
      if (end < 0) return {};
      values.push([fields[i], doc.text.slice(start, end)]);
      start = end + next.length;
    }
    return Object.fromEntries(values);
  }
  function migrateWarehouse(data) {
    for (const ds of data.datasets) {
      Object.assign(ds,{layer:'ODS',upstreamId:null,grain:'',keyField:''});
      const asset = sourceAsset(ds.sourceId, ds.asset);
      const sourceRows = asset ? readDocuments(sourceFor(ds.sourceId),ds.asset) : [];
      const byLocator = new Map(sourceRows.map(doc => [doc.locator,doc]));
      for (const doc of [...ds.docs, ...ds.snapshotDocs]) {
        const original = byLocator.get(doc.locator);
        doc.values = original?.text === doc.text ? original.values : legacyValues(doc, asset?.fields || []);
      }
    }
    data.layers = defaultLayers.map(layer => ({...layer}));
    addSampleDetail(data.datasets);
    data.version = 2;
  }
  let memory;
  let persistent = true;
  function read() {
    let upgraded = false;
    if (persistent) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const data = JSON.parse(raw);
          if ([1,2,3].includes(data.version) && Array.isArray(data.datasets) && Array.isArray(data.jobs)) {
            if (data.version === 1) migrateWarehouse(data);
            if (data.version === 2) {
              data.folders = initialFolders(data.datasets);
              data.version = 3;
              upgraded = true;
            }
            memory = data;
          }
        }
      } catch { persistent = false; notify('Browser storage is unavailable. Data changes will last for this session.'); }
    }
    if (!memory || upgraded) {
      if (!memory) memory = seed();
      if (persistent) {
        try { localStorage.setItem(key, JSON.stringify(memory)); }
        catch { persistent = false; notify('Sample data could only be opened for this session.'); }
      }
    }
    return memory;
  }
  function commit(fn) {
    const data = read();
    const result = fn(data);
    if (persistent) {
      try { localStorage.setItem(key,JSON.stringify(data)); }
      catch { persistent = false; notify('Browser storage is full or unavailable. Data changes will last for this session.'); }
    }
    return result;
  }
  const existing = (items,id,label) => {
    const item = items.find(i => i.id === id);
    if (!item) throw new Error('This ' + label + ' is unavailable.');
    return item;
  };
  function active(data,id) {
    const ds = existing(data.datasets,id,'dataset');
    if (ds.archived) throw new Error('Restore this dataset from Archive to make changes.');
    return ds;
  }
  function unique(items,name,id) {
    if (items.some(i => i.id !== id && i.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is already in use.');
  }
  function folderReference(data, id) {
    return id == null ? null : existing(data.folders,id,'folder').id;
  }
  function uniqueFolderName(data, name, parentId, id) {
    const siblings = data.folders.filter(folder => folder.parentId === parentId);
    unique(siblings,name,id);
  }
  function moveDatasets(ids, folderId) {
    return commit(data => {
      const destination = folderReference(data,folderId);
      if (!Array.isArray(ids) || !ids.length) throw new Error('Select at least one dataset to move.');
      const selection = Array.from(new Set(ids), id => active(data,id));
      for (const dataset of selection) dataset.folderId = destination;
      return selection.length;
    });
  }
  function selectedDatasets(data,ids) {
    if (!Array.isArray(ids) || !ids.length) throw new Error('Select at least one dataset.');
    return Array.from(new Set(ids),id => active(data,id));
  }
  function archiveDatasets(ids) {
    return commit(data => {
      const records = selectedDatasets(data,ids);
      const stamp = now();
      for (const ds of records) {
        Object.assign(ds,{archived:true,archivedAt:stamp,snapshotDocs:[],buildSignature:null,indexedAt:null,
          indexStatus:ds.dataType === 'table' ? 'Not applicable' : 'Not built',
          schedule:{...ds.schedule,enabled:false,nextAt:null}});
      }
      return records.length;
    });
  }
  function deleteDatasets(ids) {
    return commit(data => {
      const records = selectedDatasets(data,ids);
      const selected = new Map(records.map(ds => [ds.id,ds]));
      const dependents = data.datasets.filter(ds => !selected.has(ds.id) && selected.has(ds.upstreamId));
      if (dependents.length) {
        const names = dependents.map(ds => ds.name + (ds.archived ? ' (archived)' : ''));
        const restore = dependents.some(ds => ds.archived) ? ' Restore archived dependents before selecting them.' : '';
        throw new Error('Select the dependent datasets as well: ' + names.join(', ') + '.' + restore);
      }
      // Keep historical runs readable while removing their link to a runnable dataset.
      for (const job of data.jobs) {
        const ds = selected.get(job.datasetId);
        if (ds) Object.assign(job,{deletedDatasetId:ds.id,deletedDatasetName:ds.name,datasetId:null});
      }
      data.datasets = data.datasets.filter(ds => !selected.has(ds.id));
      return records.length;
    });
  }
  function log(data,fields) {
    const sequence = data.jobs.reduce((last,job) => /^J-\d+$/.test(job.id) ? Math.max(last,Number(job.id.slice(2))) : last,1000) + 1;
    const job = {id:'J-' + sequence,createdAt:now(),status:'Succeeded',datasetId:null,sourceId:null,retryOf:null,...fields};
    data.jobs.unshift(job);
    return job.id;
  }
  function layerFor(data, code) {
    const layer = data.layers.find(item => item.code === code);
    if (!layer) throw new Error('Choose a registered warehouse layer.');
    return layer;
  }
  function runDataset(data,id,type,extra={}) {
    const ds = active(data,id);
    let detail;
    if (type === 'rebuild') {
      if (!ds.docs.length) throw new Error('Ingest documents before building an index.');
      build(ds,now());
      detail = 'Published ' + ds.snapshotDocs.length + ' included document(s) to the searchable index.';
    } else if (['ingest','refresh'].includes(type)) {
      const isDetail = layerFor(data,ds.layer).kind === 'detail';
      const upstream = isDetail && data.datasets.find(item => item.id === ds.upstreamId);
      const docs = isDetail ? materialize(upstream, ds.keyField) : readDocuments(existing(sources,ds.sourceId,'source'),ds.asset);
      const selection = new Map(ds.docs.map(d => [d.id,d.included]));
      ds.docs = docs.map(d => ({...d,included:selection.get(d.id) ?? true}));
      updateIndexStatus(ds);
      detail = isDetail ? 'Materialized ' + docs.length + ' detail row(s) from ' + upstream.name + '.' :
        (type === 'ingest' ? 'Ingested ' : 'Refreshed ') + ds.docs.length + ' document(s) from ' + ds.asset + '.';
    } else throw new Error('Unknown dataset job.');
    return log(data,{type,datasetId:id,sourceId:ds.sourceId,detail,...extra});
  }
  function runSource(data,id,type,extra={}) {
    const s = existing(sources,id,'source');
    if (!['test','sync'].includes(type)) throw new Error('Unknown connection operation.');
    const detail = type === 'test' ? 'Connection test passed against the local sample for ' + s.name + '.' :
      'Synchronized ' + (s.assets || [s]).length + ' source asset(s). Refresh a linked dataset to import its documents.';
    return log(data,{type,sourceId:id,detail,...extra});
  }
  function submitJob(request) {
    let failed;
    const jobId = commit(data => {
      const {datasetId,sourceId,type,extra} = request(data);
      if (!datasetId) return runSource(data,sourceId,type,extra);
      const ds = active(data,datasetId);
      try { return runDataset(data,ds.id,type,extra); }
      catch (err) {
        failed = err;
        return log(data,{type,datasetId:ds.id,sourceId:ds.sourceId,status:'Failed',detail:err.message,...extra});
      }
    });
    // Commit the failed job before reporting its error to the interactive caller.
    if (failed) throw failed;
    return jobId;
  }
  const api = {
    snapshot:read,
    addFolder({name,parentId=null}) {
      return commit(data => {
        const folder = {id:newId('folder'), name:named(name,'folder name'), parentId:folderReference(data,parentId)};
        uniqueFolderName(data,folder.name,folder.parentId);
        data.folders.push(folder);
        return folder.id;
      });
    },
    renameFolder(id,name) {
      return commit(data => {
        const folder = existing(data.folders,id,'folder');
        name = named(name,'folder name');
        uniqueFolderName(data,name,folder.parentId,id);
        folder.name = name;
      });
    },
    moveFolder(id,parentId) {
      return commit(data => {
        const folder = existing(data.folders,id,'folder');
        const destination = folderReference(data,parentId);
        const visited = new Set([id]);
        for (let ancestor = destination; ancestor !== null; ancestor = existing(data.folders,ancestor,'folder').parentId) {
          if (visited.has(ancestor)) throw new Error('A folder cannot be moved into itself or a descendant.');
          visited.add(ancestor);
        }
        uniqueFolderName(data,folder.name,destination,id);
        folder.parentId = destination;
      });
    },
    removeFolder(id) {
      return commit(data => {
        existing(data.folders,id,'folder');
        if (data.folders.some(folder => folder.parentId === id)) throw new Error('Move or remove its subfolders first.');
        if (data.datasets.some(ds => ds.folderId === id)) throw new Error('This folder contains datasets. Move them first, restoring any archived datasets before moving them.');
        data.folders = data.folders.filter(folder => folder.id !== id);
      });
    },
    moveDatasets,
    moveDataset:(id,folderId) => moveDatasets([id],folderId),
    fieldsFor(id) { return fieldsForRecord(existing(read().datasets,id,'dataset')); },
    saveLayer({code,name,kind}) {
      return commit(data => {
        code = named(code,'layer code').toUpperCase();
        name = named(name,'layer name');
        if (!/^[A-Z][A-Z0-9_-]{0,31}$/.test(code)) throw new Error('Use a layer code of up to 32 letters, digits, underscores or hyphens, starting with a letter.');
        if (!['raw','detail'].includes(kind)) throw new Error('Choose a raw or detail layer.');
        const current = data.layers.find(layer => layer.code === code);
        if (current && current.kind !== kind) throw new Error('This layer code already has a different kind.');
        if (data.layers.some(layer => layer.code !== code && layer.name.toLowerCase() === name.toLowerCase())) throw new Error('That layer name is already in use.');
        if (current) current.name = name;
        else data.layers.push({code,name,kind});
        return code;
      });
    },
    addDataset({name,layer='ODS',sourceId,asset,storage,upstreamId,grain='',keyField='',folderId=null}) {
      return commit(data => {
        name = named(name,'dataset name');
        unique(data.datasets,name);
        existing(data.storageLocations,storage,'storage location');
        folderId = folderReference(data,folderId);
        const detail = layerFor(data, layer).kind === 'detail';
        if (detail) {
          const upstream = active(data,upstreamId);
          if (layerFor(data, upstream.layer).kind !== 'raw') throw new Error('Choose an upstream dataset in a raw warehouse layer.');
          grain = named(grain,'row grain for the detail dataset');
          if (keyField && !fieldsForRecord(upstream).includes(keyField)) throw new Error('Choose a key field from the upstream dataset.');
          sourceId = upstream.sourceId;
          asset = upstream.asset;
        } else if (!sourceAsset(sourceId, asset)) throw new Error('Choose an asset from the selected source.');
        const ds = datasetRecord(newId('dataset'),name,sourceId,asset,storage);
        ds.layer = layer;
        ds.folderId = folderId;
        if (detail) Object.assign(ds,{upstreamId,grain,keyField});
        data.datasets.unshift(ds);
        return ds.id;
      });
    },
    updateDataset(id,patch) {
      return commit(data => {
        const ds = active(data,id);
        const name = named(patch.name ?? ds.name,'dataset name');
        unique(data.datasets,name,id);
        const storage = existing(data.storageLocations,patch.storage ?? ds.storage,'storage location').id;
        Object.assign(ds,{name,storage});
      });
    },
    setDocuments(id,selectedIds) {
      return commit(data => {
        const ds = active(data,id);
        const selected = new Set(selectedIds);
        ds.docs.forEach(d => {d.included = selected.has(d.id);});
        updateIndexStatus(ds);
      });
    },
    setConfig(id,patch) {
      return commit(data => {
        const ds = active(data,id);
        const config = {...ds.config};
        Object.keys(defaults).forEach(k => {if (Object.hasOwn(patch,k)) config[k] = patch[k];});
        for (const k of ['chunkSize','chunkOverlap','topK']) config[k] = Number(config[k]);
        if (!Number.isInteger(config.chunkSize) || config.chunkSize < 64 || config.chunkSize > 8192 ||
          !Number.isInteger(config.chunkOverlap) || config.chunkOverlap < 0 || config.chunkOverlap >= config.chunkSize ||
          !Number.isInteger(config.topK) || config.topK < 1 || config.topK > 50) throw new Error('Check chunk size (64–8192), overlap (less than chunk size) and result limit (1–50).');
        for (const k of ['parser','embedding','indexType','mode']) named(config[k],k);
        ds.config = config;
        updateIndexStatus(ds);
      });
    },
    run:(id,type) => submitJob(() => ({datasetId:id,type})),
    sourceRun:(id,type) => commit(data => runSource(data,id,type)),
    retry(id) {
      return submitJob(data => {
        const job = existing(data.jobs,id,'job');
        if (job.deletedDatasetId) throw new Error('This dataset was permanently deleted. Its job cannot be retried.');
        if (job.status !== 'Failed') throw new Error('Only failed runs can be retried.');
        return {datasetId:job.datasetId,sourceId:job.sourceId,type:job.type,extra:{retryOf:id}};
      });
    },
    setSchedule(id,options) {
      return commit(data => {
        const ds = active(data,id);
        ds.schedule = window.DataSchedule.save(ds.schedule,options,now());
      });
    },
    tick() {
      const stamp = now();
      const due = ds => !ds.archived && ds.schedule.enabled && ds.schedule.nextAt && ds.schedule.nextAt <= stamp;
      if (!read().datasets.some(due)) return false;
      return commit(data => {
        const batch = data.datasets.filter(due).sort((a,b) => Number(Boolean(a.upstreamId)) - Number(Boolean(b.upstreamId)));
        for (const ds of batch) {
          try { runDataset(data,ds.id,ds.schedule.type,{trigger:'Schedule'}); }
          catch (e) { log(data,{type:ds.schedule.type,datasetId:ds.id,sourceId:ds.sourceId,status:'Failed',detail:e.message,trigger:'Schedule'}); }
          ds.schedule.nextAt = window.DataSchedule.next(ds.schedule,stamp);
        }
        return true;
      });
    },
    archiveDatasets,
    deleteDatasets,
    archive:id => archiveDatasets([id]),
    restore(id) {
      return commit(data => {
        const ds = existing(data.datasets,id,'dataset');
        if (!ds.archived) throw new Error('The dataset is already active.');
        Object.assign(ds,{archived:false,archivedAt:null});
      });
    },
    search(id,query) {
      const ds = read().datasets.find(item => item.id === id);
      if (!ds || ds.archived || !ds.buildSignature) return [];
      const terms = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
      return ds.snapshotDocs.map(doc => {
        const text = (doc.title + ' ' + doc.text).toLowerCase();
        return {doc,score:terms.filter(t => text.includes(t)).length};
      }).filter(hit => hit.score).sort((a,b) => b.score-a.score).slice(0,ds.config.topK).map(hit => hit.doc);
    },
    saveDomain(input) {
      return commit(data => {
        const name = named(input.name,'domain name');
        unique(data.domains,name,input.id);
        if (input.id) { existing(data.domains,input.id,'domain').name = name; return input.id; }
        const id = newId('domain');
        data.domains.push({id,name});
        return id;
      });
    },
    saveSubject(input) {
      return commit(data => {
        const name = named(input.name,'subject area name');
        existing(data.domains,input.domainId,'domain');
        unique(data.subjects.filter(s => s.domainId === input.domainId),name,input.id);
        if (input.id) {Object.assign(existing(data.subjects,input.id,'subject area'),{name,domainId:input.domainId}); return input.id;}
        const id = newId('subject');
        data.subjects.push({id,name,domainId:input.domainId});
        return id;
      });
    },
    assignAsset(kind,id,subjectId) {
      return commit(data => {
        if (subjectId) existing(data.subjects,subjectId,'subject area');
        if (kind === 'dataset') active(data,id).subjectId = subjectId || '';
        else if (kind === 'source') {existing(sources,id,'source'); data.sourceSubjects[id] = subjectId || '';}
        else throw new Error('Unknown asset type.');
      });
    },
    editSource(id,input) {
      return commit(data => {
        const source = existing(sources,id,'source');
        const patch = {name:named(input.name,'source name'),loc:named(input.loc,'location'),credential:named(input.credential,'credential alias')};
        if (source.kind === 'url' && !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(patch.loc)) throw new Error('Enter an HTTP or HTTPS address.');
        Object.assign(source,patch);
        data.sourceOverrides[id] = patch;
      });
    }
  };
  const state = read();
  for (const s of sources) if (Object.hasOwn(state.sourceOverrides,s.id)) Object.assign(s,state.sourceOverrides[s.id]);
  return api;
};
