const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

function openStore(snapshot, names = new Map()) {
  let saved = snapshot && JSON.stringify(snapshot);
  const localStorage = {getItem:() => saved || null,setItem:(_key,value) => {saved = value;}};
  const context = vm.createContext({window:{},localStorage,URL});
  for (const name of ['storage-profile.js','schedule.js','store.js']) {
    const file = path.join(__dirname,'../ai-center-frontend/data-menu',name);
    vm.runInContext(readFileSync(file,'utf8'),context,{filename:file});
  }
  const sources = [];
  const store = context.window.createDataMenuStore(sources,assert.fail,names);
  return {sources,store,snapshot:() => JSON.parse(saved)};
}

test('empty source catalog permits existing dataset demos and creates no source fixtures', () => {
  const {sources,store,snapshot} = openStore();
  assert.deepEqual(sources,[]);
  assert.equal(store.previewPage('reigns').records.length,2);
  assert.equal(store.previewPage('missions',2).records.length,3);
  assert.equal(store.previewMetadata('reign-detail').datasets[0].sourceName,'Reign register');
  assert.ok(snapshot().jobs.every(job => job.datasetId));
});

test('upgrading keeps stored records and lineage names, and clears simulated connection data and source runs', () => {
  const old = openStore().snapshot();
  old.version = 9;
  const raw = old.datasets.find(ds => ds.id === 'reigns');
  const custom = {...raw,id:'user-dataset',sourceId:'local-original'};
  old.datasets.push(custom);
  for (const dataset of old.datasets) delete dataset.sourceName;
  old.sourceOverrides = {register:{name:'Edited register',loc:'retired-host',assets:[]}};
  old.sourceDomainIds.register = 'governance';
  old.jobs.push({id:'J-1001',type:'sync',sourceId:'register'});
  const {sources,store,snapshot} = openStore(old,new Map([['local-original','User connection']]));
  assert.deepEqual(sources,[]);
  const migrated = snapshot();
  assert.equal(migrated.version,10);
  assert.equal(migrated.sourceOverrides,undefined);
  assert.ok(!JSON.stringify(migrated).includes('retired-host'));
  assert.deepEqual(migrated.sourceDomainIds,{});
  assert.ok(migrated.jobs.every(job => job.datasetId));
  assert.equal(store.previewMetadata('reigns').datasets[0].sourceName,'Edited register');
  assert.equal(store.previewMetadata('user-dataset').datasets[0].sourceName,'User connection');
  assert.deepEqual(migrated.datasets.find(ds => ds.id === custom.id).docs,custom.docs);
  assert.deepEqual(openStore(migrated).snapshot(),migrated);
});
