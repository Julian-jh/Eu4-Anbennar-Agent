const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

function openWorkspace(storageLocations = [], datasets = []) {
  const key = 'ai-center.data-menu.v1';
  const saved = new Map([[key, JSON.stringify({
    version:7, storageLocations, datasets, jobs:[], domains:[], subjects:[], sourceOverrides:{}
  })]]);
  const localStorage = {getItem:id => saved.get(id) ?? null, setItem:(id,value) => saved.set(id,value)};
  const context = vm.createContext({window:{}, URL, localStorage});
  for (const file of ['storage-profile.js','store.js']) {
    const filename = path.join(__dirname,'../ai-center-frontend/data-menu',file);
    vm.runInContext(readFileSync(filename,'utf8'),context,{filename});
  }
  return {store:context.window.createDataMenuStore([],assert.fail), persisted:() => saved.get(key)};
}

test('a stored v7 PostgreSQL destination opens as fields and keeps its archived dataset reference', () => {
  const locator = 'postgresql://[::1]/eu4%20history/raw%20data';
  const legacy = {id:'archive',name:'Archive',type:'postgresql',locator,detail:''};
  const {store} = openWorkspace([legacy],[{id:'countries',storage:'archive',archived:true}]);
  const record = () => store.snapshot().storageLocations[0];
  const {connection} = record();
  assert.equal(connection.database,'eu4 history');
  assert.equal(connection.schema,'raw data');
  assert.equal(Number(connection.port),5432);
  assert.equal(connection.username,'');
  store.updateStorage('archive',{connection:{...connection,username:'historian'}});
  assert.equal(record().connection.username,'historian');
  assert.equal(record().locator,locator);
  assert.throws(() => store.updateStorage('archive',{connection:{...connection,schema:'other'}}));
  assert.equal(record().connection.schema,'raw data');
  assert.equal(store.snapshot().datasets[0].storage,'archive');
});

test('testing and saving a PostgreSQL profile never returns or persists the supplied password', () => {
  const {store,persisted} = openWorkspace();
  const password = 'transient-test-value';
  const connection = {host:'localhost',port:'5433',database:'eu4',schema:'history',username:'writer',password};
  const input = {name:'Mod history',type:'postgresql',connection,password};
  const before = persisted();
  const tested = store.testStorage(input);
  assert.ok(tested.simulated);
  assert.ok(!JSON.stringify(tested).includes(password));
  assert.equal(persisted(),before);
  store.addStorage(input);
  const record = JSON.parse(persisted()).storageLocations[0];
  assert.equal(record.connection.username,'writer');
  assert.equal(record.locator,'postgresql://localhost:5433/eu4/history');
  assert.ok(!persisted().includes(password));
  assert.throws(() => store.testStorage({...input,connection:{...connection,port:'65536'}}));
});

test('folder paths and S3 key prefixes keep their type-specific meaning', () => {
  const {store} = openWorkspace();
  const folder = 'D:/Eu4&Anbennar Agent/data';
  assert.equal(store.testStorage({type:'folder',connection:{path:folder}}).locator,folder);
  const s3 = {type:'s3',connection:{bucket:'mod-archive',prefix:'eu4/history/'}};
  store.addStorage({name:'Archived tables',...s3});
  const record = store.snapshot().storageLocations[0];
  assert.equal(record.locator,'s3://mod-archive/eu4/history/');
  assert.equal(record.connection.prefix,'eu4/history/');
  assert.throws(() => store.testStorage({...s3,connection:{bucket:'s3://mod-archive',prefix:''}}));
});

test('an in-use legacy folder can be renamed without rewriting its path', () => {
  const legacy = {id:'old',name:'Old folder',type:'folder',locator:'../archive',detail:''};
  const {store} = openWorkspace([legacy],[{id:'old-reigns',storage:'old',archived:true}]);
  const connection = store.snapshot().storageLocations[0].connection;
  assert.throws(() => store.testStorage({type:'folder',connection}));
  store.updateStorage('old',{name:'Prior editions',type:'folder',connection});
  const updated = store.snapshot().storageLocations[0];
  assert.equal(updated.name,'Prior editions');
  assert.equal(updated.locator,'../archive');
});
