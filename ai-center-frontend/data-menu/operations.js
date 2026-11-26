(() => {
  'use strict';

  const sessions = new WeakMap();
  const jobLabels = {ingest: 'Ingestion', refresh: 'Data refresh', rebuild: 'Index rebuild', sync: 'Source sync', test: 'Connection test'};
  const jobStatuses = ['Succeeded', 'Failed', 'Skipped', 'Running', 'Queued'];
  const taxonomyTabs = {domains:'Domains', subjects:'Subjects', matrix:'Matrix'};
  const timeFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'});

  function displayTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : timeFormat.format(date);
  }

  function session(store) {
    if (!sessions.has(store)) sessions.set(store, {
      tab: 'runs', job: '', editor: null,
      searches: {}, filters: {}, notice: null
    });
    return sessions.get(store);
  }

  function render(host, ctx) {
    const {area, store, go, params = {}} = ctx;
    const esc = value => ctx.esc(String(value ?? ''));
    const state = session(store);
    const data = store.snapshot();
    const sources = ctx.sources.filter(source => !source.archived);
    const datasets = data.datasets;
    const active = datasets.filter(dataset => !dataset.archived);
    const idOf = (rows, id) => rows.find(row => row.id === id);
    const sourceName = id => idOf(ctx.sources, id)?.name || id || '—';
    const jobDataset = job => job.deletedDatasetId ? job.deletedDatasetName + ' (deleted)' : idOf(datasets,job.datasetId)?.name;
    const assetName = job => jobDataset(job) || sourceName(job.sourceId);
    const canRetry = job => job.status === 'Failed' && !job.deletedDatasetId && (!job.datasetId || active.some(ds => ds.id === job.datasetId));
    const term = text => String(text || '').trim().toLowerCase();
    const flags = (action, id) => `data-op="${esc(action)}" data-id="${esc(id)}"`;
    const button = (label, action, id = '', cls = 'dm-btn') =>
      `<button type="button" class="${cls}" ${flags(action, id)}>${esc(label)}</button>`;
    const option = (value, label, current) =>
      `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
    const badge = value => `<span class="dm-badge" data-status="${esc(term(value))}">${esc(value)}</span>`;
    const hasTaxTab = Object.hasOwn(taxonomyTabs,params.tab);
    const legacySubjectLink = !params.tab && params.subject && !params.domain;
    const taxTab = hasTaxTab ? params.tab : (legacySubjectLink ? 'subjects' : 'domains');
    const showAssignments = taxTab !== 'matrix' && (params.view === 'assignments' || params.tab === 'assignments' || (!hasTaxTab && (params.domain || params.subject)));
    const taxScope = area === 'taxonomy' ? JSON.stringify([taxTab,Boolean(showAssignments),params.domain || '',params.subject || '']) : '';
    if (taxScope && (state.taxScope !== taxScope || !host.querySelector('[data-ops-view="taxonomy"]'))) {
      state.editor = null;
      state.taxScope = taxScope;
    }
    const notice = state.notice?.area === area && (!taxScope || state.notice.scope === taxScope) ? state.notice.text : '';
    if (area === 'jobs') {
      state.job = params.job || '';
      state.tab = !state.job && params.tab === 'schedules' ? 'schedules' : 'runs';
    }

    function search(what, placeholder) {
      return `<label class="dm-field">Search<input type="search" data-search="${what}" placeholder="${esc(placeholder)}" value="${esc(state.searches[what])}"></label>`;
    }
    function filter(key, label, choices) {
      return `<label class="dm-field">${esc(label)}<select data-filter="${key}">
        ${choices.map(([id, name]) => option(id, name, state.filters[key] || '')).join('')}
      </select></label>`;
    }
    function grid(labels, rows, key, empty) {
      return `<div class="dm-table-wrap"><table class="dm-table"><thead><tr>
        ${labels.map(label => `<th scope="col">${esc(label)}</th>`).join('')}
        </tr></thead><tbody data-list="${key}">${rows.join('')}
        <tr data-empty><td colspan="${labels.length}" class="dm-muted">${esc(empty)}</td></tr>
        </tbody></table></div>`;
    }
    function runs() {
      const job = idOf(data.jobs, state.job);
      if (job) {
        const subject = idOf(datasets, job.datasetId);
        const latest = data.jobs.find(attempt => attempt.retryOf === job.id);
        return `<section class="dm-panel dm-job-detail"><div class="dm-head">
          <h2 tabindex="-1" data-focus-heading>${esc(job.id)}</h2>
          ${badge(job.status)}</div><dl class="dm-kv">
          <dt>Operation</dt><dd>${esc(jobLabels[job.type] || job.type)}</dd>
          <dt>Dataset</dt><dd>${esc(jobDataset(job) || '—')}</dd>
          <dt>Source</dt><dd>${esc(sourceName(job.sourceId || subject?.sourceId))}</dd>
          <dt>Started</dt><dd>${esc(displayTime(job.createdAt))}</dd>
          <dt>Trigger</dt><dd>${job.retryOf ? 'Retry' : esc(job.trigger || 'On demand')}</dd>
          ${job.batchId ? `<dt>Batch</dt><dd>${esc(job.batchId)}</dd>` : ''}
          ${job.retryOf ? `<dt>Retry of</dt><dd>${esc(job.retryOf)}</dd>` : ''}
          ${latest ? `<dt>Latest retry</dt><dd>${esc(latest.id)} · ${esc(latest.status)}</dd>` : ''}
          <dt>Result</dt><dd>${esc(job.detail || 'No detail recorded.')}</dd></dl>
          <div class="dm-actions">${canRetry(job) ? button('Retry job', 'retry', job.id, 'dm-btn dm-primary') : ''}
          ${button('Back to job history', 'close-job', job.id)}</div></section>`;
      }
      const jobs = [...data.jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const rows = jobs.map(job => `<tr data-row data-match="${esc([job.id, job.batchId, assetName(job), sourceName(job.sourceId), jobLabels[job.type] || job.type].join(' '))}" data-status="${esc(job.status)}" data-type="${esc(job.type)}">
        <td>${button(job.id, 'inspect', job.id, 'dm-link')}</td><td>${esc(jobLabels[job.type] || job.type)}</td>
        <td>${esc(assetName(job))}</td><td>${badge(job.status)}</td><td>${esc(displayTime(job.createdAt))}</td>
        <td>${canRetry(job) ? button('Retry', 'retry', job.id) : button('Inspect', 'inspect', job.id)}</td></tr>`);
      return `<section class="dm-panel">
        <div class="dm-toolbar">${search('jobs', 'Job ID or asset')}
          ${filter('jobStatus', 'Status', [['', 'All statuses'], ...jobStatuses.map(s => [s, s])])}
          ${filter('jobType', 'Job type', [['', 'All types'], ...Object.entries(jobLabels)])}</div>
        ${grid(['Job', 'Type', 'Asset', 'Status', 'Started', 'Actions'], rows, 'jobs', 'No jobs match these filters.')}
        </section>`;
    }
    function schedules() {
      const editing = idOf(active,params.dataset);
      if (editing) return `<header class="dm-head"><h2 tabindex="-1" data-schedule-heading>${esc(editing.name)}</h2>
        ${button('All schedules','tab','schedules')}</header><div data-schedule-editor></div>`;
      const rows = active.map(dataset => {
        const enabled = !!dataset.schedule?.enabled;
        return `<tr data-row data-match="${esc(dataset.name + ' ' + sourceName(dataset.sourceId))}" data-schedule="${enabled ? 'enabled' : 'manual'}">
          <td>${esc(dataset.name)}</td><td>${esc(sourceName(dataset.sourceId))}</td>
          <td>${badge(enabled ? 'Enabled' : 'Manual')}</td>
          <td>${esc(enabled ? jobLabels[dataset.schedule.type] || 'Data refresh' : '—')}</td>
          <td>${esc(enabled ? window.DataSchedule.description(dataset.schedule) : 'On demand')}</td>
          <td>${esc(enabled ? window.DataSchedule.display(dataset.schedule.nextAt,window.DataSchedule.settings(dataset.schedule).zone) : '—')}</td>
          <td>${button(enabled ? 'Edit schedule' : 'Set schedule', 'schedule', dataset.id)}</td></tr>`;
      });
      if (params.new === '1') return `<section class="dm-panel"><div class="dm-head"><h2>Schedule a dataset job</h2>
        ${button('All schedules','tab','schedules')}</div>
        ${active.length ? `<form data-schedule-picker><label class="dm-field">Dataset<select name="dataset" aria-label="Dataset">
        ${active.map(ds => option(ds.id,ds.name + ' · ' + ds.layer,'')).join('')}</select></label>
        <div class="dm-actions"><button type="submit" class="dm-btn dm-primary">Continue to schedule</button></div></form>` : '<p class="dm-muted">Create an active dataset to schedule its jobs.</p>'}</section>`;
      const unavailable = params.dataset ? '<p class="dm-notice" role="status">This dataset is unavailable for scheduling.</p>' : '';
      return unavailable + `<section class="dm-panel"><div class="dm-toolbar">${search('schedules', 'Dataset or source')}
        ${filter('scheduleState', 'Schedule', [['', 'All schedules'], ['enabled', 'Enabled'], ['manual', 'Manual']])}</div>
        ${grid(['Dataset', 'Source', 'Schedule', 'Operation', 'Recurrence', 'Next run', 'Actions'], rows, 'schedules', 'No active datasets match these filters.')}</section>`;
    }
    function jobsPage() {
      const canAddSchedule = state.tab === 'schedules' && !params.dataset && !params.new;
      return `<h1 class="sr-only">Jobs</h1><div class="dm-list-actions"><div class="dm-tabs" role="group" aria-label="Job views">
        ${[['runs', 'Job history'], ['schedules', 'Dataset schedules']].map(([key, label]) =>
          `<button type="button" class="dm-btn" ${flags('tab', key)} aria-pressed="${state.tab === key}">${label}</button>`).join('')}
        </div>${canAddSchedule ? button('Schedule a job','new-schedule','','dm-btn dm-primary') : ''}</div>
        ${state.tab === 'schedules' ? schedules() : runs()}`;
    }
    function assetRows() {
      return [
        ...active.map(asset => ({kind:'dataset',id:asset.id,name:asset.name,pairId:asset.domainSubjectId || ''})),
        ...sources.map(asset => ({kind:'source',id:asset.id,name:asset.name,pairId:data.sourceDomainSubjects[asset.id] || ''}))
      ];
    }
    const allPairs = area === 'taxonomy' ? data.domainSubjects : [];
    const pairs = new Map(allPairs.map(pair => [pair.id,pair]));
    const domainNames = new Map(data.domains.map(domain => [domain.id,domain.name]));
    const subjectNames = new Map(data.subjects.map(subject => [subject.id,subject.name]));
    const pathName = pair => domainNames.get(pair.domainId) + ' / ' + subjectNames.get(pair.subjectId);
    function pairOptions(current) {
      const available = allPairs.filter(pair => pair.active || pair.id === current);
      available.sort((a,b) => pathName(a).localeCompare(pathName(b)));
      return option('','Unassigned',current) + available.map(pair =>
        option(pair.id,pathName(pair) + (pair.active ? '' : ' (retired)'),current)).join('');
    }
    function assignmentEditor() {
      const editor = state.editor;
      if (!editor) return '';
      const list = assetRows().filter(asset => asset.kind === editor.type);
      return `<section class="dm-panel dm-editor"><h2>Assign asset</h2>
        <form data-assignment-editor><div class="dm-grid">
          <label class="dm-field">Asset type<select name="assetType">${option('dataset', 'Dataset', editor.type)}${option('source', 'Source', editor.type)}</select></label>
          <label class="dm-field">Asset<select name="assetId" required>${!list.length ? '<option value="">No active assets</option>' : ''}${list.map(asset => option(asset.id, asset.name, editor.assetId)).join('')}</select></label>
          <label class="dm-field">Domain / Subject<select name="pairId">${pairOptions(editor.pairId)}</select></label>
        </div><div class="dm-actions"><button type="submit" class="dm-btn dm-primary">Save assignment</button>${button('Cancel','cancel-edit')}</div></form></section>`;
    }
    function assignmentFilter(name,items,emptyLabel) {
      const current = params[name] || '';
      const options = [...items].sort((a,b) => a.name.localeCompare(b.name)).map(item => option(item.id,item.name,current));
      if (name === 'subject') options.push(option('unassigned','Unassigned',current));
      if (current && !items.some(item => item.id === current) && !(name === 'subject' && current === 'unassigned')) {
        options.push(option(current,'Unavailable ' + name,current));
      }
      const label = name === 'domain' ? 'Domain' : 'Subject';
      return `<label class="dm-field">${label}<select data-tax-filter="${name}">${option('',emptyLabel,current)}${options.join('')}</select></label>`;
    }
    function assignmentPanel() {
      const assets = assetRows();
      const hasActivePairs = allPairs.some(pair => pair.active);
      const rows = [];
      for (const asset of assets) {
        const pair = pairs.get(asset.pairId);
        if (params.domain && params.domain !== pair?.domainId) continue;
        if (params.subject && params.subject !== (pair?.subjectId || 'unassigned')) continue;
        const domain = pair && domainNames.get(pair.domainId);
        const subject = pair && subjectNames.get(pair.subjectId);
        const action = hasActivePairs || pair ? `<button type="button" class="dm-btn" ${flags('assign',asset.id)} data-kind="${asset.kind}">${pair ? 'Edit assignment' : 'Assign'}</button>` : '—';
        rows.push(`<tr data-row data-match="${esc([asset.name,domain,subject].join(' '))}" data-kind="${asset.kind}">
          <td>${esc(asset.name)}</td><td>${asset.kind === 'dataset' ? 'Dataset' : 'Source'}</td>
          <td>${esc(domain || '—')}</td><td>${esc(subject || 'Unassigned')} ${pair && !pair.active ? badge('Retired') : ''}</td><td>${action}</td></tr>`);
      }
      const backLabel = 'Back to ' + taxonomyTabs[taxTab];
      return `<div class="dm-head"><div class="dm-toolbar">
          <button type="button" class="dm-back-icon" ${flags('assignments-back',taxTab)} aria-label="${backLabel}" title="${backLabel}"><span aria-hidden="true">←</span></button>
          <h2 tabindex="-1" data-assignment-heading>Asset assignments</h2></div>
          ${assets.length && hasActivePairs ? button('Assign asset','assign','','dm-btn dm-primary') : ''}</div>
        ${assignmentEditor()}<section class="dm-tax-assets" aria-label="Assigned sources and datasets">
        ${hasActivePairs ? '' : '<p class="dm-muted">To enable an assignment, edit a subject and select its linked domains.</p>'}
        <div class="dm-toolbar">${search('assignments','Asset, domain or subject')}
          ${filter('assetKind','Asset type',[['','All assets'],['dataset','Datasets'],['source','Sources']])}
          ${assignmentFilter('domain',data.domains,'All domains')}${assignmentFilter('subject',data.subjects,'All subjects')}</div>
        ${grid(['Asset','Type','Domain','Subject','Actions'],rows,'assignments','No active assets match these filters.')}</section>`;
    }
    function taxonomyPage() {
      const tabs = Object.entries(taxonomyTabs).map(([id,name]) =>
        `<button type="button" class="dm-btn" ${flags('taxonomy-tab',id)} aria-pressed="${taxTab === id}">${name}</button>`).join('');
      const content = showAssignments ? assignmentPanel() : taxTab === 'matrix' ? '<div data-tax-matrix></div>' : '<div data-tax-definitions></div>';
      return `<h1 class="sr-only">Taxonomy</h1><div class="dm-tabs" role="group" aria-label="Taxonomy views">${tabs}</div>${content}`;
    }
    function archivePage() {
      const rows = datasets.filter(dataset => dataset.archived).sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt))).map(dataset => {
        const storage = (data.storageLocations || []).find(location => location.id === dataset.storage)?.name || dataset.storage;
        return `<tr data-row data-match="${esc([dataset.name, dataset.id, sourceName(dataset.sourceId), storage].join(' '))}">
          <td>${esc(dataset.name)}</td><td>${esc(sourceName(dataset.sourceId))}</td>
          <td>${esc(storage || '—')}</td><td>${esc(displayTime(dataset.archivedAt))}</td>
          <td>${button('Restore', 'restore', dataset.id)}</td></tr>`;
      });
      return `<h1 class="sr-only">Archive</h1><section class="dm-panel">
        <div class="dm-toolbar">${search('archive', 'Dataset, source or storage')}</div>
        ${grid(['Dataset', 'Source', 'Storage', 'Archived', 'Actions'], rows, 'archive', rows.length ? 'No archived datasets match your search.' : 'No archived datasets.')}
        <details class="dm-muted"><summary>What changes when I archive or restore a dataset?</summary><p>Archiving retains data and settings, pauses schedules and disables retrieval. Restored tables can be queried immediately. Rebuild a restored document index to enable retrieval. Schedules stay paused until you enable them.</p></details></section>`;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'dm-operations';
    wrapper.dataset.opsView = area;
    wrapper.innerHTML = `<div class="dm-notice" role="status"${notice ? '' : ' hidden'}>${esc(notice)}</div>` +
      (area === 'taxonomy' ? taxonomyPage() : area === 'archive' ? archivePage() : jobsPage());
    host.replaceChildren(wrapper);
    const matrix = wrapper.querySelector('[data-tax-matrix]');
    if (matrix) window.TaxonomyMatrix.mount(matrix,{store,assets:assetRows()});
    const definitions = wrapper.querySelector('[data-tax-definitions]');
    if (definitions) window.TaxonomyDefinitions.mount(definitions,{
      ...ctx,kind:taxTab === 'domains' ? 'domain' : 'subject',assets:assetRows(),openAssignments
    });
    function openAssignments(filters = {}) {
      const next = {tab:taxTab,view:'assignments'};
      if (filters.domain) next.domain = filters.domain;
      if (filters.subject) next.subject = filters.subject;
      go('taxonomy',next);
      host.querySelector('[data-assignment-heading]')?.focus();
    }
    const scheduleEditor = wrapper.querySelector('[data-schedule-editor]');
    if (scheduleEditor) window.DataScheduleView.render(scheduleEditor,{store,esc,dataset:idOf(active,params.dataset)});
    function editSchedule(id) {
      go('jobs',{tab:'schedules',dataset:id});
      host.querySelector('[data-schedule-heading]')?.focus();
    }
    function applyFilters() {
      for (const list of wrapper.querySelectorAll('[data-list]')) {
        const name = list.dataset.list;
        const query = term(state.searches[name]);
        const pairs = name === 'jobs' ? [['status', 'jobStatus'], ['type', 'jobType']]
          : name === 'schedules' ? [['schedule', 'scheduleState']]
          : name === 'assignments' ? [['kind', 'assetKind']] : [];
        let count = 0;
        for (const row of list.querySelectorAll('[data-row]')) {
          row.hidden = !term(row.dataset.match).includes(query) || pairs.some(([attr, key]) =>
            state.filters[key] && row.dataset[attr] !== state.filters[key]);
          if (!row.hidden) count++;
        }
        list.querySelector('[data-empty]').hidden = count > 0;
      }
    }
    function repaint(focus) {
      render(host, ctx);
      if (focus) host.querySelector(focus)?.focus();
    }
    function committed(message) {
      state.notice = {area, text: message,scope:taxScope};
      ctx.refresh();
    }
    function showError(err) {
      const banner = wrapper.querySelector('.dm-notice');
      banner.hidden = false;
      banner.textContent = err.message || 'The change could not be saved.';
      banner.setAttribute('role', 'alert');
      banner.scrollIntoView({block: 'nearest'});
    }
    wrapper.addEventListener('input', event => {
      const key = event.target.dataset.search;
      if (key) { state.searches[key] = event.target.value; applyFilters(); }
    });
    wrapper.addEventListener('change', event => {
      const control = event.target;
      if (control.dataset.filter) {
        state.filters[control.dataset.filter] = control.value;
        applyFilters();
      } else if (control.dataset.taxFilter) {
        openAssignments({...params,[control.dataset.taxFilter]:control.value});
        host.querySelector('[data-tax-filter="' + control.dataset.taxFilter + '"]')?.focus();
      } else if (control.name === 'assetType') {
        state.editor.type = control.value;
        const first = assetRows().find(asset => asset.kind === control.value);
        state.editor.assetId = first?.id || '';
        state.editor.pairId = first?.pairId || '';
        repaint('[name="assetType"]');
      } else if (control.name === 'assetId') {
        const asset = assetRows().find(row => row.kind === state.editor.type && row.id === control.value);
        state.editor.assetId = control.value;
        state.editor.pairId = asset?.pairId || '';
        control.form.elements.pairId.innerHTML = pairOptions(state.editor.pairId);
      }
    });
    wrapper.addEventListener('click', event => {
      const target = event.target.closest('[data-op]');
      if (!target || !wrapper.contains(target)) return;
      const {op, id, kind} = target.dataset;
      try {
        switch (op) {
          case 'schedule': editSchedule(id); return;
          case 'new-schedule': go('jobs',{tab:'schedules',new:'1'}); host.querySelector('[data-schedule-picker] select')?.focus(); return;
          case 'tab': go('jobs',{tab:id}); return;
          case 'inspect': go('jobs',{job:id}); host.querySelector('[data-focus-heading]')?.focus(); return;
          case 'close-job': {
            go('jobs',{tab:'runs'});
            Array.from(host.querySelectorAll('[data-op="inspect"]')).find(control => control.dataset.id === id)?.focus();
            return;
          }
          case 'retry': {
            try {
              const retryId = store.retry(id);
              const next = idOf(store.snapshot().jobs, retryId);
              committed(next ? 'Retry ' + next.id + ' for ' + id + ' · ' + next.status + '.' : 'Retry requested for ' + id + '.');
            } catch (err) {
              // A failed execution is recorded too. Refresh its parent without leaving this view.
              committed(err.message || 'The retry could not be completed.');
            }
            return;
          }
          case 'restore': {
            store.restore(id);
            const restored = idOf(store.snapshot().datasets, id);
            committed(restored.name + ' restored to Datasets. ' +
              (restored.dataType === 'table' ? 'Structured lookup is available.' : 'Rebuild the index to resume document search.') +
              ' Schedule is ' + (restored.schedule?.enabled ? restored.schedule.frequency : 'Manual') + '.');
            return;
          }
          case 'taxonomy-tab':
          case 'assignments-back':
            go('taxonomy',id === 'domains' ? {} : {tab:id});
            host.querySelector('[data-op="taxonomy-tab"][aria-pressed="true"]')?.focus();
            return;
          case 'assign': {
            const allAssets = assetRows();
            const asset = id ? allAssets.find(row => row.kind === kind && row.id === id) : allAssets[0];
            if (!asset) return;
            state.editor = {type:asset.kind,assetId:asset.id,pairId:asset.pairId};
            break;
          }
          case 'cancel-edit': state.editor = null; repaint('[data-assignment-heading]'); return;
          default: return;
        }
        state.notice = null;
        repaint('[data-assignment-editor] select');
      } catch (err) { showError(err); }
    });
    wrapper.addEventListener('submit', event => {
      if (event.target.matches('[data-schedule-picker]')) {
        event.preventDefault();
        editSchedule(event.target.elements.namedItem('dataset').value);
        return;
      }
      if (!event.target.matches('[data-assignment-editor]')) return;
      event.preventDefault();
      const values = new FormData(event.target);
      try {
        const asset = assetRows().find(a => a.kind === values.get('assetType') && a.id === values.get('assetId'));
        if (!asset) throw new Error('Choose an active asset.');
        const pairId = values.get('pairId') || '';
        if (asset.pairId !== pairId) store.assignAssetPair(asset.kind,asset.id,pairId);
        const pair = pairs.get(pairId);
        const message = pair ? asset.name + ' assigned to ' + pathName(pair) + '.' : asset.name + ' is unassigned.';
        state.editor = null;
        committed(message);
        host.querySelector('[data-assignment-heading]')?.focus();
      } catch (err) { showError(err); }
    });
    applyFilters();
  }
  window.DataOpsView = {render};
})();
