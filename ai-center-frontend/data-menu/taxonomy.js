(() => {
  'use strict';

  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  function mount(host, {store, assets}) {
    const {domains,subjects,domainSubjects} = store.snapshot();
    const pairsByDomain = new Map(domains.map(domain => [domain.id,new Map()]));
    for (const pair of domainSubjects) pairsByDomain.get(pair.domainId)?.set(pair.subjectId,pair);

    const counts = new Map();
    const seen = new Set();
    for (const asset of assets) {
      if (!asset.pairId) continue;
      const key = JSON.stringify([asset.kind,asset.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(asset.pairId,(counts.get(asset.pairId) || 0) + 1);
    }

    const section = element('section',undefined,'tm-section');
    section.setAttribute('aria-label','Domain and subject matrix');
    host.replaceChildren(section);
    if (!domains.length || !subjects.length) {
      section.append(element('p','The matrix needs at least one domain and one subject.','tm-empty'));
      return;
    }
    const legend = element('p','Numbers count explicitly assigned assets. Plain numbers indicate active relationships, “retired” marks retained assignments, and a dash means no relationship.','tm-legend');
    legend.id = 'tm-legend';
    section.append(legend);

    // Distinguish older subjects which share a display name and have separate identities.
    const nameCounts = new Map();
    for (const {name} of subjects) {
      const key = name.toLowerCase();
      nameCounts.set(key,(nameCounts.get(key) || 0) + 1);
    }
    const table = element('table',undefined,'tm-table');
    table.style.setProperty('--tm-cols',String(subjects.length));
    table.setAttribute('aria-describedby',legend.id);
    table.append(element('caption','Assigned assets by domain and subject','sr-only'));
    const columns = element('colgroup');
    columns.append(element('col',undefined,'tm-row-column'));
    for (const subject of subjects) columns.append(element('col'));
    table.append(columns);

    const header = table.createTHead().insertRow();
    const corner = element('th','Domain / Subject','tm-corner');
    corner.scope = 'col';
    header.append(corner);
    for (const subject of subjects) {
      const name = nameCounts.get(subject.name.toLowerCase()) > 1 ? subject.name + ' (' + subject.id + ')' : subject.name;
      const cell = element('th',name);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    for (const domain of domains) {
      const row = body.insertRow();
      const heading = element('th',domain.name);
      heading.scope = 'row';
      row.append(heading);
      for (const subject of subjects) {
        const pair = pairsByDomain.get(domain.id).get(subject.id);
        const cell = row.insertCell();
        if (!pair) {
          const dash = element('span','—','tm-dash');
          dash.setAttribute('aria-hidden','true');
          cell.append(dash,element('span','No relationship','sr-only'));
          continue;
        }
        const count = counts.get(pair.id) || 0;
        cell.dataset.state = pair.active ? 'active' : 'retired';
        cell.append(element('span',String(count),'tm-count'));
        cell.append(element('span',count === 1 ? ' assigned asset' : ' assigned assets','sr-only'));
        if (pair.active) cell.append(element('span',', active relationship','sr-only'));
        else cell.append(element('span',' Retired','tm-retired'));
      }
    }

    const viewport = element('div',undefined,'tm-viewport');
    viewport.setAttribute('role','region');
    viewport.setAttribute('aria-label','Scrollable matrix');
    viewport.tabIndex = 0;
    viewport.append(table);
    section.append(viewport);
  }

  window.TaxonomyMatrix = {mount};
})();
