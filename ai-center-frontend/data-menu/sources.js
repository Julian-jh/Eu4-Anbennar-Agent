(() => {
  'use strict';
  function render(host,{source,store,esc,refresh}) {
    const data = store.snapshot();
    const jobs = data.jobs.filter(job => job.sourceId === source.id && ['sync','test'].includes(job.type));
    const linked = data.datasets.filter(ds => !ds.upstreamId && ds.sourceId === source.id);
    const latest = type => {
      const job = jobs.find(j => j.type === type);
      if (!job) return type === 'test' ? 'Untested' : 'Never synced';
      return 'Simulated · ' + job.status + ' · ' + new Date(job.createdAt).toLocaleString();
    };
    host.innerHTML = `<div class="dm-source-sections">
      <section class="dm-panel"><div class="dm-head"><h2>Connection health</h2>
        <div class="dm-actions"><button type="button" class="dm-btn" data-cmd="edit">Edit connection</button>
        <button type="button" class="dm-btn" data-cmd="test">Test connection</button>
        <button type="button" class="dm-btn dm-primary" data-cmd="sync">Sync now</button></div></div>
        <dl class="dm-kv"><dt>Last test</dt><dd>${esc(latest('test'))}</dd><dt>Last sync</dt><dd>${esc(latest('sync'))}</dd></dl>
        <p class="dm-muted">Tests validate the local sample settings. Sync refreshes the sample inventory. Live connectivity has not been verified.</p>
        <output class="dm-source-feedback" aria-live="polite"></output>
      </section>
      <section class="dm-panel"><h2>Linked datasets</h2>${linked.length ?
        '<ul class="dm-source-list">' + linked.map(ds => '<li>' + esc(ds.name) + ' <span class="dm-muted"> · ' + esc(data.storageLocations.find(s => s.id === ds.storage)?.name || ds.storage) + (ds.archived ? ' · Archived' : '') + '</span></li>').join('') + '</ul>' :
        '<p class="dm-muted">No dataset uses this source yet.</p>'}</section></div>`;
    function feedback(text) {
      const output = host.querySelector('.dm-source-feedback');
      if (output) output.textContent = text;
    }
    host.onclick = event => {
      const button = event.target.closest('button');
      if (!button) return;
      const cmd = button.dataset.cmd;
      if (cmd === 'edit') {
        window.SourceEditor.open({source,onSave(record) {
          store.editSource(source.id,record);
          refresh();
          feedback(source.kind === 'database' ? 'Connection saved. Simulated test passed.' : 'Source settings saved.');
        }});
        return;
      }
      if (cmd === 'sync' || cmd === 'test') {
        try {
          store.sourceRun(source.id,cmd);
          refresh();
          feedback(cmd === 'test' ? 'Simulated connection test passed.' : 'Local sample inventory synchronized.');
        } catch (e) { feedback(e.message); }
      }
    };
  }
  window.DataSourceView = {render};
})();
