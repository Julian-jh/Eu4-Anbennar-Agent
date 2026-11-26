(() => {
  'use strict';
  function render(host,{source,store,esc,refresh}) {
    const data = store.snapshot();
    const jobs = data.jobs.filter(job => job.sourceId === source.id && ['sync','test'].includes(job.type));
    const linked = data.datasets.filter(ds => !ds.upstreamId && ds.sourceId === source.id);
    const latest = type => {
      const job = jobs.find(j => j.type === type);
      if (!job) return type === 'test' ? 'Untested' : 'Never synced';
      return job.status + ' · ' + new Date(job.createdAt).toLocaleString();
    };
    host.innerHTML = `<div class="dm-source-sections">
      <section class="dm-panel"><div class="dm-head"><h2>Connection health</h2>
        <div class="dm-actions"><button type="button" class="dm-btn" data-cmd="test">Test connection</button>
        <button type="button" class="dm-btn dm-primary" data-cmd="sync">Sync now</button></div></div>
        <dl class="dm-kv"><dt>Last test</dt><dd>${esc(latest('test'))}</dd><dt>Last sync</dt><dd>${esc(latest('sync'))}</dd></dl>
        <p class="dm-muted">Sync updates the source inventory. Each dataset controls when it imports documents.</p>
        <output class="dm-source-feedback" aria-live="polite"></output>
      </section>
      <section class="dm-panel"><h2>Linked datasets</h2>${linked.length ?
        '<ul class="dm-source-list">' + linked.map(ds => '<li>' + esc(ds.name) + ' <span class="dm-muted"> · ' + esc(data.storageLocations.find(s => s.id === ds.storage)?.name || ds.storage) + (ds.archived ? ' · Archived' : '') + '</span></li>').join('') + '</ul>' :
        '<p class="dm-muted">No dataset uses this source yet.</p>'}</section>
      <details class="dm-panel dm-source-editor"><summary>Edit connection</summary>
        <form><div class="dm-grid">
        <label class="dm-field">Source name<input name="name" required maxlength="100" value="${esc(source.name)}"></label>
        <label class="dm-field">Location<input name="loc" type="${source.kind === 'url' ? 'url' : 'text'}" required value="${esc(source.loc)}"></label>
        <label class="dm-field">Credential alias<input name="credential" required value="${esc(source.credential)}"></label>
        </div><div class="dm-actions"><button class="dm-btn dm-primary" type="submit">Save connection</button></div>
        <output aria-live="polite"></output></form></details></div>`;
    function feedback(text) {
      const output = host.querySelector('.dm-source-feedback');
      if (output) output.textContent = text;
    }
    host.onclick = event => {
      const button = event.target.closest('button');
      if (!button) return;
      const cmd = button.dataset.cmd;
      if (cmd === 'sync' || cmd === 'test') {
        try {
          store.sourceRun(source.id,cmd);
          refresh();
          feedback(cmd === 'test' ? 'Sample connection test passed.' : 'Source inventory synchronized.');
        } catch (e) { feedback(e.message); }
      }
    };
    host.onsubmit = event => {
      event.preventDefault();
      const form = event.target;
      try {
        store.editSource(source.id,Object.fromEntries(new FormData(form)));
        refresh();
        feedback('Connection settings saved.');
      } catch (e) { form.querySelector('output').textContent = e.message; }
    };
  }
  window.DataSourceView = {render};
})();
