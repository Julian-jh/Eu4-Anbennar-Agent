/* Field configuration for materialized tables. */
(() => {
  'use strict';

  function render(view,{store,dataset,execute,status},{node,field,select,button,submit,group,table,form,panel}) {
    const id = dataset.id;
    const types = store.fieldTypesFor(id);
    const fields = Object.keys(types);
    const {filterFields,returnFields,indexedFields} = dataset.lookup;
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
      const index = tick('Index ' + name,indexedFields.includes(name));
      index.disabled = dataset.archived || !filter.checked;
      filter.addEventListener('change',() => {
        index.disabled = !filter.checked;
        if (!filter.checked) index.checked = false;
      });
      choices.push({name,filter,project,index});
      return [name,types[name],filter,project,index];
    });
    const settings = form(() => {
      const checked = key => choices.filter(col => col[key].checked).map(col => col.name);
      const queryFields = checked('project');
      if (!queryFields.length) {status('Select at least one return field.',true);return;}
      execute(() => store.setLookupFields(id,{filterFields:checked('filter'),returnFields:queryFields,indexedFields:checked('index')}),'Table lookup fields saved.');
    },table(['Field','Type','Allow filtering','Return in results','Indexed'],rows));
    if (!dataset.archived && fields.length) settings.append(group('dm-actions',submit('Save lookup fields',true)));
    view.append(panel('Table lookup fields',node('p','Choose filter and return fields. Indexed fields speed up Equals conditions on this dataset. The first matching query builds the local index.','dm-muted'),settings));
  }
  window.StructuredRetrieval = {render};
})();
