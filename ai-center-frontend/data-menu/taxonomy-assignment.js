(() => {
  'use strict';

  function open(host,{store,asset,refresh,onSaved}) {
    const data = store.snapshot();
    const domains = new Map(data.domains.map(row => [row.id,row.name]));
    const subjects = new Map(data.subjects.map(row => [row.id,row.name]));
    const label = pair => domains.get(pair.domainId) + ' / ' + subjects.get(pair.subjectId);
    const available = data.domainSubjects.filter(pair => pair.active || pair.id === asset.pairId)
      .sort((a,b) => label(a).localeCompare(label(b)));

    const dialog = document.createElement('dialog');
    dialog.className = 'dm-bulk-dialog';
    dialog.setAttribute('aria-labelledby','td-assignment-title');
    dialog.innerHTML = `<h2 id="td-assignment-title">Asset assignment</h2>
      <p class="dm-muted" data-asset-name></p>
      <form class="td-form">
        <label class="dm-field">Domain / Subject<select name="pairId"></select></label>
        <p class="dm-muted" data-empty hidden>To assign this asset, first link a subject to a domain in Subjects.</p>
        <p class="dm-notice" role="alert" hidden></p>
        <div class="dm-actions"><button type="button" class="dm-btn" data-cancel>Cancel</button>
          <button type="submit" class="dm-btn dm-primary">Save assignment</button></div>
      </form>`;
    dialog.querySelector('[data-asset-name]').textContent = (asset.kind === 'source' ? 'Source' : 'Dataset') + ' · ' + asset.name;
    const select = dialog.querySelector('select');
    select.add(new Option('Unassigned',''));
    for (const pair of available) {
      const option = new Option(label(pair) + (pair.active ? '' : ' (retired)'),pair.id);
      option.disabled = !pair.active;
      select.add(option);
    }
    select.value = asset.pairId || '';
    dialog.querySelector('[data-empty]').hidden = available.some(pair => pair.active);
    host.append(dialog);
    dialog.addEventListener('close',() => dialog.remove(),{once:true});
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const target = select.value;
      if (target !== asset.pairId) {
        try { store.assignAssetPair(asset.kind,asset.id,target); }
        catch (error) {
          const message = dialog.querySelector('[role=alert]');
          message.hidden = false;
          message.textContent = error.message;
          return;
        }
      }
      dialog.close();
      refresh();
      onSaved?.();
    };
    dialog.showModal();
    select.focus();
  }
  window.TaxonomyAssignment = {open};
})();
