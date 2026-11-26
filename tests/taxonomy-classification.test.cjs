const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

function legacyWorkspace() {
  const legacy = {
    version:7, storageLocations:[], jobs:[], sourceOverrides:{},
    domains:[{id:'government',name:'Government'},{id:'diplomacy',name:'Diplomacy'}],
    subjects:[{id:'reigns',name:'Reigns'},{id:'unions',name:'Unions'}],
    domainSubjects:[{id:'old',domainId:'government',subjectId:'reigns',active:false}],
    datasets:[
      {id:'tagged',name:'Reign register',domainSubjectId:'old',subjectId:'reigns'},
      {id:'blank',name:'Diplomatic records',domainSubjectId:'',subjectId:''},
      {id:'archive',name:'Earlier edition',domainSubjectId:'old',subjectId:'reigns',archived:true}
    ],
    sourceDomainSubjects:{register:'old'},sourceSubjects:{register:'reigns'}
  };
  const key = 'ai-center.data-menu.v1';
  const saved = new Map([[key,JSON.stringify(legacy)]]);
  const localStorage = {getItem:id => saved.get(id) ?? null,setItem:(id,value) => saved.set(id,value)};
  const context = vm.createContext({window:{},localStorage,URL});
  for (const filename of ['storage-profile.js','store.js']) {
    const file = path.join(__dirname,'../ai-center-frontend/data-menu',filename);
    vm.runInContext(readFileSync(file,'utf8'),context,{filename:file});
  }
  const open = () => context.window.createDataMenuStore([{id:'register',name:'Register'}],assert.fail);
  return {store:open(),open,read:() => JSON.parse(saved.get(key))};
}

test('migration converts retired assignments on sources and archived datasets and leaves unassigned assets empty', () => {
  const {open,read} = legacyWorkspace();
  const migrated = read();
  assert.deepEqual(migrated.datasets.map(d => [d.domainId,d.subjectIds]),[
    ['government',['reigns']],['',[]],['government',['reigns']]
  ]);
  assert.equal(migrated.sourceDomainIds.register,'government');
  assert.deepEqual(migrated.sourceSubjectIds.register,['reigns']);
  assert.equal(migrated.domainSubjects,undefined);
  open();
  assert.deepEqual(read(),migrated);
});

test('a subject can be assigned before a domain, combined with another and kept when changing the domain', () => {
  const {store,read} = legacyWorkspace();
  const record = () => read().datasets.find(d => d.id === 'blank');
  store.setAssetClassification('dataset','blank',{subjectIds:['reigns']},{subjectIds:[]});
  assert.equal(record().domainId,'');
  store.classifyDatasets(['blank'],'subject','unions',{blank:['reigns']});
  assert.equal(store.classifyDatasets(['blank'],'subject','unions'),0);
  store.setAssetClassification('dataset','blank',{domainId:'diplomacy'},{domainId:''});
  assert.deepEqual(record().subjectIds,['reigns','unions']);
  store.setAssetClassification('dataset','blank',{domainId:''});
  assert.deepEqual(record().subjectIds,['reigns','unions']);
  store.setAssetClassification('source','register',{subjectIds:[]});
  assert.equal(read().sourceDomainIds.register,'government');
});

test('a stale subject selection or archived member prevents partial bulk changes', () => {
  const {store,read} = legacyWorkspace();
  const before = read();
  assert.throws(() => store.classifyDatasets(['blank','tagged'],'subject','unions',{blank:[],tagged:[]}));
  assert.throws(() => store.classifyDatasets(['blank','archive'],'domain','diplomacy'));
  assert.deepEqual(read(),before);
});
