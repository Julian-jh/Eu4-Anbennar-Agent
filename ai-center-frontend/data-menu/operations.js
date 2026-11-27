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
      tab: 'runs', job: '',
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
    const legacyTaxonomy = !Object.hasOwn(params,'folders') && (params.domain || params.subject || params.view === 'assignments' || params.tab === 'assignments');
    const requestedTab = params.tab === 'coverage' ? 'matrix' : params.tab;
    let taxTab = Object.hasOwn(taxonomyTabs,requestedTab) ? requestedTab : 'domains';
    if (legacyTaxonomy && taxTab !== 'matrix') {
      if (params.subject && !params.domain) taxTab = 'subjects';
      if (params.domain && !params.subject) taxTab = 'domains';
    }
    const notice = state.notice?.area === area ? state.notice.text : '';
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
        ...active.map(({id,name,domainId,subjectIds}) => ({kind:'dataset',id,name,domainId,subjectIds})),
        ...sources.map(({id,name}) => ({kind:'source',id,name,domainId:data.sourceDomainIds[id] || '',subjectIds:data.sourceSubjectIds[id] || []}))
      ];
    }
    function mountDefinitions(host) {
      const kind = taxTab === 'subjects' ? 'subject' : 'domain';
      const records = kind === 'subject' ? data.subjects : data.domains;
      const allowed = new Set([...records.map(record => record.id),':unassigned']);
      const validated = values => Array.isArray(values) ? [...new Set(values.filter(id => allowed.has(id)))] : [];
      let openFolderIds = [];
      if (legacyTaxonomy) {
        const selected = params[kind];
        openFolderIds = selected ? validated([selected === 'unassigned' ? ':unassigned' : selected]) : [...allowed];
      } else if (params.folders) {
        try { openFolderIds = validated(JSON.parse(params.folders)); }
        catch { /* Malformed folder URLs open the list with its folders collapsed. */ }
      }
      const assetFilter = legacyTaxonomy && params.domain && params.subject ? {domain:params.domain,subject:params.subject} : undefined;
      window.TaxonomyDefinitions.mount(host,{
        ...ctx,data,kind,assets:assetRows(),openFolderIds,assetFilter,
        changeFolders(ids) {
          const next = validated(ids);
          go('taxonomy',next.length ? {tab:taxTab,folders:JSON.stringify(next)} : {tab:taxTab});
        }
      });
    }
    function taxonomyPage() {
      const tabs = Object.entries(taxonomyTabs).map(([id,name]) =>
        `<button type="button" class="dm-btn" ${flags('taxonomy-tab',id)} aria-pressed="${taxTab === id}">${name}</button>`).join('');
      const content = taxTab === 'matrix' ? '<div data-tax-matrix></div>' : '<div data-tax-definitions></div>';
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
    if (matrix) window.Taxonomy.mountMatrix(matrix,data.domains,data.subjects,active);
    const definitions = wrapper.querySelector('[data-tax-definitions]');
    if (definitions) mountDefinitions(definitions);
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
          : name === 'schedules' ? [['schedule', 'scheduleState']] : [];
        let count = 0;
        for (const row of list.querySelectorAll('[data-row]')) {
          row.hidden = !term(row.dataset.match).includes(query) || pairs.some(([attr, key]) =>
            state.filters[key] && row.dataset[attr] !== state.filters[key]);
          if (!row.hidden) count++;
        }
        list.querySelector('[data-empty]').hidden = count > 0;
      }
    }
    function committed(message) {
      state.notice = {area,text:message};
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
      }
    });
    wrapper.addEventListener('click', event => {
      const target = event.target.closest('[data-op]');
      if (!target || !wrapper.contains(target)) return;
      const {op,id} = target.dataset;
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
            go('taxonomy',id === 'domains' ? {} : {tab:id});
            host.querySelector('[data-op="taxonomy-tab"][aria-pressed="true"]')?.focus();
            return;
          default: return;
        }
      } catch (err) { showError(err); }
    });
    wrapper.addEventListener('submit', event => {
      if (event.target.matches('[data-schedule-picker]')) {
        event.preventDefault();
        editSchedule(event.target.elements.namedItem('dataset').value);
        return;
      }
    });
    applyFilters();
  }
  window.DataOpsView = {render};
})();
