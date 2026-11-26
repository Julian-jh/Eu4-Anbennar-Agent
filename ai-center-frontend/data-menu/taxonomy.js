(() => {
  'use strict';

  function definitionNames(definitions) {
    const counts = new Map();
    for (const {name} of definitions) {
      const key = name.toLowerCase();
      counts.set(key,(counts.get(key) || 0) + 1);
    }
    return new Map(definitions.map(({id,name}) => [id,counts.get(name.toLowerCase()) > 1 ? name + ' · ' + id : name]));
  }

  function observedGroups(data,assets) {
    const domains = definitionNames(data.domains), subjects = definitionNames(data.subjects);
    const groups = new Map();
    for (const asset of assets) {
      const domain = domains.get(asset.domainId) || 'No domain';
      for (const subjectId of asset.subjectIds.length ? asset.subjectIds : ['']) {
        const key = JSON.stringify([asset.domainId,subjectId]);
        if (!groups.has(key)) {
          groups.set(key,{domain,subject:subjects.get(subjectId) || 'No subjects',source:0,dataset:0});
        }
        groups.get(key)[asset.kind]++;
      }
    }
    return [...groups.values()].sort((a,b) => a.domain.localeCompare(b.domain) || a.subject.localeCompare(b.subject));
  }

  function mountCoverage(host,{data,assets}) {
    const groups = observedGroups(data,assets);
    const section = document.createElement('section');
    section.className = 'dm-tax-assets td-coverage';
    section.setAttribute('aria-label','Classification coverage');
    section.innerHTML = `<div class="dm-head"><strong data-total></strong>
      <label class="td-search"><span class="sr-only">Search coverage</span><input type="search" placeholder="Find domain or subject"></label></div>
      <p id="td-coverage-note" class="dm-muted">Each asset counts once per subject. Assets with no domain or no subjects are included.</p>
      <div class="dm-table-wrap"><table class="dm-table" aria-label="Classification coverage" aria-describedby="td-coverage-note">
        <thead><tr><th scope="col">Domain</th><th scope="col">Subject</th><th scope="col">Sources</th><th scope="col">Datasets</th></tr></thead><tbody></tbody>
      </table></div>
      <nav class="dm-preview-pages" aria-label="Coverage pagination"><span class="dm-muted" role="status"></span>
        <button type="button" class="dm-btn" data-previous>Previous</button><button type="button" class="dm-btn" data-next>Next</button></nav>`;
    host.replaceChildren(section);
    section.querySelector('[data-total]').textContent = assets.length + (assets.length === 1 ? ' active asset' : ' active assets');
    const body = section.querySelector('tbody');
    const search = section.querySelector('input');
    const status = section.querySelector('[role=status]');
    const previous = section.querySelector('[data-previous]'), next = section.querySelector('[data-next]');
    const pageSize = 25;
    let page = 0, filtered = groups;

    function draw() {
      body.replaceChildren();
      const start = page * pageSize;
      for (const group of filtered.slice(start,start + pageSize)) {
        const row = body.insertRow();
        for (const value of [group.domain,group.subject,group.source,group.dataset]) row.insertCell().textContent = value;
      }
      if (!filtered.length) {
        const empty = body.insertRow().insertCell();
        empty.colSpan = 4;
        empty.className = 'dm-muted';
        empty.textContent = groups.length ? 'No matching classifications.' : 'No active assets.';
      }
      const end = Math.min(start + pageSize,filtered.length);
      status.textContent = filtered.length ? (start + 1) + '–' + end + ' of ' + filtered.length + (filtered.length === 1 ? ' group' : ' groups') : '0 groups';
      previous.hidden = next.hidden = filtered.length <= pageSize;
      previous.disabled = page === 0;
      next.disabled = end >= filtered.length;
    }
    search.oninput = () => {
      const term = search.value.trim().toLowerCase();
      filtered = term ? groups.filter(group => [group.domain,group.subject].some(name => name.toLowerCase().includes(term))) : groups;
      page = 0;
      draw();
    };
    previous.onclick = () => { page--;draw(); };
    next.onclick = () => { page++;draw(); };
    draw();
  }

  window.Taxonomy = {mountCoverage,definitionNames};
})();
