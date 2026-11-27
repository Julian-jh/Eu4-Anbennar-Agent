(() => {
  const root = document.getElementById('ac-workbench');
  if (!root) return;
  const $ = (id) => root.querySelector('#ac-' + id);
  const all = (selector) => Array.from(root.querySelectorAll(selector));
  const areaButtons = all('.ac-primary-nav [data-area]');
  let touchHintTimer;
  function clearTouchHint() {
    clearTimeout(touchHintTimer);
    for (const button of areaButtons) delete button.dataset.touchLabel;
  }
  for (const button of areaButtons) {
    button.addEventListener('pointerenter',() => {delete button.dataset.dismissed;});
    button.addEventListener('focus',() => {delete button.dataset.dismissed;});
    button.addEventListener('pointerup',event => {
      if (event.pointerType !== 'touch') return;
      clearTouchHint();
      delete button.dataset.dismissed;
      button.dataset.touchLabel = '';
      touchHintTimer = setTimeout(clearTouchHint,1500);
    });
  }
  root.addEventListener('pointerdown',clearTouchHint);
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape') {
      clearTouchHint();
      for (const button of areaButtons) button.dataset.dismissed = '';
    }
  });
  const navigation = {
    data: [['catalog','Sources','sources'],['storages','Storages','lifecycle'],['datasets','Datasets','lifecycle'],['jobs','Jobs','lifecycle'],['taxonomy','Taxonomy','lifecycle'],['archive','Archive','lifecycle']],
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
  const corpora = ['EU4','Anbennar','Real History'];
  // Local dataset pages have no connection catalog. Sources are managed through the API.
  const sources = [];
  const legacySourceNames = new Map();
  let hasLegacySources = false;
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
    view:'catalog', entity:'All entities', scope:'All scopes',
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
        version:1, state,
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
    const page = routes.get(state.view).page;
    const params = new URLSearchParams(['lifecycle','sources'].includes(page) ? dataParams : {});
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
    const sourceRoute = ['preview','connection'].includes(view);
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (sourceRoute && !uuid.test(params.get('source') || '')) {
      navigate('catalog',true);
      return;
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
    else if (state.view === 'storages') window.DataStorageView.render($('data-work'),ctx);
    else if (routes.get(state.view).page === 'lifecycle') window.DataOpsView.render($('data-work'),ctx);
    else if (routes.get(state.view).page === 'sources') drawSources();
  }
  function navigate(view, replace = false, params = {}) {
    const route = routes.get(view);
    if (!route) return;
    state.view = view;
    const liveSources = route.page === 'sources';
    $('workspace-mode').textContent = liveSources ? 'Sources workspace' : 'Demo workspace';
    root.querySelector('.ac-person').hidden = liveSources;
    if (view === 'runs') state.activeRun = params.run || '';
    dataParams = ['lifecycle','sources'].includes(route.page) ? params : {};
    if (route.page !== 'sources') window.LiveSources.leave();
    if (view === 'datasets' && dataParams.tab === 'lineage' && !dataParams.dataset) {
      dataParams = {...dataParams};
      delete dataParams.tab;
    }
    root.querySelector('.ac-shell').classList.toggle('dm-layout',route.area === 'data');
    const rail = $('folder-rail');
    if (view !== 'datasets') {
      rail.hidden = true;
      rail.replaceChildren();
    }
    for (const button of all('[data-area]')) {
      if (button.dataset.area === route.area) {
        button.setAttribute('aria-current','true');
        $('sections').setAttribute('aria-label',button.getAttribute('aria-label') + ' sections');
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
    window.LiveSources.render($('live-sources'),state.view,dataParams,{
      go:(view,params = {}) => navigate(view,false,params),
      defaultCorpus:state.defaultCorpus
    });
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
    const reigns = lifecycle.snapshot().datasets.find(dataset => dataset.id === 'reigns' && !dataset.archived);
    const match = reigns?.docs.map(doc => doc.values).find(row => row?.country_tag === 'FRA'
      && row.start_date <= date && (row.end_status === 'open' || row.end_status === 'dated' && date < row.end_date));
    state.validation = match ? alias + ' of France on ' + date + ' · ' + match.ruler_name + ' · ' + reigns.name + '.' : 'No confirmed reign covers ' + date + ' in the sample.';
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
    const tag = $('api-tag').value;
    const names = {FRA:'France',ENG:'England'};
    const response = Object.hasOwn(names,tag) ? {country_tag:tag,display_name:names[tag]} : {error:'Unknown country tag'};
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
    if (Object.hasOwn(snapshot,'sources')) {
      hasLegacySources = true;
      for (const item of Array.isArray(snapshot.sources) ? snapshot.sources : []) {
        if (typeof item?.id === 'string' && typeof item.name === 'string') legacySourceNames.set(item.id,item.name);
      }
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
      defaultCorpus:corpora,entity:['All entities','Country','Ruler','Reign'],
      scope:['All scopes','Project','Dataset','Assistant'],suite:['dated','missing'],model:['Research standard','Research compact'],
      authorized:['Country reigns v2','None assigned'],date:['1444-11-11','1461-07-22','1600-01-01']
    };
    Object.keys(accepted).forEach(key => {if (accepted[key].includes(s[key])) state[key] = s[key];});
    for (const key of ['alias','validation','result','lastTest']) {
      if (typeof s[key] === 'string') state[key] = s[key];
    }
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
    if (!button || !root.contains(button) || button.closest('#ac-live-sources')) return;
    const d = button.dataset;
    if (d.area) {navigate(navigation[d.area][0][0]);return;}
    if (d.section) {navigate(d.section);return;}
    if (d.run) {navigate('runs',false,{run:d.run});$('run-heading').focus();return;}
    switch (d.act) {
        case 'back-to-runs': {
          const selected = state.activeRun;
          navigate('runs');
          all('[data-run]').find(control => control.dataset.run === selected)?.focus();
          return;
        }
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
    remember();
  });
  root.addEventListener('change',event => {
    const input = event.target;
    switch (input.id) {
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
  restore();
  lifecycle = window.createDataMenuStore(sources,notice,legacySourceNames);
  if (hasLegacySources) remember();
  legacySourceNames.clear();
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
