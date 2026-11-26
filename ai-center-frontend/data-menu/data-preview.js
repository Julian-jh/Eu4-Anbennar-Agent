/* Read materialized dataset contents a page at a time. */
(() => {
  'use strict';
  const format = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const operators = {eq:'Equals',ne:'Does not equal',contains:'Contains',gt:'Greater than',gte:'At least',
    lt:'Less than',lte:'At most',empty:'Is empty',not_empty:'Is not empty'};

  function download(payload,filename) {
    const file = new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || payload.layer.toLowerCase() + '-' + payload.datasetId + '.json';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url),1000);
  }

  function render(host,{dataset,store},{node,field,select,button,submit,form,group,table}) {
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
    save.title = 'Download all materialized records';
    if (!dataset.archived) header.append(save);

    let applied = null;
    const reset = button('Clear query',() => {
      queryForm.reset();
      conditions.replaceChildren();
      applied = null;
      reset.hidden = true;
      draw(1);
      queryForm.querySelector('button:not([disabled]), input:not([disabled])')?.focus();
    });
    reset.hidden = true;
    const conditions = node('div',null,'dm-query-conditions');
    let queryForm;

    function showDraft() {
      reset.hidden = false;
      if (applied || !error.hidden) {applied = null;draw(1);}
    }
    function tableQuery() {
      const allowed = dataset.lookup?.filterFields || [];
      let types;
      const limit = node('input');
      Object.assign(limit,{type:'number',min:1,max:100,step:1,defaultValue:'20',required:true});
      const limitField = field('Row limit',limit);
      limitField.classList.add('dm-preview-limit');
      function addCondition() {
        try {types ??= store.fieldTypesFor(dataset.id);}
        catch (cause) {error.textContent = cause.message;error.hidden = false;return;}
        const available = allowed.filter(name => Object.hasOwn(types,name));
        if (!available.length) {
          add.disabled = true;
          error.textContent = 'Choose available filter fields in Retrieval before adding a condition.';
          error.hidden = false;
          return;
        }
        const column = select(available), operator = select([]);
        const value = node('input');
        const valueField = field('Value',value);
        const row = group('dm-query-condition',field('Filter field',column),field('Operator',operator),valueField);
        row.dataset.queryCondition = '';
        column.name = 'column'; operator.name = 'operator'; value.name = 'value';
        function updateValue() {
          const unary = ['empty','not_empty'].includes(operator.value);
          value.disabled = valueField.hidden = unary;
          value.required = !unary;
          const type = types[column.value];
          value.type = operator.value === 'contains' ? 'text' : type === 'Date' ? 'date' : type === 'Number' ? 'number' : 'text';
          if (value.type === 'number') value.step = 'any';
        }
        function updateOperators() {
          const names = types[column.value] === 'Text' ? ['eq','ne','contains','empty','not_empty'] : Object.keys(operators);
          operator.replaceChildren(...names.map(key => new Option(operators[key],key)));
          updateValue();
        }
        row.append(button('Remove condition',() => {row.remove();showDraft();add.focus();}));
        column.addEventListener('change',updateOperators);
        operator.addEventListener('change',updateValue);
        updateOperators();
        conditions.append(row);
        showDraft();
        column.focus();
      }
      const add = button('Add condition',addCondition);
      add.disabled = !allowed.length;
      const run = submit('Run query',true);
      const editor = form(() => {
        const filters = [...conditions.children].map(row => ({
          field:row.querySelector('[name="column"]').value,op:row.querySelector('[name="operator"]').value,
          value:row.querySelector('[name="value"]').value
        }));
        applied = {filters,limit:limit.valueAsNumber};
        reset.hidden = false;
        draw(1);
      },conditions,group('dm-query-toolbar',add,group('dm-query-run',limitField,run),reset));
      editor.setAttribute('aria-label','Structured query');
      return editor;
    }
    function documentSearch() {
      const input = node('input');
      Object.assign(input,{type:'search',required:true});
      const search = form(() => {
        const term = input.value.trim();
        if (!term) {error.textContent = 'Enter a search term.';error.hidden = false;input.focus();return;}
        try {
          applied = {hits:store.search(dataset.id,term)};
          reset.hidden = false;
          draw(1);
        } catch (cause) {error.textContent = cause.message;error.hidden = false;}
      },group('dm-query-toolbar',field('Search indexed documents',input),submit('Search index',true),reset));
      search.setAttribute('aria-label','Document index search');
      return search;
    }
    if (!dataset.archived && !isDocument && dataset.recordCount) queryForm = tableQuery();
    if (!dataset.archived && isDocument) {
      if (dataset.indexStatus === 'Ready' || dataset.indexStatus === 'Rebuild required') {
        queryForm = documentSearch();
        if (dataset.indexStatus === 'Rebuild required') section.append(node('p','Search uses the last built index. Rebuild it in Retrieval to include recent changes.','dm-muted'));
      } else section.append(node('p','Build the document index in Retrieval to search its contents.','dm-muted'));
    }
    if (queryForm) {
      queryForm.className = 'dm-preview-query';
      queryForm.addEventListener('input',showDraft);
      queryForm.addEventListener('change',showDraft);
      section.append(queryForm);
    }

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
    function loadPage(requested) {
      if (!applied) return store.previewPage(dataset.id,requested);
      const pageSize = 15;
      const cap = isDocument ? applied.hits.length : applied.limit;
      const current = Math.min(Math.max(1,requested),Math.max(1,Math.ceil(cap / pageSize)));
      const offset = (current - 1) * pageSize;
      if (isDocument) return {page:current,pageCount:Math.max(1,Math.ceil(cap/pageSize)),count:cap,offset,
        records:applied.hits.slice(offset,offset + pageSize)};
      const result = store.queryRows(dataset.id,applied.filters,Math.min(pageSize,cap-offset),offset);
      const count = Math.min(cap,result.total), pageCount = Math.max(1,Math.ceil(count/pageSize));
      if (current > pageCount) return loadPage(pageCount);
      return {page:current,pageCount,count,offset,records:result.rows,fields:result.fields,total:result.total,usedIndexes:result.usedIndexes};
    }
    function draw(requested) {
      let result;
      try {result = loadPage(requested);}
      catch (cause) {
        viewport.replaceChildren();
        nav.hidden = true;
        error.textContent = cause.message;
        error.hidden = false;
        return;
      }
      error.hidden = true;
      const {count,offset,records,pageCount} = result;
      page = result.page;
      nav.hidden = count === 0;
      save.hidden = !dataset.recordCount;
      save.textContent = applied ? 'Download all records' : 'Download records';
      if (!count) {
        if (applied) {
          viewport.replaceChildren(node('p',isDocument ? 'No indexed documents matched.' : 'No rows match these conditions.','dm-muted'));
          return;
        }
        const empty = isDocument ? 'No documents are available.' : 'No records are available.';
        const nextStep = dataset.archived ? 'This archived dataset has no retained data.' : dataset.upstreamId
          ? 'Materialize this dataset from Overview to preview its records.' : 'Ingest the source from Overview to populate the preview.';
        viewport.replaceChildren(node('p',empty + ' ' + nextStep,'dm-muted'));
        return;
      }
      if (pageCount !== pages) updatePicker(pageCount);
      const fields = isDocument ? [] : result.fields || [...new Set([...dataset.fields,...records.flatMap(d => Object.keys(d.values || {}))])];
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
      const label = applied ? (isDocument ? 'Indexed results ' : 'Query results ') : (isDocument ? 'Documents ' : 'Records ');
      range.textContent = label + (offset+1) + '–' + (offset+records.length) + ' of ' + count;
      if (result.total > count) range.textContent += ' · ' + result.total + ' total matches';
      if (result.usedIndexes?.length) range.textContent += ' · Indexed by ' + result.usedIndexes.join(', ');
      pageInput.value = String(page);
      previous.disabled = page === 1;
      next.disabled = page === pages;
    }
    draw(1);
  }
  window.DataPreviewView = {render,download};
})();
