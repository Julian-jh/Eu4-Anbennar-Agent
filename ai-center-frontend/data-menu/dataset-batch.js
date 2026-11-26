/* Batch task selection, execution receipts. */
(() => {
  'use strict';

  function actions({store,getSelected,refresh,status},ui) {
    const {node,button,field,select,group} = ui;
    const run = button('Run selected',openRun);
    run.dataset.batchAction = 'run';
    function count(n,label) { return n + ' ' + label + (n === 1 ? '' : 's'); }

    function openRun() {
      const records = getSelected();
      if (!records.length) return;
      const tables = records.filter(ds => ds.dataType === 'table').length;
      const documents = records.length - tables;
      const dialog = node('dialog',null,'dm-bulk-dialog');
      const heading = node('h2','Run tasks for ' + count(records.length,'dataset'));
      heading.id = 'dm-batch-run-title';
      dialog.setAttribute('aria-labelledby',heading.id);
      const task = select([['refresh','Refresh data'],['ingest','Ingest or materialize data'],['rebuild','Rebuild document indexes']],'refresh');
      task.querySelector('option[value="rebuild"]').disabled = !documents;
      const summary = node('p');
      summary.setAttribute('role','status');
      const detail = node('details');
      detail.append(node('summary','Selected datasets (' + records.length + ')'));
      const names = node('ul');
      for (const ds of records) names.append(node('li',ds.name));
      detail.append(names);
      const error = node('p',null,'dm-notice');
      error.setAttribute('role','alert');
      error.hidden = true;
      function describe() {
        error.hidden = true;
        if (task.value === 'rebuild') {
          summary.textContent = count(documents,'document dataset') + ' will rebuild a retrieval index.' +
            (tables ? ' ' + count(tables,'structured table') + ' will be skipped.' : '');
        } else {
          summary.textContent = (task.value === 'ingest' ? 'Load records from each input.' : 'Refresh the selected datasets from their inputs.') +
            ' Selected upstream datasets run before their dependents.';
        }
      }
      function showResults(batch) {
        heading.textContent = 'Batch run results';
        heading.tabIndex = -1;
        const totals = new Map();
        const results = node('ol',null,'dm-batch-results');
        for (const entry of batch.results) {
          totals.set(entry.status,(totals.get(entry.status) || 0) + 1);
          const item = node('li');
          item.append(node('strong',entry.name),node('p',entry.status + ' · ' + entry.jobId),node('p',entry.detail,'dm-muted'));
          results.append(item);
        }
        const tally = ['Succeeded','Failed','Skipped'].filter(s => totals.has(s)).map(s => totals.get(s) + ' ' + s.toLowerCase()).join(' · ');
        const batchNumber = node('p','Batch ID · ' + batch.batchId,'dm-catalog-path');
        dialog.replaceChildren(heading,node('p',tally),results,batchNumber,group('dm-actions',button('Done',() => dialog.close())));
        refresh();
        heading.focus();
      }
      const confirm = button('Run tasks',() => {
        try {showResults(store.runBatch(records.map(ds => ds.id),task.value));}
        catch (cause) {error.hidden = false;error.textContent = cause.message || 'The batch could not start.';}
      },true);
      const cancel = button('Cancel',() => dialog.close());
      dialog.append(heading,field('Task type',task),summary,detail,error,group('dm-actions',cancel,confirm));
      task.addEventListener('change',describe);
      describe();
      const closeOnNavigation = () => dialog.close();
      window.addEventListener('hashchange',closeOnNavigation);
      dialog.addEventListener('close',() => {
        dialog.remove();
        window.removeEventListener('hashchange',closeOnNavigation);
        const target = run.isConnected ? run : document.querySelector('[data-batch-action="run"]');
        if (target?.getClientRects().length) target.focus();
      },{once:true});
      document.body.append(dialog);
      dialog.showModal();
      task.focus();
    }
    return [run];
  }
  window.DatasetBatch = {actions};
})();
