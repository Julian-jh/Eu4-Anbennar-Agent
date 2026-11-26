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
    {id:'library',name:'Research library',type:'folder',locator:'workspace/library',detail:'Local workspace · documents and guides'},
    {id:'warehouse',name:'History warehouse',type:'folder',locator:'workspace/warehouse',detail:'Local workspace · structured records'}
  ];
  const storageProfile = window.StorageProfile;
  function named(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a ' + label + '.');
    return value.trim();
  }
  function storageUse(data,id) {
    const linked = data.datasets.filter(ds => ds.storage === id);
    if (!linked.length) return '';
    const archived = linked.filter(ds => ds.archived).length;
    const counts = [linked.length > archived ? (linked.length-archived) + ' active' : '',archived ? archived + ' archived' : ''].filter(Boolean);
    return 'This storage is assigned to ' + counts.join(' and ') + (linked.length === 1 ? ' dataset.' : ' datasets.');
  }
  function sourceAsset(sourceId, asset) {
    const source = sourceFor(sourceId);
    return source && (source.assets || [source]).find(item => item.object === asset);
  }
  function retrievalType(ds) {
    if (ds.upstreamId) return 'table';
    const source = sourceFor(ds.sourceId);
    const asset = sourceAsset(ds.sourceId, ds.asset);
    if (['table','document'].includes(asset?.dataType)) return asset.dataType;
    if (source?.kind === 'database') return 'table';
    const fields = fieldsForRecord(ds);
    if (source?.kind === 'folder' && fields.includes('file_name') &&
        !fields.some(field => ['body','content','text','excerpt','sample_text'].includes(field))) return 'table';
    const filename = String(ds.asset).split(' · ')[0].toLowerCase();
    if (/\.(csv|tsv|xlsx?|jsonl?|parquet)$/.test(filename)) return 'table';
    if (/\.(pdf|html?|txt|md|docx?)$/.test(filename)) return 'document';
    if (/pdf|html|plain text|markdown|word/i.test(source?.format || '')) return 'document';
    if (/csv|tsv|json|excel|sql|parquet/i.test(source?.format || '')) return 'table';
    return fields.some(field => ['excerpt','body','sample_text','page_text','content'].includes(field)) ? 'document' : 'table';
  }
  function initializeRetrieval(ds) {
    ds.dataType = retrievalType(ds);
    if (ds.dataType === 'table') {
      const fields = fieldsForRecord(ds);
      ds.lookup = {filterFields:[...fields],returnFields:[...fields],indexedFields:[]};
      Object.assign(ds,{snapshotDocs:[],buildSignature:null,indexedAt:null,indexStatus:'Not applicable'});
      if (ds.schedule.type === 'rebuild') Object.assign(ds.schedule,{type:'refresh',enabled:false,nextAt:null});
    }
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
    return {id,name,sourceId,asset,storage,folderId:null,layer:'ODS',upstreamId:null,grain:'',keyField:'',domainId:'',subjectIds:[],archived:false,archivedAt:null,
      docs:[],config:{...defaults},snapshotDocs:[],buildSignature:null,indexedAt:null,indexStatus:'Not built',
      schedule:{type:'refresh',frequency:'Daily',enabled:false,nextAt:null}};
  }
  function signature(ds) {
    return JSON.stringify([buildFields.map(k => ds.config[k]), ds.docs.filter(d => d.included).map(d => [d.id,d.title,d.text,d.locator])]);
  }
  function updateIndexStatus(ds) {
    if (ds.dataType === 'table') {ds.indexStatus = 'Not applicable';return;}
    ds.indexStatus = !ds.buildSignature ? 'Not built' : signature(ds) === ds.buildSignature ? 'Ready' : 'Rebuild required';
  }
  function build(ds, stamp) {
    if (ds.dataType === 'table') throw new Error('Structured lookups read materialized rows. Refresh the table to update its data.');
    if (!ds.docs.length) throw new Error('Ingest documents before building an index.');
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
  const blank = value => value == null || typeof value === 'string' && !value.trim();
  const numberPattern = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value;
  }
  const tableCaches = new WeakMap();
  const valueFor = (doc,field) => Object.hasOwn(doc.values || {},field) ? doc.values[field] : null;
  const textKey = value => (typeof value === 'object' ? JSON.stringify(value) : String(value)).trim().toLowerCase();
  function fieldType(ds, field) {
    let type;
    for (const doc of ds.docs) {
      const value = valueFor(doc,field);
      if (blank(value)) continue;
      const normalized = typeof value === 'string' ? value.trim() : value;
      const current = isDate(normalized) ? 'Date' : numberPattern.test(String(normalized)) && Number.isFinite(Number(normalized)) ? 'Number' : 'Text';
      if (current === 'Text' || type && type !== current) return 'Text';
      type = current;
    }
    return type || 'Text';
  }
  function tableCache(ds) {
    // Ingestion and refresh replace this array. Positions and types belong to that materialization only.
    let cache = tableCaches.get(ds.docs);
    if (!cache) {
      const types = new Map(fieldsForRecord(ds).map(field => [field,fieldType(ds,field)]));
      cache = {types,indexes:new Map()};
      if (ds.docs.length) tableCaches.set(ds.docs,cache);
    }
    return cache;
  }
  function indexedPositions(ds,cache,condition) {
    const {field,value} = condition;
    const keyFor = cache.types.get(field) === 'Number' ? Number : textKey;
    let buckets = cache.indexes.get(field);
    if (!buckets) {
      buckets = new Map();
      ds.docs.forEach((doc,position) => {
        const raw = valueFor(doc,field);
        if (blank(raw)) return;
        const key = keyFor(raw);
        if (!buckets.has(key)) buckets.set(key,[]);
        buckets.get(key).push(position);
      });
      cache.indexes.set(field,buckets);
    }
    return buckets.get(keyFor(value)) || [];
  }
  function rowCondition(types, condition, allowed) {
    const {field,op,value} = condition || {};
    if (!allowed.has(field)) throw new Error('Choose a configured filter field.');
    const get = doc => valueFor(doc,field);
    if (op === 'empty') return doc => blank(get(doc));
    if (op === 'not_empty') return doc => !blank(get(doc));
    if (blank(value)) throw new Error('Enter a value for ' + field + '.');
    if (op === 'contains') return doc => !blank(get(doc)) && textKey(get(doc)).includes(textKey(value));
    const type = types.get(field);
    if (type === 'Number' && (!numberPattern.test(String(value).trim()) || !Number.isFinite(Number(value)))) throw new Error('Enter a number for ' + field + '.');
    if (type === 'Date' && !isDate(String(value).trim())) throw new Error('Enter a valid YYYY-MM-DD date for ' + field + '.');
    const comparable = type === 'Number' ? Number : textKey;
    const target = comparable(value);
    const comparisons = {eq:v=>v===target,ne:v=>v!==target,gt:v=>v>target,gte:v=>v>=target,lt:v=>v<target,lte:v=>v<=target};
    if (!Object.hasOwn(comparisons,op) || type === 'Text' && !['eq','ne'].includes(op)) throw new Error('Choose a supported operator for ' + field + '.');
    return doc => !blank(get(doc)) && comparisons[op](comparable(get(doc)));
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
    Object.assign(detail,{layer:'DWD',upstreamId:upstream.id,grain:'One reign per ruler and country',
      domainId:upstream.domainId || '',subjectIds:[...(upstream.subjectIds || [])]});
    if (upstream.subjectId) detail.subjectId = upstream.subjectId; // The v1 upgrade creates this example before taxonomy migration.
    detail.docs = materialize(upstream, '');
    initializeRetrieval(detail);
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
  function domainSubject(domainId, subjectId) {
    const id = 'pair:' + encodeURIComponent(domainId) + ':' + encodeURIComponent(subjectId);
    return {id,domainId,subjectId,active:true};
  }
  function seed() {
    const stamp = now();
    const reigns = datasetRecord('reigns','Monarchs and reigns','register','public.reigns','warehouse');
    const missions = datasetRecord('missions','Mission reference','guides','mission-notes.html','library');
    const old = datasetRecord('early-names','Country names · prior edition','names','country_aliases.csv','warehouse');
    const datasets = [reigns,missions,old];
    for (const ds of datasets) {
      ds.docs = readDocuments(sourceFor(ds.sourceId),ds.asset);
      initializeRetrieval(ds);
    }
    Object.assign(reigns,{domainId:'governance',subjectIds:['monarchs']});
    reigns.schedule = window.DataSchedule.save(reigns.schedule,{type:'refresh',frequency:'Daily',time:'09:00',zone:'UTC',enabled:true},stamp);
    Object.assign(missions,{domainId:'gameplay',subjectIds:['missions-and-events']});
    Object.assign(old,{domainId:'governance',subjectIds:['monarchs']});
    old.archived = true;
    old.archivedAt = daysFrom(stamp,-8);
    const jobs = [
      {id:'J-1003',type:'refresh',datasetId:missions.id,sourceId:'guides',status:'Failed',createdAt:daysFrom(stamp,-1),detail:'The sample source timed out. The previous documents were retained. Retry to run the refresh again.'},
      {id:'J-1002',type:'refresh',datasetId:reigns.id,sourceId:'register',status:'Succeeded',createdAt:daysFrom(stamp,-1),detail:'Refreshed two structured reign records.'},
      {id:'J-1001',type:'sync',sourceId:'register',status:'Succeeded',createdAt:daysFrom(stamp,-2),detail:'Discovered public.reigns and synchronized its source inventory.'}
    ];
    addSampleDetail(datasets);
    return {datasets,jobs,storageLocations:storageLocations.map(storageProfile.upgrade),folders:initialFolders(datasets),layers:defaultLayers.map(layer => ({...layer})),
      domains:[
        {id:'governance',name:'Governance & succession',description:'How a country is governed and how its leadership changes.'},
        {id:'gameplay',name:'Game systems',description:'Rules that govern campaign objectives, events and their effects.'},
        {id:'diplomacy',name:'Diplomacy & subjects',description:'Relationships between countries, including alliances, unions and subject states.'}
      ],
      subjects:[
        {id:'monarchs',name:'Monarchs and reigns',description:'Monarchs, the countries they ruled and their periods of rule.'},
        {id:'missions-and-events',name:'Missions and events',description:'Campaign objectives and events, including their requirements, choices and rewards.'},
        {id:'dynastic-succession',name:'Dynastic succession',description:'How a crown passes between rulers and how its inheritance affects other countries.'}
      ],
      sourceDomainIds:{register:'governance',guides:'gameplay'},
      sourceSubjectIds:{register:['monarchs'],guides:['missions-and-events']},sourceOverrides:{},version:9};
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
  function migrateTaxonomy(data) {
    const validDomains = new Set(data.domains.map(domain => domain.id));
    const previousParent = new Map();
    for (const subject of data.subjects) {
      if (validDomains.has(subject.domainId)) previousParent.set(subject.id,domainSubject(subject.domainId,subject.id));
      delete subject.domainId;
    }
    data.domainSubjects = [...previousParent.values()];
    for (const dataset of data.datasets) {
      const pair = previousParent.get(dataset.subjectId);
      dataset.domainSubjectId = pair?.id || '';
    }
    data.sourceSubjects ||= {};
    data.sourceDomainSubjects = {};
    for (const [id,subjectId] of Object.entries(data.sourceSubjects)) {
      const pair = previousParent.get(subjectId);
      data.sourceDomainSubjects[id] = pair?.id || '';
    }
    data.version = 5;
  }
  function migrateIndependentClassification(data) {
    const pairs = new Map((data.domainSubjects || []).map(pair => [pair.id,pair]));
    function unpack(pairId,legacySubjectId) {
      // Retiring a pair never removed the existing asset assignments.
      const pair = pairs.get(pairId);
      const subjectId = pair?.subjectId || legacySubjectId;
      return {domainId:pair?.domainId || '',subjectIds:subjectId ? [subjectId] : []};
    }
    for (const ds of data.datasets) {
      Object.assign(ds,unpack(ds.domainSubjectId,ds.subjectId));
      delete ds.domainSubjectId;
      delete ds.subjectId;
    }
    data.sourceDomainIds = {};
    data.sourceSubjectIds = {};
    const sourcePairs = data.sourceDomainSubjects || {};
    const sourceSubjects = data.sourceSubjects || {};
    for (const id of new Set([...Object.keys(sourcePairs),...Object.keys(sourceSubjects)])) {
      const {domainId,subjectIds} = unpack(sourcePairs[id],sourceSubjects[id]);
      data.sourceDomainIds[id] = domainId;
      data.sourceSubjectIds[id] = subjectIds;
    }
    delete data.sourceDomainSubjects;
    delete data.sourceSubjects;
    delete data.domainSubjects;
    data.version = 9;
  }
  let memory;
  let lastReadValue;
  let persistent = true;
  function persist(data) {
    const raw = JSON.stringify(data);
    localStorage.setItem(key,raw);
    lastReadValue = raw;
  }
  function read(reuseUnchanged = false) {
    let upgraded = false;
    if (persistent) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          if (reuseUnchanged && memory && lastReadValue === raw) return memory;
          const data = JSON.parse(raw);
          if ([1,2,3,4,5,6,7,8,9].includes(data.version) && Array.isArray(data.datasets) && Array.isArray(data.jobs)) {
            if (data.version === 1) migrateWarehouse(data);
            if (data.version === 2) {
              data.folders = initialFolders(data.datasets);
              data.version = 3;
              upgraded = true;
            }
            if (data.version === 3) {
              data.datasets.forEach(initializeRetrieval);
              data.version = 4;
              upgraded = true;
            }
            if (data.version === 4) {
              migrateTaxonomy(data);
              upgraded = true;
            }
            if (data.version === 5) {
              for (const ds of data.datasets) if (ds.dataType === 'table') ds.lookup.indexedFields ??= [];
              data.version = 6;
              upgraded = true;
            }
            if (data.version === 6) {
              data.storageLocations ??= storageLocations.map(s => ({...s}));
              for (const s of data.storageLocations) {
                s.type ??= 'folder';
                s.locator ??= 'workspace/' + encodeURIComponent(s.id);
              }
              data.version = 7;
              upgraded = true;
            }
            if (data.version === 7) {
              data.storageLocations = (data.storageLocations || storageLocations).map(storageProfile.upgrade);
              data.version = 8;
              upgraded = true;
            }
            if (data.version === 8) {
              migrateIndependentClassification(data);
              upgraded = true;
            }
            for (const entry of [...data.domains,...data.subjects]) {
              if (entry.description == null) {
                entry.description = '';
                upgraded = true;
              }
            }
            memory = data;
            lastReadValue = raw;
          }
        }
      } catch { persistent = false; notify('Browser storage is unavailable. Data changes will last for this session.'); }
    }
    if (!memory || upgraded) {
      if (!memory) memory = seed();
      if (persistent) {
        try { persist(memory); }
        catch { persistent = false; notify('Sample data could only be opened for this session.'); }
      }
    }
    return memory;
  }
  function commit(fn) {
    const data = read();
    const result = fn(data);
    if (persistent) {
      try { persist(data); }
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
  function taxonomyDescription(value, previous = '') {
    if (value === undefined) return previous;
    if (typeof value !== 'string' || value.trim().length > 500) throw new Error('Enter a description of up to 500 characters.');
    return value.trim();
  }
  function expectClassification(current,expected,name) {
    const matches = Array.isArray(current)
      ? Array.isArray(expected) && current.length === expected.length && current.every(id => expected.includes(id))
      : current === expected;
    if (!matches) throw new Error('The classification of “' + name + '” changed. Reopen the picker to review it.');
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
        tableCaches.delete(ds.docs);
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
      build(ds,now());
      detail = 'Published ' + ds.snapshotDocs.length + ' included document(s) to the searchable index.';
    } else if (['ingest','refresh'].includes(type)) {
      const isDetail = layerFor(data,ds.layer).kind === 'detail';
      const upstream = isDetail && data.datasets.find(item => item.id === ds.upstreamId);
      const docs = isDetail ? materialize(upstream, ds.keyField) : readDocuments(existing(sources,ds.sourceId,'source'),ds.asset);
      const selection = new Map(ds.docs.map(d => [d.id,d.included]));
      ds.docs = docs.map(d => ({...d,included:selection.get(d.id) ?? true}));
      if (ds.dataType === 'table') {
        const fields = new Set(fieldsForRecord(ds));
        for (const setting of ['filterFields','returnFields','indexedFields']) {
          ds.lookup[setting] = ds.lookup[setting].filter(field => fields.has(field));
        }
      }
      updateIndexStatus(ds);
      detail = isDetail ? 'Materialized ' + docs.length + ' detail row(s) from ' + upstream.name + '.' :
        (type === 'ingest' ? 'Ingested ' : 'Refreshed ') + ds.docs.length +
          (ds.dataType === 'table' ? ' row(s) from ' : ' document(s) from ') + ds.asset + '.';
    } else throw new Error('Unknown dataset job.');
    return log(data,{type,datasetId:id,sourceId:ds.sourceId,detail,...extra});
  }
  function runSource(data,id,type,extra={}) {
    const s = existing(sources,id,'source');
    if (!['test','sync'].includes(type)) throw new Error('Unknown connection operation.');
    const profile = window.SourceProfile;
    if (profile && s.kind === 'database') profile.connection(profile.databaseSettings(s));
    if (profile && type === 'sync' && (s.kind === 'database' || s.folderPolicy)) {
      const assets = profile.publicRecord({assets:profile.syncedAssets(s)}).assets;
      const first = assets[0] || {object:'',fields:[],rows:[]};
      const inventory = {assets,object:first.object,fields:first.fields,rows:first.rows};
      Object.assign(s,inventory);
      data.sourceOverrides[id] = {...data.sourceOverrides[id],...inventory};
    }
    const detail = type === 'test' ? 'Local simulation passed. No external connection was opened.' :
      'Synchronized the local sample catalog: ' + (s.assets || [s]).length + ' asset(s).';
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
  function runBatch(ids,type) {
    if (!['refresh','ingest','rebuild'].includes(type)) throw new Error('Choose a supported dataset operation.');
    return commit(data => {
      const selection = selectedDatasets(data,ids);
      if (type === 'rebuild' && selection.every(ds => ds.dataType === 'table')) {
        throw new Error('Select at least one document dataset to rebuild its index.');
      }
      const byId = new Map(selection.map(ds => [ds.id,ds]));
      const ordered = new Map(), visiting = new Set();
      function visit(ds) {
        if (ordered.has(ds.id)) return;
        if (visiting.has(ds.id)) throw new Error('A dependency cycle prevents this batch from running.');
        visiting.add(ds.id);
        if (type !== 'rebuild' && byId.has(ds.upstreamId)) visit(byId.get(ds.upstreamId));
        visiting.delete(ds.id);
        ordered.set(ds.id,ds);
      }
      selection.forEach(visit);
      const results = new Map();
      const batchId = newId('batch');
      for (const ds of ordered.values()) {
        const extra = {trigger:'Batch',batchId};
        const upstreamRun = results.get(ds.upstreamId);
        let outcome = 'Succeeded', detail, jobId;
        if (type === 'rebuild' && ds.dataType === 'table') {
          outcome = 'Skipped';
          detail = 'Structured tables use direct lookup and have no document index.';
        } else if (type !== 'rebuild' && upstreamRun && upstreamRun.status !== 'Succeeded') {
          outcome = 'Skipped';
          detail = 'Upstream task ' + upstreamRun.jobId + ' did not succeed. Previous records were kept.';
        } else {
          try {
            jobId = runDataset(data,ds.id,type,extra);
            detail = data.jobs[0].detail;
          } catch (error) {
            outcome = 'Failed';
            detail = error.message || 'The dataset operation failed.';
          }
        }
        if (!jobId) jobId = log(data,{type,status:outcome,datasetId:ds.id,sourceId:ds.sourceId,detail,...extra});
        results.set(ds.id,{datasetId:ds.id,name:ds.name,jobId,status:outcome,detail});
      }
      return {batchId,results:[...results.values()]};
    });
  }
  function exportRecordSet(ds) {
    return {datasetId:ds.id,name:ds.name,layer:ds.layer,grain:ds.grain || null,
      sourceId:ds.sourceId,sourceAsset:ds.asset,upstreamId:ds.upstreamId || null,
      records:ds.docs.map(doc => {
        const record = {values:doc.values || {},sourceLocator:doc.locator ?? null};
        if (ds.dataType === 'document' || !Object.keys(record.values).length) {
          Object.assign(record,{id:doc.id,title:doc.title,text:doc.text});
        }
        return record;
      })
    };
  }
  const api = {
    snapshot:read,
    storageTypes:storageProfile.types,
    testStorage:storageProfile.test,
    addStorage(input) {
      return commit(data => {
        const name = named(input.name,'storage name');
        unique(data.storageLocations,name);
        const entry = {id:newId('storage'),name,...storageProfile.normalize(input),detail:String(input.detail ?? '').trim()};
        data.storageLocations.push(entry);
        return entry.id;
      });
    },
    updateStorage(id,patch) {
      return commit(data => {
        const entry = existing(data.storageLocations,id,'storage location');
        const name = named(patch.name ?? entry.name,'storage name');
        unique(data.storageLocations,name,id);
        const target = storageProfile.revise(entry,patch);
        if (!storageProfile.sameTarget(entry,target)) {
          const usage = storageUse(data,id);
          if (usage) throw new Error(usage + ' Reassign them before changing the target.');
        }
        Object.assign(entry,target,{name,detail:String(patch.detail ?? entry.detail ?? '').trim()});
        return id;
      });
    },
    removeStorage(id) {
      return commit(data => {
        existing(data.storageLocations,id,'storage location');
        const usage = storageUse(data,id);
        if (usage) throw new Error(usage + ' Reassign them before deleting the storage.');
        data.storageLocations = data.storageLocations.filter(s => s.id !== id);
      });
    },
    runBatch,
    previewMetadata(id) {
      const data = read(true);
      const ds = data.datasets.find(item => item.id === id);
      if (!ds) return null;
      const {name,layer,dataType,indexStatus,archived,sourceId,asset,upstreamId} = ds;
      const source = sourceFor(sourceId);
      const fields = sourceAsset(sourceId,asset)?.fields || [];
      const lookup = ds.dataType === 'table' ? {filterFields:[...ds.lookup.filterFields],
        returnFields:[...ds.lookup.returnFields],indexedFields:[...ds.lookup.indexedFields]} : undefined;
      return {folders:data.folders,datasets:[{id,name,layer,dataType,indexStatus,archived,sourceId,asset,upstreamId,
        sourceName:source?.name || sourceId,fields,lookup,recordCount:ds.docs.length}]};
    },
    previewPage(id,requested = 1) {
      const ds = existing(read(true).datasets,id,'dataset');
      const pageSize = 15;
      const count = ds.docs.length;
      const pageCount = Math.max(1,Math.ceil(count / pageSize));
      const page = Math.max(1,Math.min(Number.isSafeInteger(requested) ? requested : 1,pageCount));
      const offset = (page-1)*pageSize;
      return {page,pageCount,offset,count,records:ds.docs.slice(offset,offset+pageSize)};
    },
    exportRecords(id) {
      return exportRecordSet(active(read(true),id));
    },
    exportBatch(ids) {
      const data = read(true);
      const selected = selectedDatasets(data,ids);
      const datasets = selected.map(ds => {
        const item = exportRecordSet(ds);
        return {...item,dataType:ds.dataType,recordCount:ds.docs.length,sourceName:sourceFor(ds.sourceId)?.name || ds.sourceId,
          folderId:ds.folderId || null,storage:ds.storage,fields:fieldsForRecord(ds)};
      });
      return {formatVersion:1,exportedAt:now(),datasetCount:datasets.length,datasets};
    },
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
    fieldTypesFor(id) {
      const ds = existing(read(true).datasets,id,'dataset');
      return Object.fromEntries(tableCache(ds).types);
    },
    setLookupFields(id,patch) {
      return commit(data => {
        const ds = active(data,id);
        if (ds.dataType !== 'table') throw new Error('Field selection is available for structured tables.');
        const fields = new Set(fieldsForRecord(ds));
        const {filterFields=ds.lookup.filterFields,returnFields=ds.lookup.returnFields} = patch;
        for (const list of [filterFields,returnFields]) {
          if (!Array.isArray(list) || list.some(field => !fields.has(field))) throw new Error('Choose fields from this table.');
        }
        if (!returnFields.length) throw new Error('Select at least one return field.');
        const filtering = new Set(filterFields);
        const indexed = patch.indexedFields ?? ds.lookup.indexedFields.filter(field => filtering.has(field));
        if (!Array.isArray(indexed) || indexed.some(field => !filtering.has(field))) throw new Error('Enable filtering on each indexed field.');
        ds.lookup = {filterFields:[...filtering],returnFields:[...new Set(returnFields)],indexedFields:[...new Set(indexed)]};
        tableCaches.delete(ds.docs);
      });
    },
    queryRows(id,conditions=[],limit=20,offset=0) {
      const ds = existing(read(true).datasets,id,'dataset');
      if (ds.archived) throw new Error('Restore this table before running a query.');
      if (ds.dataType !== 'table') throw new Error('Structured conditions apply only to tables.');
      if (!Array.isArray(conditions)) throw new Error('Supply a list of query conditions.');
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Use a row limit between 1 and 100.');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Use a nonnegative row offset.');
      const cache = tableCache(ds);
      const fields = ds.lookup.returnFields.filter(field => cache.types.has(field));
      if (!fields.length) throw new Error('Select at least one available return field.');
      const allowed = new Set(ds.lookup.filterFields.filter(field => cache.types.has(field)));
      const predicates = conditions.map(condition => rowCondition(cache.types,condition,allowed));
      const indexed = conditions.find(c => c.op === 'eq' && ds.lookup.indexedFields.includes(c.field));
      const positions = indexed ? indexedPositions(ds,cache,indexed) : null;
      const examinedRows = positions ? positions.length : ds.docs.length;
      const rows = [];
      let total = 0;
      for (let i=0;i<examinedRows;i++) {
        const doc = ds.docs[positions ? positions[i] : i];
        if (!predicates.every(matches => matches(doc))) continue;
        if (total >= offset && rows.length < limit) rows.push({id:doc.id,locator:doc.locator,
          values:Object.fromEntries(fields.map(field => [field,valueFor(doc,field)]))});
        total++;
      }
      return {fields,rows,total,offset,usedIndexes:indexed ? [indexed.field] : [],examinedRows};
    },
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
    databaseImportInventory(sourceId) {
      const source = existing(sources,sourceId,'source');
      if (source.kind !== 'database') throw new Error('Choose a database connection.');
      const imported = new Map(read(true).datasets.filter(ds => ds.sourceId === sourceId && !ds.upstreamId).map(ds => [ds.asset,ds]));
      return (source.assets || [source]).map(asset => {
        const ds = imported.get(asset.object);
        return {object:asset.object,fields:[...asset.fields],rowCount:asset.rows.length,
          datasetId:ds?.id || null,datasetName:ds?.name || '',archived:Boolean(ds?.archived)};
      });
    },
    async importDatabaseTables({sourceId,assets,layer='ODS',storage,folderId=null}) {
      function importBatch() {
        return commit(data => {
          const source = existing(sources,sourceId,'source');
          if (source.kind !== 'database') throw new Error('Choose a database connection.');
          if (layerFor(data,layer).kind !== 'raw') throw new Error('Choose a raw warehouse layer for database imports.');
          existing(data.storageLocations,storage,'storage location');
          const destination = folderReference(data,folderId);
          if (!Array.isArray(assets) || !assets.length) throw new Error('Select at least one table to import.');
          if (new Set(assets).size !== assets.length) throw new Error('Select each table only once.');
          const imported = new Set(data.datasets.filter(ds => ds.sourceId === sourceId && !ds.upstreamId).map(ds => ds.asset));
          const names = new Set(data.datasets.map(ds => ds.name.toLowerCase()));
          // Stage new datasets and jobs together. A failure leaves both original lists intact.
          const staged = {...data,datasets:[...data.datasets],jobs:[...data.jobs]};
          const result = [];
          for (const object of assets) {
            if (imported.has(object)) throw new Error(object + ' has already been imported from this connection.');
            if (!sourceAsset(sourceId,object)) throw new Error('This table is unavailable: ' + object + '.');
            let name = object;
            if (names.has(name.toLowerCase())) {
              const qualified = source.name + ' / ' + object;
              name = qualified;
              for (let suffix=2;names.has(name.toLowerCase());suffix++) name = qualified + ' (' + suffix + ')';
            }
            names.add(name.toLowerCase());
            const ds = datasetRecord(newId('dataset'),name,sourceId,object,storage);
            Object.assign(ds,{layer,folderId:destination});
            initializeRetrieval(ds);
            staged.datasets.unshift(ds);
            const jobId = runDataset(staged,ds.id,'ingest');
            result.push({datasetId:ds.id,name,object,rowCount:ds.docs.length,jobId});
          }
          data.datasets = staged.datasets;
          data.jobs = staged.jobs;
          return result;
        });
      }
      const locks = globalThis.navigator?.locks;
      if (!locks) return importBatch();
      return locks.request('ai-center-import-database-tables',{ifAvailable:true},async lock => {
        if (!lock) throw new Error('Another database import is running. Retry after it finishes.');
        const result = importBatch();
        // Release after the writing task ends so other tabs can observe the storage change.
        await new Promise(resolve => setTimeout(resolve,0));
        return result;
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
        initializeRetrieval(ds);
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
        if (ds.dataType === 'table') throw new Error('The table lookup uses all materialized rows.');
        const selected = new Set(selectedIds);
        ds.docs.forEach(d => {d.included = selected.has(d.id);});
        updateIndexStatus(ds);
      });
    },
    setConfig(id,patch) {
      return commit(data => {
        const ds = active(data,id);
        if (ds.dataType === 'table') throw new Error('Configure filter and return fields for a structured table.');
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
        if (ds.dataType === 'table' && options.type === 'rebuild') throw new Error('Schedule a table refresh or ingestion.');
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
      if (!ds || ds.dataType === 'table' || ds.archived || !ds.buildSignature) return [];
      const terms = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
      return ds.snapshotDocs.map(doc => {
        const text = (doc.title + ' ' + doc.text).toLowerCase();
        return {doc,score:terms.filter(t => text.includes(t)).length};
      }).filter(hit => hit.score).sort((a,b) => b.score-a.score).slice(0,ds.config.topK).map(hit => hit.doc);
    },
    saveDomain(input) {
      return commit(data => {
        const name = named(input.name,'domain name');
        const domain = input.id ? existing(data.domains,input.id,'domain') : null;
        const description = taxonomyDescription(input.description,domain?.description);
        unique(data.domains,name,input.id);
        if (domain) { Object.assign(domain,{name,description}); return domain.id; }
        const id = newId('domain');
        data.domains.push({id,name,description});
        return id;
      });
    },
    saveSubject(input) {
      return commit(data => {
        const name = named(input.name,'subject area name');
        const subject = input.id ? existing(data.subjects,input.id,'subject area') : null;
        const description = taxonomyDescription(input.description,subject?.description);
        // Legacy subjects in different domains may already share a display name.
        if (!subject || subject.name.toLowerCase() !== name.toLowerCase()) unique(data.subjects,name,input.id);
        const id = subject?.id || newId('subject');
        if (subject) Object.assign(subject,{name,description});
        else data.subjects.push({id,name,description});
        return id;
      });
    },
    setAssetClassification(kind,id,patch,expected) {
      return commit(data => {
        if (kind !== 'dataset' && kind !== 'source') throw new Error('Unknown asset type.');
        const ds = kind === 'dataset' ? active(data,id) : null;
        const asset = ds || existing(sources,id,'source');
        if (asset.archived) throw new Error('Restore this asset before changing its classification.');
        const settings = {};
        if (Object.hasOwn(patch,'domainId')) {
          if (expected) expectClassification(ds ? ds.domainId : data.sourceDomainIds[id] || '',expected.domainId,asset.name);
          settings.domainId = patch.domainId === '' ? '' : existing(data.domains,patch.domainId,'domain').id;
        }
        if (Object.hasOwn(patch,'subjectIds')) {
          if (expected) expectClassification(ds ? ds.subjectIds : data.sourceSubjectIds[id] || [],expected.subjectIds,asset.name);
          if (!Array.isArray(patch.subjectIds)) throw new Error('Select subjects from the list.');
          const ids = [...new Set(patch.subjectIds)];
          for (const subjectId of ids) existing(data.subjects,subjectId,'subject');
          settings.subjectIds = ids;
        }
        if (ds) Object.assign(ds,settings);
        else {
          if (Object.hasOwn(settings,'domainId')) data.sourceDomainIds[id] = settings.domainId;
          if (Object.hasOwn(settings,'subjectIds')) data.sourceSubjectIds[id] = settings.subjectIds;
        }
      });
    },
    classifyDatasets(ids,kind,definitionId,expected) {
      return commit(data => {
        if (kind !== 'domain' && kind !== 'subject') throw new Error('Choose a domain or a subject.');
        const isDomain = kind === 'domain';
        existing(isDomain ? data.domains : data.subjects,definitionId,kind);
        const selection = selectedDatasets(data,ids);
        if (expected) for (const ds of selection) {
          expectClassification(isDomain ? ds.domainId : ds.subjectIds,expected[ds.id],ds.name);
        }
        const changed = selection.filter(ds => isDomain ? ds.domainId !== definitionId : !ds.subjectIds.includes(definitionId));
        for (const ds of changed) {
          if (isDomain) ds.domainId = definitionId;
          else ds.subjectIds.push(definitionId);
        }
        return changed.length;
      });
    },
    editSource(id,input) {
      return commit(data => {
        const source = existing(sources,id,'source');
        const base = {name:named(input.name,'source name'),loc:named(input.loc,'location'),credential:named(input.credential,'credential alias')};
        const patch = window.SourceProfile && input.kind === source.kind ? window.SourceProfile.publicRecord({...input,...base}) : base;
        delete patch.id;
        if (source.kind === 'url' && !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(patch.loc)) throw new Error('Enter an HTTP or HTTPS address.');
        if (patch.assets) {
          const needed = data.datasets.find(ds => ds.sourceId === id && !ds.upstreamId && !patch.assets.some(a => a.object === ds.asset));
          if (needed) throw new Error('Dataset “'+needed.name+'” uses '+needed.asset+'. Keep this asset available or register the new connection separately.');
        }
        Object.assign(source,patch);
        data.sourceOverrides[id] = {...data.sourceOverrides[id],...patch};
        if (input.kind === 'database') runSource(data,id,'test');
      });
    }
  };
  const state = read();
  for (const s of sources) if (Object.hasOwn(state.sourceOverrides,s.id)) {
    const patch = state.sourceOverrides[s.id];
    // Older edits stored only a display address. Reconstruct its engine settings when opening the source.
    if (s.kind === 'database' && patch.loc && !patch.connection) delete s.connection;
    Object.assign(s,patch);
  }
  return api;
};
