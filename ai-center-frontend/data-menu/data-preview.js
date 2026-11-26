/* Read materialized dataset contents a page at a time. */
(() => {
  'use strict';
  const format = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);

  function download(payload) {
    const file = new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = payload.layer.toLowerCase() + '-' + payload.datasetId + '.json';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url),1000);
  }

  function render(host,{dataset,store},{node,group,button,table}) {
    const isDocument = dataset.dataType === 'document';
    const section = node('section',null,'dm-panel dm-data-preview');
    const header = group('dm-preview-head',node('h2',isDocument ? 'Documents' : 'Records'));
    const origin = [dataset.sourceName,dataset.asset].filter(Boolean).join(' / ');
    if (origin) header.append(node('span',origin,'dm-muted'));
    section.append(header);
    host.replaceChildren(section);
    const error = node('p',null,'dm-notice');
    error.setAttribute('role','alert');
    error.hidden = true;
    section.append(error);
    const save = button('Download records',() => {
      try {error.hidden = true;download(store.exportRecords(dataset.id));}
      catch (cause) {error.textContent = cause.message;error.hidden = false;}
    });
    if (!dataset.archived) header.append(save);

    function inspect(doc, rowNumber, trigger) {
      const dialog = node('dialog',null,'dm-preview-dialog');
      const title = doc.title || (isDocument ? 'Document ' : 'Record ') + rowNumber;
      dialog.setAttribute('aria-label',title);
      const close = button('Close',() => dialog.close());
      dialog.append(group('dm-preview-head',node('h2',title),close),
        node('p','Source locator: ' + (doc.locator || 'Unavailable'),'dm-muted'));
      if (isDocument || !Object.keys(doc.values || {}).length) {
        dialog.append(node('p',doc.text || 'No document text is available.','dm-preview-text'));
      }
      const entries = Object.entries(doc.values || {});
      if (entries.length) dialog.append(table(['Field','Value'],entries.map(([k,v]) => [k,format(v)])));
      dialog.addEventListener('close',() => {dialog.remove();if (trigger.isConnected) trigger.focus();},{once:true});
      section.append(dialog);
      dialog.showModal();
      close.focus();
    }

    const viewport = node('div',null,'dm-preview-page');
    let pages = 0;
    let page = 1;
    const nav = node('nav',null,'dm-preview-pages');
    nav.setAttribute('aria-label','Preview pagination');
    const range = node('span',null,'dm-muted');
    range.setAttribute('role','status');
    const previous = button('Previous',() => draw(page-1));
    const next = button('Next',() => draw(page+1));
    const jump = node('form',null,'dm-preview-jump');
    let pageInput;
    jump.addEventListener('submit',e => {e.preventDefault();draw(Number(pageInput.value));});
    nav.append(range,previous,jump,next);
    section.append(viewport,nav);

    function updatePicker(count) {
      pages = count;
      const picker = node('label',null,'dm-preview-picker');
      picker.append(node('span','Page'));
      // Bound the number of navigation controls even for a large local dataset.
      const compact = pages <= 100;
      pageInput = node(compact ? 'select' : 'input');
      pageInput.setAttribute('aria-label','Preview page');
      if (compact) {
        for (let i=1;i<=pages;i++) pageInput.add(new Option(String(i),String(i)));
        pageInput.addEventListener('change',() => draw(Number(pageInput.value)));
      } else {
        Object.assign(pageInput,{type:'number',min:1,max:pages,step:1,required:true});
      }
      pageInput.disabled = pages === 1;
      picker.append(pageInput,node('span','of ' + pages));
      jump.replaceChildren(picker);
      if (!compact) {
        const submit = node('button','Go','dm-btn');
        submit.type = 'submit';
        jump.append(submit);
      }
    }
    function draw(requested) {
      let result;
      try {result = store.previewPage(dataset.id,requested);}
      catch (cause) {
        viewport.replaceChildren();
        save.hidden = nav.hidden = true;
        error.textContent = cause.message;
        error.hidden = false;
        return;
      }
      error.hidden = true;
      const {count,offset,records,pageCount} = result;
      page = result.page;
      save.hidden = nav.hidden = count === 0;
      if (!count) {
        const empty = isDocument ? 'No documents are available.' : 'No records are available.';
        const nextStep = dataset.archived ? 'This archived dataset has no retained data.' : dataset.upstreamId
          ? 'Materialize this dataset from Overview to preview its records.' : 'Ingest the source from Overview to populate the preview.';
        viewport.replaceChildren(node('p',empty + ' ' + nextStep,'dm-muted'));
        return;
      }
      if (pageCount !== pages) updatePicker(pageCount);
      const fields = isDocument ? [] : [...new Set([...dataset.fields,...records.flatMap(d => Object.keys(d.values || {}))])];
      const headers = isDocument ? ['#','Document','Excerpt','Source locator'] : ['#',...fields,'Source locator','Details'];
      const rows = records.map((doc,index) => {
        const ordinal = offset + index + 1;
        const title = doc.title || 'Document ' + ordinal;
        const read = button(isDocument ? title : 'View record',() => inspect(doc,ordinal,read));
        const locator = doc.locator || 'Unavailable';
        if (isDocument) {
          const excerpt = String(doc.values?.excerpt ?? doc.values?.sample_text ?? doc.text ?? '');
          return [ordinal,read,excerpt.length > 180 ? excerpt.slice(0,180) + '…' : excerpt || '—',locator];
        }
        read.setAttribute('aria-label','View record ' + ordinal);
        return [ordinal,...fields.map(f => format(Object.hasOwn(doc.values || {},f) ? doc.values[f] : null)),locator,read];
      });
      const grid = table(headers,rows);
      grid.querySelector('table').setAttribute('aria-label',isDocument ? 'Dataset documents' : 'Dataset records');
      viewport.replaceChildren(grid);
      range.textContent = (isDocument ? 'Documents ' : 'Records ') + (offset+1) + '–' + (offset+records.length) + ' of ' + count;
      pageInput.value = String(page);
      previous.disabled = page === 1;
      next.disabled = page === pages;
    }
    draw(1);
  }
  window.DataPreviewView = {render};
})();
