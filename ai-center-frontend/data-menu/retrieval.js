/* Field configuration and query testing for materialized tables. */
(() => {
  'use strict';
  const operators = {
    eq:'Equals', ne:'Does not equal', contains:'Contains',
    gt:'Greater than', gte:'At least', lt:'Less than', lte:'At most',
    empty:'Is empty', not_empty:'Is not empty'
  };

  function render(view,{store,dataset,execute,status},{node,field,select,button,submit,group,table,form,panel}) {
    const id = dataset.id;
    const types = store.fieldTypesFor(id);
    const fields = Object.keys(types);
    const {filterFields,returnFields} = dataset.lookup;
    const choices = [];
    function tick(name, checked) {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = checked;
      box.disabled = dataset.archived;
      box.setAttribute('aria-label',name);
      return box;
    }
    const rows = fields.map(name => {
      const filter = tick('Filter on ' + name,filterFields.includes(name));
      const project = tick('Return ' + name,returnFields.includes(name));
      choices.push({name,filter,project});
      return [name,types[name],filter,project];
    });
    const settings = form(() => {
      const checked = key => choices.filter(col => col[key].checked).map(col => col.name);
      const queryFields = checked('project');
      if (!queryFields.length) {status('Select at least one return field.',true);return;}
      execute(() => store.setLookupFields(id,{filterFields:checked('filter'),returnFields:queryFields}),'Table lookup fields saved.');
    },table(['Field','Type','Allow filtering','Return in results'],rows));
    if (!dataset.archived && fields.length) settings.append(group('dm-actions',submit('Save lookup fields',true)));
    view.append(panel('Table lookup fields',node('p','Choose which fields queries may filter on and which columns appear in results. Saved changes apply immediately.','dm-muted'),settings));
    if (dataset.archived) return;
    if (!dataset.docs.length) {
      view.append(panel('Test structured query',node('p','Populate the dataset to query its rows.','dm-muted')));
      return;
    }

    const allowed = fields.filter(name => filterFields.includes(name));
    const conditions = node('div',null,'dm-stack');
    const limit = document.createElement('input');
    Object.assign(limit,{type:'number',min:1,max:100,step:1,value:20,required:true});
    const output = node('div');
    output.setAttribute('aria-live','polite');
    function addCondition() {
      const column = select(allowed);
      const operator = select([]);
      const value = document.createElement('input');
      const valueLabel = field('Value',value);
      const controls = group('dm-grid',field('Filter field',column),field('Operator',operator),valueLabel);
      controls.dataset.queryCondition = '';
      column.name = 'column'; operator.name = 'operator'; value.name = 'value';
      controls.append(button('Remove condition',() => {controls.remove(); output.replaceChildren(); add.focus();}));
      function updateValue() {
        const unary = ['empty','not_empty'].includes(operator.value);
        value.disabled = unary;
        value.required = !unary;
        valueLabel.hidden = unary;
        const type = types[column.value];
        value.type = operator.value === 'contains' ? 'text' : type === 'Date' ? 'date' : type === 'Number' ? 'number' : 'text';
        if (value.type === 'number') value.step = 'any';
      }
      function updateOperators() {
        const names = types[column.value] === 'Text' ? ['eq','ne','contains','empty','not_empty'] : Object.keys(operators);
        operator.replaceChildren(...names.map(key => new Option(operators[key],key)));
        updateValue();
      }
      column.addEventListener('change',updateOperators);
      operator.addEventListener('change',updateValue);
      updateOperators();
      conditions.append(controls);
      output.replaceChildren();
      column.focus();
    }
    const add = button('Add condition',addCondition);
    add.disabled = !allowed.length;
    function run() {
      const filters = Array.from(conditions.children).map(row => ({
        field:row.querySelector('[name="column"]').value,
        op:row.querySelector('[name="operator"]').value,
        value:row.querySelector('[name="value"]').value
      }));
      try {
        const result = store.queryRows(id,filters,Number(limit.value));
        if (!result.total) {output.replaceChildren(node('p','No rows match these conditions.','dm-muted'));return;}
        const cells = result.rows.map(row => [...result.fields.map(key => {
          const v = row.values[key];
          return v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        }),row.locator]);
        output.replaceChildren(node('p','Showing ' + cells.length + ' of ' + result.total + ' matching rows.','dm-muted'),
          table([...result.fields,'Source locator'],cells));
      } catch (err) {output.replaceChildren(node('p',err.message,'dm-notice'));}
    }
    const query = form(run,conditions,group('dm-actions',add,field('Row limit',limit),submit('Run query',true)));
    query.addEventListener('input',() => output.replaceChildren());
    view.append(panel('Test structured query',node('p','All conditions must match. Run without conditions to preview the current table.','dm-muted'),query,output));
  }
  window.StructuredRetrieval = {render};
})();
