(() => {
  const root = document.getElementById('ac-workbench');
  if (!root) return;
  const $ = (id) => root.querySelector('#ac-' + id);
  const all = (selector) => Array.from(root.querySelectorAll(selector));
  const symbols = {'database':'▤','git-fork':'⑂','sliders-horizontal':'☷','activity':'∿','cable':'⇄','settings':'⚙︎'};
  all('.ac-icon i').forEach(icon => {icon.dataset.fallback = symbols[icon.dataset.lucide] || '';});
  const navigation = {
    data: [['catalog','Sources','sources'],['datasets','Datasets','lifecycle'],['jobs','Jobs','lifecycle'],['taxonomy','Taxonomy','lifecycle'],['archive','Archive','lifecycle']],
    semantic: [['overview','Model overview','semantic'],['mappings','Field mappings','semantic'],['validation','Validation','semantic']],
    ai: [['configuration','Assistant configuration','assistant'],['release','Test & release','assistant'],['runs','Runs','runs'],['performance','Performance','runs'],['evaluations','Evaluations','runs']],
    api: [['connectors','Connected services','api'],['published','Published APIs','api']],
    settings: [['defaults','Workspace defaults','settings'],['roles','Roles & permissions','settings']]
  };
  const routes = new Map();
  for (const [area, sections] of Object.entries(navigation)) {
    for (const [view, label, page] of sections) {
      routes.set(view, {area, label, page});
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ac-subnav';
      button.dataset.section = view;
      button.textContent = label;
      button.setAttribute('aria-label',label);
      $('sections').append(button);
    }
  }
  routes.set('connection',{area:'data',label:'Connection',page:'sources'});
  routes.set('preview',{area:'data',label:'Asset preview',page:'sources'});
  const kinds = {
    database:['Database address','DB'], url:['Endpoint URL','API'],
    file:['File name','FILE'], folder:['Folder path','DIR']
  };
  const corpora = ['EU4','Anbennar','Real History'];
  const sources = [
    {id:'register',name:'Reign register',kind:'database',format:'PostgreSQL',access:'Read only',loc:'archive.example.test:5432/atlas',object:'public.reigns',credential:'atlas-reader',fields:['country_tag','ruler_name','start_date','end_date','end_status'],rows:[['FRA','Charles VII','1422-10-21','1461-07-22','dated'],['FRA','Louis XI','1461-07-22','1483-08-30','dated']]},
    {id:'directory',name:'Country directory',kind:'url',format:'REST / JSON',access:'Read only',loc:'https://directory.example.test/countries',object:'GET /countries/{tag}',credential:'directory-reader',fields:['country_tag','display_name'],rows:[['FRA','France'],['ENG','England']]},
    {id:'names',name:'Country aliases',kind:'file',format:'CSV',access:'Snapshot',loc:'samples/country_aliases.csv',object:'country_aliases.csv',credential:'Workspace file access',fields:['country_tag','alias','language'],rows:[['FRA','France','en'],['FRA','法国','zh']]},
    {id:'folder',name:'Country script archive',kind:'folder',format:'Folder',dataType:'table',access:'Snapshot',loc:'samples/history/countries',object:'*.txt',credential:'Workspace folder access',fields:['file_name','country_tag'],rows:[['FRA - France.txt','FRA'],['ENG - England.txt','ENG']]}
  ];
  sources.forEach((source,index) => {source.corpus = ['Real History','EU4','Real History','Anbennar'][index];});
  sources.push({id:'guides',name:'Anbennar mission notes',kind:'url',format:'HTML',access:'Read only',corpus:'Anbennar',loc:'https://library.example.test/anbennar/missions',object:'mission-notes.html',credential:'Public sample',fields:['title','excerpt'],
    rows:[['Mission prerequisites','Worked example of a mission requiring an earlier mission to be complete.'],['Event rewards','Worked example of an event granting a reward after mission completion.']]});
  const builtInIds = new Set(sources.map(source => source.id));
  const fields = [['country_tag','Country.tag','Text'],['ruler_name','Ruler.name','Text'],['start_date','Reign.start','Date · inclusive'],['end_date','Reign.end','Date · exclusive'],['end_status','Reign.endStatus','Dated / open / unknown']];
  const roles = [['Project admins','Project','EU4 & Anbennar','Manage resources and releases'],['History analysts','Dataset','Reign register','Preview and query rows'],['Research readers','Assistant','Historical rulers','Invoke published release'],['Evaluation team','Assistant','Historical rulers','View runs and evaluations']];
  const permissions = {Project:['Manage resources and releases','View project','No access'],Dataset:['Preview and query rows','View metadata only','No access'],Assistant:['Invoke published release','View runs and evaluations','No access']};
  const runs = [
    {id:'R-104',v:3,question:'Who ruled France on 11 November 1444?',status:'Completed',latency:'1.4 s',cost:'$0.004',steps:['Resolved country France to FRA and parsed the date.','Queried Country reigns v2 with the caller’s dataset grant.','Returned Charles VII with the Reign register citation.']},
    {id:'R-103',v:3,question:'Who ruled France?',status:'Clarification',latency:'0.6 s',cost:'$0.002',steps:['Resolved country France to FRA.','Detected a missing date.','Asked for the date before querying the register.']},
    {id:'R-102',v:2,question:'Who ruled France on 22 July 1461?',status:'Failed evaluation',latency:'1.2 s',cost:'$0.003',steps:['Resolved France and the boundary date.','Applied an inclusive reign end and matched overlapping rows.','Returned Charles VII. The reference answer was Louis XI.']}
  ];
  const exampleRunIds = new Set(runs.map(run => run.id));
  const storageKey = 'ai-center.workbench.v1';
  const state = {
    view:'catalog', source:'register', asset:'', filter:'all', corpus:'', search:'', entity:'All entities', scope:'All scopes',
    suite:'dated', activeRun:'', live:3, draft:4, tested:false, alias:'Sovereign', principal:1,
    date:'1444-11-11', validation:'', lastTest:'', result:'The current draft is ready to test.', defaultCorpus:'Real History',
    model:'Research standard', authorized:'Country reigns v2', lookup:true, cite:true,
    publishedConfig:{model:'Research standard',authorized:'Country reigns v2',lookup:true,cite:true}
  };
  let storageAvailable = true;
  let lifecycle;
  let dataParams = {};
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const node = (tag,text,cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const cellRow = (values, tag = 'td') => {
    const tr = node('tr');
    values.forEach(value => tr.append(node(tag,value)));
    return tr;
  };
  const defList = (pairs) => {
    const dl = node('dl',undefined,'ac-kv');
    pairs.forEach(([label,value]) => dl.append(node('dt',label),node('dd',value)));
    return dl;
  };
  function buildTable(labels,rows) {
    const wrap = node('div',undefined,'ac-sheet');
    const table = node('table',undefined,'ac-data');
    const head = node('thead'), body = node('tbody');
    head.append(cellRow(labels,'th'));
    rows.forEach(row => body.append(cellRow(row)));
    table.append(head,body);
    wrap.append(table);
    return wrap;
  }
  function remember() {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        version:1, state, sources:sources.filter(s => !builtInIds.has(s.id)),
        runs:runs.filter(r => !exampleRunIds.has(r.id)), grants:roles.map(r => r[3])
      }));
    } catch {
      storageAvailable = false;
      notice('Browser storage is unavailable. Changes will last for this session.');
    }
  }
  function notice(message) {
    let output = $('notice');
    if (!output) {
      output = node('p',undefined,'ac-info');
      output.id = 'ac-notice';
      output.setAttribute('role','status');
      root.querySelector('main').prepend(output);
    }
    output.textContent = message;
  }
  function currentHash() {
    const params = new URLSearchParams(routes.get(state.view).page === 'lifecycle' ? dataParams : {});
    if (['preview','connection'].includes(state.view)) {
      params.set('source',state.source);
      if (state.view === 'preview' && state.asset) params.set('asset',state.asset);
    }
    if (state.view === 'runs' && state.activeRun) params.set('run',state.activeRun);
    if (state.view === 'evaluations') params.set('suite',state.suite);
    const query = params.toString();
    return '#/' + routes.get(state.view).area + '/' + state.view + (query ? '?' + query : '');
  }
  function reflectRoute(replace) {
    const target = currentHash();
    if (location.hash === target) return;
    try {
      if (replace) history.replaceState(null,'',target);
      else history.pushState(null,'',target);
    } catch {
      if (replace) location.replace(target);
      else location.hash = target;
    }
  }
  function readRoute() {
    const requested = location.hash;
    if (!requested) {navigate('catalog',true);return;}
    const [path,query = ''] = requested.slice(1).split('?');
    const [,area,view] = path.split('/');
    if (!routes.has(view) || routes.get(view).area !== area || path !== '/' + area + '/' + view) {
      navigate('catalog',true);
      notice('This destination is unavailable. Choose a workspace section.');
      return;
    }
    const params = new URLSearchParams(query);
    if (['preview','connection'].includes(view) && params.has('source')) {
      const id = params.get('source');
      if (!sources.some(s => s.id === id)) {
        navigate('catalog',true);
        notice('This source is unavailable in this browser. Choose a registered source.');
        return;
      }
      state.source = id;
      state.asset = params.get('asset') || '';
    }
    if (view === 'runs' && params.has('run')) {
      const id = params.get('run');
      if (!runs.some(r => r.id === id)) {
        navigate('runs',true);
        notice('The requested run is unavailable in this browser. Choose a recorded run.');
        return;
      }
    }
    if (view === 'evaluations' && ['dated','missing'].includes(params.get('suite'))) state.suite = params.get('suite');
    navigate(view,true,Object.fromEntries(params));
  }
  function dataContext() {
    return {area:state.view,params:dataParams,sources,store:lifecycle,esc:escapeHtml,
      refresh:drawDataPage,go:(view,params={}) => {
        if (view === state.view) navigate(view,false,params);
      }};
  }
  function drawDataPage() {
    const ctx = dataContext();
    if (state.view === 'datasets') window.DataDatasetView.render($('data-work'),ctx);
    else if (routes.get(state.view).page === 'lifecycle') window.DataOpsView.render($('data-work'),ctx);
    else if (routes.get(state.view).page === 'sources') drawSources();
  }
  function navigate(view, replace = false, params = {}) {
    const route = routes.get(view);
    if (!route) return;
    state.view = view;
    if (view === 'runs') state.activeRun = params.run || '';
    dataParams = route.page === 'lifecycle' ? params : {};
    if (view === 'datasets' && dataParams.tab === 'lineage' && !dataParams.dataset) {
      dataParams = {...dataParams};
      delete dataParams.tab;
    }
    root.querySelector('.ac-shell').classList.toggle('dm-layout',route.area === 'data');
    if (view !== 'datasets') {
      const rail = $('folder-rail');
      rail.hidden = true;
      rail.replaceChildren();
    }
    for (const button of all('[data-area]')) {
      if (button.dataset.area === route.area) {
        button.setAttribute('aria-current','true');
        $('sections').setAttribute('aria-label',button.textContent.trim() + ' sections');
      } else button.removeAttribute('aria-current');
    }
    for (const button of all('[data-section]')) {
      button.hidden = routes.get(button.dataset.section).area !== route.area;
      if (button.dataset.section === (route.page === 'sources' ? 'catalog' : view)) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    for (const page of all('[data-page]')) page.hidden = page.dataset.page !== route.page;
    for (const block of all('[data-view]')) block.hidden = !block.dataset.view.split(' ').includes(view);
    if ($('title-' + route.page)) $('title-' + route.page).textContent = route.label;
    if (route.area === 'data') drawDataPage();
    if (view === 'performance') drawPerformance();
    if (view === 'runs' || view === 'evaluations') drawRuns();
    if (storageAvailable && $('notice')) $('notice').remove();
    document.title = route.label + ' · AI Center';
    reflectRoute(replace);
    remember();
  }
  function drawSources() {
    const records = lifecycle.snapshot();
    const term = state.search.trim().toLowerCase();
    const visible = sources.filter(s => (state.filter === 'all' || s.kind === state.filter)
      && (!state.corpus || s.corpus === state.corpus)
      && [s.name,s.corpus,s.format].some(value => value.toLowerCase().includes(term)));
    const active = sources.find(s => s.id === state.source) || sources[0];
    const catalog = $('catalog');
    catalog.replaceChildren();
    visible.forEach(s => {
      const tr = node('tr');
      tr.dataset.active = String(s === active);
      tr.dataset.sourceRow = s.id;
      const td = node('td');
      const button = node('button',undefined,'ac-rowname source-cell');
      button.type = 'button';
      button.dataset.source = s.id;
      button.setAttribute('aria-label','Open ' + s.name);
      const shorthand = s.format.toUpperCase() === 'CSV' ? 'CSV' : kinds[s.kind][1];
      const icon = node('span',shorthand,'source-icon');
      icon.setAttribute('aria-hidden','true');
      const identity = node('span',undefined,'source-identity');
      identity.append(node('span',s.name,'source-name'),node('span',s.object,'source-id'));
      button.append(icon,identity);
      td.append(button);
      const corpus = node('td');
      corpus.append(node('span',s.corpus,'corpus-chip'));
      const action = node('td');
      const arrow = node('span','→','ac-enter');
      arrow.setAttribute('aria-hidden','true');
      action.append(arrow);
      const sync = records.jobs.find(j => j.sourceId === s.id && j.type === 'sync');
      const lastSync = sync ? new Date(sync.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' · ' + sync.status : 'Never synced';
      tr.append(td,corpus,node('td',s.format),node('td',lastSync),action);
      catalog.append(tr);
    });
    if (!visible.length) {
      const row = node('tr'), cell = node('td','No sources match these filters.','ac-muted');
      cell.colSpan = 5;
      row.append(cell);
      catalog.append(row);
    }
    if ($('search')) $('search').value = state.search;
    if ($('source-count')) $('source-count').textContent = visible.length + (visible.length === 1 ? ' source' : ' sources');
    if ($('clear-filters')) $('clear-filters').hidden = !state.search && !state.corpus && state.filter === 'all';
    all('[data-corpus]').forEach(button => {
      button.setAttribute('aria-pressed',String(state.corpus === button.dataset.corpus));
      const count = button.querySelector('[data-corpus-count]');
      const total = sources.filter(s => s.corpus === button.dataset.corpus).length;
      if (count) count.textContent = total + (total === 1 ? ' source' : ' sources');
    });
    $('source-filter').value = state.filter;
    $('title-sources').textContent = state.view === 'catalog' ? 'Sources' : active.name;
    $('source-name').textContent = state.view === 'preview' ? 'Source assets' : 'Connection details';
    for (const tab of ['connection','preview']) {
      const button = $('tab-' + tab);
      if (state.view === tab) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    $('source-type').textContent = active.format;
    const assets = Array.isArray(active.assets) ? active.assets : [];
    const asset = assets.find(a => a.object === state.asset) || assets[0] || active;
    state.asset = assets.length ? asset.object : '';
    if ($('asset-picker')) $('asset-picker').hidden = state.view !== 'preview' || assets.length < 2;
    if ($('asset-select')) {
      $('asset-select').replaceChildren(...assets.map(a => new Option(a.object,a.object)));
      $('asset-select').value = state.asset;
    }
    const details = $('source-details');
    if (state.view === 'connection') {
      details.replaceChildren(defList([[kinds[active.kind][0],active.loc],['Resource',active.object],['Corpus',active.corpus],['Access',active.access],['Credential alias',active.credential],['Connection mode','Local sample']]));
      window.DataSourceView.render($('source-ops'),{...dataContext(),source:active});
    } else if (asset.rows.length) {
      details.replaceChildren(buildTable(asset.fields,asset.rows));
      if (assets.length && assets.length < 2) details.prepend(node('p',asset.object,'ac-muted'));
    } else {
      details.replaceChildren(node('p','No sample rows have been added to this source.','ac-muted'));
    }
  }
  function drawMappings() {
    $('entity').value = state.entity;
    const rows = fields.filter(row => state.entity === 'All entities' || row[1].startsWith(state.entity + '.'));
    $('mappings').replaceChildren(...rows.map(row => cellRow(row[1] === 'Ruler.name' ? [row[0],row[1] + ' · ' + state.alias,row[2]] : row)));
  }
  function testSemantic() {
    const alias = $('alias').value.trim();
    if (!alias) {$('sem-result').textContent = 'Enter a business alias for Ruler.name.';return;}
    state.alias = alias;
    $('sem-version').textContent = alias === 'Sovereign' ? 'Published · v2' : 'Preview draft · based on v2';
    const date = $('sem-date').value;
    state.date = date;
    const match = sources[0].rows.find(row => row[0] === 'FRA' && row[2] <= date && (row[4] === 'open' || (row[4] === 'dated' && date < row[3])));
    state.validation = match ? alias + ' of France on ' + date + ' · ' + match[1] + ' · Reign register.' : 'No confirmed reign covers ' + date + ' in the sample.';
    $('sem-result').textContent = state.validation;
    drawMappings();
  }
  function drawRoles() {
    $('scope').value = state.scope;
    const visible = roles.filter(r => state.scope === 'All scopes' || r[1] === state.scope);
    $('roles').replaceChildren(...visible.map(r => cellRow([r[0],r[1] + ' · ' + r[2],r[3]])));
    if (!visible.includes(roles[state.principal])) state.principal = roles.indexOf(visible[0]);
    $('principal').replaceChildren(...visible.map(r => {const op = node('option',r[0] + ' · ' + r[2]);op.value = String(roles.indexOf(r));return op;}));
    $('principal').value = String(state.principal);
    const role = roles[state.principal];
    $('permission').replaceChildren(...permissions[role[1]].map(p => node('option',p)));
    $('permission').value = role[3];
    showGrant();
  }
  function showGrant(applied = false) {
    const r = roles[state.principal];
    const action = $('permission').value;
    const description = action === 'No access' ? 'No access to this resource.' : action + '.';
    $('effective').textContent = (applied ? 'Applied in preview' : 'Effective access preview') + ' · ' + r[0] + ' → ' + r[2] + ' · ' + description;
  }
  function drawRuns() {
    const run = runs.find(item => item.id === state.activeRun);
    $('run-list').hidden = Boolean(run);
    $('run-detail').hidden = !run;
    if (run) {
      $('run-heading').textContent = run.id + ' · Execution trace';
      const top = node('div',undefined,'ac-blockhead');
      top.append(node('h3',run.question),node('span',run.status,'ac-tag'));
      const list = node('ol',undefined,'ac-trace');
      run.steps.forEach(step => list.append(node('li',step)));
      const details = [['Assistant version','v' + run.v],['Latency',run.latency],['Est. cost',run.cost]];
      if (run.config) details.push(['Model profile',run.config.model],['Semantic model',run.config.authorized]);
      $('run-info').replaceChildren(top,defList(details),list);
    } else {
      const rows = runs.map(item => {
        const row = cellRow(['',item.question,'v' + item.v,item.status]);
        const open = node('button',item.id,'ac-link');
        open.type = 'button';
        open.dataset.run = item.id;
        row.cells[0].append(open);
        return row;
      });
      $('run-rows').replaceChildren(...rows);
    }
    $('suite').value = state.suite;
    const dated = state.suite === 'dated';
    $('eval-set').textContent = dated ? 'Same 20 reference questions · includes start and end date boundaries.' : 'Same 8 prompts missing a date · expected behavior is to ask for clarification.';
    const rows = dated ? [['Reference answers passed','17 / 20','19 / 20'],['Citation accuracy','85%','95%'],['Median latency','1.2 s','1.4 s'],['Mean cost / question','$0.003','$0.004']] : [['Clarification checks passed','5 / 8','8 / 8'],['Premature tool calls','3','0'],['Median latency','1.1 s','0.6 s'],['Mean cost / question','$0.003','$0.002']];
    $('eval-rows').replaceChildren(...rows.map(r => cellRow(r)));
    $('eval-note').textContent = dated ? 'Reference case · On 22 July 1461, the register returns Louis XI under the exclusive end-date rule.' : 'Reference case · “Who ruled France?” needs a date before any lookup.';
  }
  function drawPerformance() {
    const durations = runs.map(run => Number.parseFloat(run.latency)).sort((a,b) => a-b);
    const at = Math.floor(durations.length / 2);
    const median = durations.length % 2 ? durations[at] : (durations[at-1] + durations[at]) / 2;
    const cost = runs.reduce((sum,run) => sum + Number(run.cost.slice(1)), 0);
    $('performance').replaceChildren(defList([
      ['Runs in this preview',String(runs.length)],
      ['Median latency',median.toFixed(2) + ' s'],
      ['Total estimated cost','$' + cost.toFixed(3)]
    ]));
  }
  function drawApi() {
    $('live-api').textContent = 'v' + state.live;
    let profile = $('published-profile');
    if (!profile) {
      profile = node('dd');
      profile.id = 'ac-published-profile';
      $('live-api').parentElement.append(node('dt','Published model'),profile);
    }
    profile.textContent = state.publishedConfig.model;
  }
  function currentConfig() {
    return {model:state.model,authorized:state.authorized,lookup:state.lookup,cite:state.cite};
  }
  function validConfig(config) {
    return config && ['Research standard','Research compact'].includes(config.model)
      && ['Country reigns v2','None assigned'].includes(config.authorized)
      && typeof config.lookup === 'boolean' && typeof config.cite === 'boolean';
  }
  function lookupCountry() {
    const source = sources.find(s => s.id === 'directory');
    const tag = $('api-tag').value;
    const match = source.rows.find(record => record[0] === tag);
    const response = match ? Object.fromEntries(source.fields.map((field,i) => [field,match[i]])) : {error:'Unknown country tag'};
    $('api-response').textContent = JSON.stringify(response,null,2);
  }
  function drawAssistant() {
    $('model').value = state.model;
    $('authorized').value = state.authorized;
    $('lookup').checked = state.lookup;
    $('cite').checked = state.cite;
    $('version').textContent = state.draft === state.live ? 'Published · v' + state.live : 'Draft v' + state.draft + ' · live v' + state.live;
    $('test-result').textContent = state.result;
    $('release').disabled = !state.tested || state.draft === state.live;
  }
  function changeDraft() {
    if (state.draft === state.live) state.draft++;
    state.model = $('model').value;
    state.authorized = $('authorized').value;
    state.lookup = $('lookup').checked;
    state.cite = $('cite').checked;
    state.tested = false;
    state.lastTest = '';
    state.result = 'Configuration changed. Run the release test again.';
    drawAssistant();
  }
  function testDraft() {
    const hasAccess = $('authorized').value === 'Country reigns v2';
    const lookup = $('lookup').checked;
    const cite = $('cite').checked;
    state.tested = hasAccess && lookup && cite;
    const sequence = runs.reduce((max,run) => Math.max(max,Number(run.id.slice(2))),0) + 1;
    const run = {id:'R-' + sequence,v:state.draft,question:runs.find(r => r.id === 'R-104').question,status:state.tested ? 'Test passed' : 'Test failed',latency:state.model === 'Research compact' ? '0.9 s' : '1.4 s',cost:state.model === 'Research compact' ? '$0.002' : '$0.004',steps:['Loaded ' + state.model + ' and the assistant configuration.']};
    if (!hasAccess) run.steps.push('Authorization stopped the query: no semantic model was assigned.');
    else if (!lookup) run.steps.push('Tool selection stopped: dated reign lookup is disabled.');
    else {
      run.steps.push('Queried Country reigns v2 for FRA on 1444-11-11 and found Charles VII.');
      run.steps.push(cite ? 'Attached Reign register / public.reigns and passed the reference check.' : 'The citation tool is disabled. The required source check failed.');
    }
    runs.unshift(run);
    run.config = currentConfig();
    state.lastTest = run.id;
    state.result = (state.tested ? 'Passed' : 'Failed') + ' · ' + run.id + ' · ' + run.steps[run.steps.length - 1];
    drawRuns();
    drawAssistant();
  }
  function selectSource(id,detail,asset = '') {
    state.source = id;
    state.asset = asset;
    navigate(detail);
    $('tab-' + detail)?.focus();
  }
  function addSource() {
    if (!window.SourceEditor || typeof window.SourceEditor.open !== 'function') {
      notice('The source editor could not be loaded. Reopen the application and try again.');
      return;
    }
    window.SourceEditor.open({defaultCorpus:state.defaultCorpus,onSave(record) {
      const key = globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
      const source = {...record,id:'local-' + key};
      if (!validSource(source)) {notice('The source is missing required connection or preview data.');return;}
      sources.push(source);
      drawSources();
      remember();
      notice(source.name + ' added to Sources.');
    }});
  }
  function validSource(s) {
    const isTable = a => a && Array.isArray(a.fields) && a.fields.every(f => typeof f === 'string')
      && Array.isArray(a.rows) && a.rows.every(Array.isArray);
    return s && typeof s === 'object' && typeof s.id === 'string' && s.id.startsWith('local-')
      && Object.hasOwn(kinds,s.kind) && corpora.includes(s.corpus) && isTable(s)
      && ['name','format','access','loc','object','credential'].every(k => typeof s[k] === 'string')
      && (!s.assets || (Array.isArray(s.assets) && s.assets.every(a => isTable(a) && typeof a.object === 'string')));
  }
  function restore() {
    let raw;
    try {raw = localStorage.getItem(storageKey);}
    catch {storageAvailable = false;notice('Browser storage is unavailable. Changes will last for this session.');return;}
    if (!raw) return;
    let snapshot;
    try {snapshot = JSON.parse(raw);}
    catch {return;}
    if (!snapshot || snapshot.version !== 1 || !snapshot.state || typeof snapshot.state !== 'object') return;
    const s = snapshot.state;
    for (const source of Array.isArray(snapshot.sources) ? snapshot.sources : []) {
      if (validSource(source) && !sources.some(existing => existing.id === source.id)) sources.push(source);
    }
    const customRuns = [];
    const runIds = new Set(exampleRunIds);
    for (const run of Array.isArray(snapshot.runs) ? snapshot.runs : []) {
      if (!run || !/^R-\d+$/.test(run.id) || runIds.has(run.id) || !Number.isSafeInteger(Number(run.id.slice(2)))
          || !Number.isSafeInteger(run.v) || run.v < 1 || !Array.isArray(run.steps)
          || !run.steps.every(line => typeof line === 'string')
          || !['question','status','latency','cost'].every(key => typeof run[key] === 'string')
          || !Number.isFinite(Number.parseFloat(run.latency)) || !/^\$\d+(\.\d+)?$/.test(run.cost)) continue;
      if (!validConfig(run.config)) delete run.config;
      customRuns.push(run);
      runIds.add(run.id);
    }
    runs.unshift(...customRuns);
    if (Array.isArray(snapshot.grants)) roles.forEach((r,i) => {
      if (permissions[r[1]].includes(snapshot.grants[i])) r[3] = snapshot.grants[i];
    });
    const accepted = {
      filter:['all',...Object.keys(kinds)],corpus:['',...corpora],defaultCorpus:corpora,entity:['All entities','Country','Ruler','Reign'],
      scope:['All scopes','Project','Dataset','Assistant'],suite:['dated','missing'],model:['Research standard','Research compact'],
      authorized:['Country reigns v2','None assigned'],date:['1444-11-11','1461-07-22','1600-01-01']
    };
    Object.keys(accepted).forEach(key => {if (accepted[key].includes(s[key])) state[key] = s[key];});
    for (const key of ['asset','alias','search','validation','result','lastTest']) {
      if (typeof s[key] === 'string') state[key] = s[key];
    }
    if (sources.some(source => source.id === s.source)) state.source = s.source;
    if (Number.isInteger(s.principal) && roles[s.principal]) state.principal = s.principal;
    if (Number.isSafeInteger(s.live) && s.live >= 3 && [s.live,s.live + 1].includes(s.draft)) {
      state.live = s.live; state.draft = s.draft;
    }
    for (const key of ['cite','lookup']) if (typeof s[key] === 'boolean') state[key] = s[key];
    if (validConfig(s.publishedConfig)) state.publishedConfig = s.publishedConfig;
    const proof = runs.find(r => r.id === state.lastTest);
    state.tested = s.tested === true && proof?.v === state.draft && proof.status === 'Test passed'
      && state.lookup && state.cite && state.authorized === 'Country reigns v2';
    $('alias').value = state.alias;
    $('sem-date').value = state.date;
    $('sem-version').textContent = state.alias === 'Sovereign' ? 'Published · v2' : 'Preview draft · based on v2';
    if (state.validation) $('sem-result').textContent = state.validation;
  }
  root.addEventListener('click',event => {
    const button = event.target.closest('button');
    if (!button) {
      const row = event.target.closest('[data-source-row]');
      if (row) selectSource(row.dataset.sourceRow,'connection');
      return;
    }
    if (!root.contains(button)) return;
    const d = button.dataset;
    if (d.area) {navigate(navigation[d.area][0][0]);return;}
    if (d.section) {navigate(d.section);return;}
    if (d.sourceView && ['catalog','connection','preview'].includes(d.sourceView)) {
      navigate(d.sourceView);
      (button.closest('[hidden]') ? root.querySelector('[data-section][aria-current="page"]') : button).focus();
      return;
    }
    if (d.source) {selectSource(d.source,'connection');return;}
    if (d.run) {navigate('runs',false,{run:d.run});$('run-heading').focus();return;}
    if (d.corpus) {state.corpus = state.corpus === d.corpus ? '' : d.corpus;drawSources();}
    else if (button.id === 'ac-clear-filters') {state.corpus = '';state.filter = 'all';state.search = '';drawSources();}
    else {
      switch (d.act) {
        case 'back-to-runs': {
          const selected = state.activeRun;
          navigate('runs');
          all('[data-run]').find(control => control.dataset.run === selected)?.focus();
          return;
        }
        case 'add': addSource();break;
        case 'lookup-country':lookupCountry();break;
        case 'test-semantic': testSemantic();break;
        case 'apply-grant': roles[state.principal][3] = $('permission').value;drawRoles();showGrant(true);break;
        case 'test': testDraft();break;
        case 'release':
          if (!state.tested || state.draft === state.live) return;
          state.live = state.draft;
          state.publishedConfig = currentConfig();
          state.result = 'Published v' + state.live + '. The sample assistant API now points to this release.';
          drawAssistant();drawApi();break;
      }
    }
    remember();
  });
  root.addEventListener('change',event => {
    const input = event.target;
    switch (input.id) {
      case 'ac-asset-select':state.asset = input.value;navigate('preview');return;
      case 'ac-source-filter': state.filter = input.value;drawSources();break;
      case 'ac-default-corpus':
        if (!corpora.includes(input.value)) return;
        state.defaultCorpus = input.value;
        $('default-feedback').textContent = 'Default corpus saved: ' + state.defaultCorpus + '.';
        break;
      case 'ac-entity':state.entity = input.value;drawMappings();break;
      case 'ac-scope':state.scope = input.value;drawRoles();break;
      case 'ac-principal':state.principal = Number(input.value);drawRoles();break;
      case 'ac-permission':showGrant();break;
      case 'ac-suite':state.suite = input.value;navigate('evaluations');return;
      case 'ac-model':case 'ac-authorized':case 'ac-lookup':case 'ac-cite':changeDraft();break;
      default:return;
    }
    remember();
  });
  root.addEventListener('input',event => {
    if (event.target.id !== 'ac-search') return;
    state.search = event.target.value;
    drawSources();
    remember();
  });
  restore();
  lifecycle = window.createDataMenuStore(sources,notice);
  function checkScheduledJobs() {
    const check = () => {
      if (!lifecycle.tick()) return;
      const schedule = root.querySelector('#ac-data-work .dm-schedule-view');
      if ((state.view === 'datasets' || state.view === 'jobs') && schedule) schedule.dispatchEvent(new Event('dm-scheduled'));
      else if (state.view === 'jobs' && !root.querySelector('[data-schedule-picker]')) drawDataPage();
    };
    if (navigator.locks) navigator.locks.request('ai-center-dataset-scheduler',{ifAvailable:true},lock => {if (lock) check();}).catch(check);
    else check();
  }
  checkScheduledJobs();
  if ($('default-corpus')) $('default-corpus').value = state.defaultCorpus;
  drawMappings();
  drawRoles();
  drawRuns();
  drawApi();
  drawAssistant();
  readRoute();
  window.addEventListener('hashchange',readRoute);
  window.setInterval(checkScheduledJobs,10000);
})();
