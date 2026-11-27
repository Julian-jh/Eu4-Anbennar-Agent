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

  function matrixAxis(definitions,unassignedLabel) {
    const names = definitionNames(definitions);
    const axis = [...names].map(([id,name]) => ({id,name}));
    axis.sort((a,b) => a.name.localeCompare(b.name));
    axis.push({id:'',name:unassignedLabel});
    return axis;
  }

  function mountMatrix(host,domains,subjects,activeDatasets) {
    const rows = matrixAxis(domains,'No domain');
    const columns = matrixAxis(subjects,'No subjects');
    const counts = new Map(rows.map(row => [row.id,new Map()]));
    const subjectIds = new Set(subjects.map(subject => subject.id));
    for (const dataset of activeDatasets) {
      const row = counts.get(dataset.domainId) || counts.get('');
      const assigned = new Set((dataset.subjectIds || []).filter(id => subjectIds.has(id)));
      if (!assigned.size) assigned.add('');
      for (const id of assigned) row.set(id,(row.get(id) || 0) + 1);
    }

    const section = document.createElement('section');
    section.className = 'dm-tax-assets td-matrix';
    section.setAttribute('aria-label','Classification matrix');
    section.innerHTML = `<div class="dm-head"><strong data-total></strong>
      <div class="dm-actions td-matrix-search">
        <label class="td-search"><span class="sr-only">Find domain</span><input type="search" placeholder="Find domain" data-domain></label>
        <label class="td-search"><span class="sr-only">Find subject</span><input type="search" placeholder="Find subject" data-subject></label>
      </div></div>
      <p id="td-matrix-note" class="dm-muted">Each active dataset counts once in each of its assigned subjects.</p>
      <div class="dm-table-wrap td-matrix-scroll" role="region" aria-label="Scrollable classification matrix" tabindex="0">
        <table class="dm-table" aria-label="Datasets by domain and subject" aria-describedby="td-matrix-note">
          <thead></thead><tbody></tbody>
        </table>
      </div>
      <p data-empty class="dm-muted" role="status" hidden></p>
      <nav class="dm-preview-pages" aria-label="Matrix pagination" hidden><span class="dm-muted" role="status"></span>
        <button type="button" class="dm-btn" data-previous>Previous</button><button type="button" class="dm-btn" data-next>Next</button></nav>`;
    host.replaceChildren(section);
    const total = activeDatasets.length;
    section.querySelector('[data-total]').textContent = total + (total === 1 ? ' active dataset' : ' active datasets');
    const domainSearch = section.querySelector('[data-domain]'), subjectSearch = section.querySelector('[data-subject]');
    const viewport = section.querySelector('.td-matrix-scroll');
    const head = section.querySelector('thead'), body = section.querySelector('tbody');
    const empty = section.querySelector('[data-empty]'), pager = section.querySelector('nav');
    const previous = pager.querySelector('[data-previous]'), next = pager.querySelector('[data-next]');
    const pageSize = 25;
    let page = 0;

    function heading(row,label,scope) {
      const cell = document.createElement('th');
      cell.scope = scope;
      cell.textContent = label;
      row.append(cell);
    }
    function matching(axis,input) {
      const term = input.value.trim().toLowerCase();
      return term ? axis.filter(item => item.name.toLowerCase().includes(term)) : axis;
    }
    function draw() {
      const visibleRows = matching(rows,domainSearch);
      const visibleCols = matching(columns,subjectSearch);
      head.replaceChildren();
      body.replaceChildren();
      viewport.hidden = !visibleRows.length || !visibleCols.length;
      empty.hidden = !viewport.hidden;
      pager.hidden = viewport.hidden || visibleRows.length <= pageSize;
      if (viewport.hidden) {
        empty.textContent = visibleRows.length ? 'No matching subjects.' : 'No matching domains.';
        return;
      }
      const header = head.insertRow();
      heading(header,'Domain / Subject','col');
      for (const column of visibleCols) heading(header,column.name,'col');
      const start = page * pageSize;
      const end = Math.min(start + pageSize,visibleRows.length);
      for (const domain of visibleRows.slice(start,end)) {
        const row = body.insertRow(), values = counts.get(domain.id);
        heading(row,domain.name,'row');
        for (const subject of visibleCols) {
          const count = values.get(subject.id) || 0;
          const cell = row.insertCell();
          cell.textContent = String(count);
          if (!count) cell.className = 'dm-muted';
        }
      }
      pager.querySelector('[role=status]').textContent = (start + 1) + '–' + end + ' of ' + visibleRows.length + ' domain rows';
      previous.disabled = page === 0;
      next.disabled = end >= visibleRows.length;
    }
    function filter() { page = 0; viewport.scrollTo(0,0); draw(); }
    domainSearch.oninput = subjectSearch.oninput = filter;
    previous.onclick = () => { page--; viewport.scrollTop = 0; draw(); };
    next.onclick = () => { page++; viewport.scrollTop = 0; draw(); };
    draw();
  }

  window.Taxonomy = {mountMatrix,definitionNames};
})();
