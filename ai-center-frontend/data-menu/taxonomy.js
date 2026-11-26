/* Browse the domain → subject hierarchy using the same rail as the dataset catalog. */
(() => {
  'use strict';
  const sessions = new WeakMap();

  function resolve(data,params) {
    const subject = params.subject && data.subjects.find(item => item.id === params.subject);
    const domainId = subject ? subject.domainId : params.domain;
    const domain = domainId && data.domains.find(item => item.id === domainId);
    if (subject) return {kind:'subject',node:subject,domain,key:'subject:' + subject.id};
    if (domain && !params.subject) return {kind:'domain',node:domain,domain,key:'domain:' + domain.id};
    return {kind:'root',node:null,domain:null,key:'root',unavailable:Boolean(params.subject || params.domain)};
  }

  function renderRail(rail,{store,data,assets,scope,go,esc,onAddDomain}) {
    let state = sessions.get(store);
    const children = new Map(data.domains.map(domain => [domain.id,[]]));
    for (const subject of data.subjects) children.get(subject.domainId)?.push(subject);
    const byName = (a,b) => a.name.localeCompare(b.name);
    const domains = [...data.domains].sort(byName);
    for (const subjects of children.values()) subjects.sort(byName);
    if (!state) {
      state = {expanded:new Set(domains.slice(0,2).map(domain => domain.id)),scope:null};
      sessions.set(store,state);
    }
    const previousNav = rail.querySelector('.dm-tax-rail nav');
    const previousScroll = previousNav?.scrollTop ?? state.scrollTop ?? 0;
    const location = JSON.stringify([scope.key,scope.domain?.id]);
    const revealSelection = !previousNav || state.scope !== location;
    if (revealSelection && scope.domain) state.expanded.add(scope.domain.id);
    state.scope = location;
    const counts = new Map();
    for (const asset of assets) if (asset.subjectId) counts.set(asset.subjectId,(counts.get(asset.subjectId) || 0) + 1);
    const panel = document.createElement('section');
    panel.className = 'dm-tax-rail';
    panel.innerHTML = '<header><h2>Domains &amp; subjects</h2><button type="button" class="dm-icon-action" data-tax-add aria-label="Add domain" title="Add domain"><span aria-hidden="true">＋</span></button></header><nav aria-label="Taxonomy hierarchy" class="dm-ft-nav"></nav>';
    rail.hidden = false;
    rail.replaceChildren(panel);
    const nav = panel.querySelector('nav');
    panel.querySelector('[data-tax-add]').addEventListener('click',onAddDomain);
    function choice(kind,id,name,count) {
      const selected = scope.kind === kind && (!scope.node || scope.node.id === id);
      return `<button type="button" class="dm-tax-choice" data-tax-kind="${kind}" data-tax-id="${esc(id)}"${selected ? ' aria-current="page"' : ''}>
        <span class="dm-tax-glyph" data-shape="${kind}" aria-hidden="true"></span><span>${esc(name)}</span><small aria-hidden="true">${count}</small></button>`;
    }
    function draw() {
      const branches = domains.map((domain,i) => {
        const subjects = children.get(domain.id), open = state.expanded.has(domain.id);
        const total = subjects.reduce((n,s) => n + (counts.get(s.id) || 0),0);
        const toggle = subjects.length ? `<button type="button" class="dm-tax-toggle" data-tax-toggle="${esc(domain.id)}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(domain.name)}" aria-expanded="${open}" aria-controls="dm-tax-branch-${i}"><span aria-hidden="true">${open ? '▾' : '▸'}</span></button>` : '<span></span>';
        const nested = open ? subjects.map(subject => `<li>${choice('subject',subject.id,subject.name,counts.get(subject.id) || 0)}</li>`).join('') : '';
        return `<li><div class="dm-tax-row">${toggle}${choice('domain',domain.id,domain.name,total)}</div>
          <ul id="dm-tax-branch-${i}" ${open ? '' : 'hidden'}>${nested}</ul></li>`;
      }).join('');
      nav.innerHTML = `<ul><li>${choice('root','','All assets',assets.length)}</li>${branches}</ul>`;
    }
    function control(kind,id) {
      return [...nav.querySelectorAll('[data-tax-kind]')].find(el => el.dataset.taxKind === kind && el.dataset.taxId === id);
    }
    function toggle(id,focusButton) {
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      draw();
      if (focusButton) [...nav.querySelectorAll('[data-tax-toggle]')].find(el => el.dataset.taxToggle === id)?.focus();
      else control('domain',id)?.focus();
    }
    nav.addEventListener('click',event => {
      const disclosure = event.target.closest('[data-tax-toggle]');
      if (disclosure) {toggle(disclosure.dataset.taxToggle,true);return;}
      const target = event.target.closest('[data-tax-kind]');
      if (!target) return;
      const {taxKind:kind,taxId:id} = target.dataset;
      go('taxonomy',kind === 'root' ? {} : {[kind]:id});
      rail.querySelector('[aria-current="page"]')?.focus({preventScroll:true});
    });
    nav.addEventListener('keydown',event => {
      const target = event.target.closest('[data-tax-kind]');
      if (!target || event.altKey || event.ctrlKey || event.metaKey) return;
      const items = [...nav.querySelectorAll('[data-tax-kind]')].filter(el => !el.closest('[hidden]'));
      const pos = items.indexOf(target), {taxKind:kind,taxId:id} = target.dataset;
      switch (event.key) {
        case 'ArrowDown': items[Math.min(pos + 1,items.length - 1)].focus(); break;
        case 'ArrowUp': items[Math.max(pos - 1,0)].focus(); break;
        case 'Home': items[0].focus(); break;
        case 'End': items[items.length - 1].focus(); break;
        case 'ArrowRight':
          if (kind !== 'domain' || !children.get(id)?.length) return;
          if (state.expanded.has(id)) control('subject',children.get(id)[0].id)?.focus();
          else toggle(id,false);
          break;
        case 'ArrowLeft':
          if (kind === 'domain' && state.expanded.has(id)) toggle(id,false);
          else if (kind === 'subject') control('domain',data.subjects.find(s => s.id === id).domainId)?.focus();
          else control('root','')?.focus();
          break;
        default:return;
      }
      event.preventDefault();
    });
    draw();
    nav.scrollTop = previousScroll;
    if (revealSelection) {
      const current = nav.querySelector('[aria-current="page"]');
      if (current) {
        const row = current.getBoundingClientRect(), frame = nav.getBoundingClientRect();
        if (row.top < frame.top) nav.scrollTop += row.top - frame.top;
        else if (row.bottom > frame.bottom) nav.scrollTop += row.bottom - frame.bottom;
      }
    }
    nav.addEventListener('scroll',() => {if (nav.isConnected) state.scrollTop = nav.scrollTop;},{passive:true});
  }
  window.TaxonomyHierarchy = {resolve,renderRail};
})();
