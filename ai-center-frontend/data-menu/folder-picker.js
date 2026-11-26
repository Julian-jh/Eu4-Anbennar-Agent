/* A single-select destination tree shared by dataset and folder moves. */
(() => {
  'use strict';

  function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text != null) result.textContent = text;
    return result;
  }

  function open({folders, currentId, title = 'Choose a folder', confirmLabel = 'Move here',
    rootLabel = 'Unfiled', excludeIds = new Set(), trigger = document.activeElement, onConfirm}) {
    const existing = document.querySelector('dialog.dm-folder-picker[open]');
    if (existing) return existing;

    const dialog = element('dialog','dm-folder-picker');
    const heading = element('h2','',title);
    heading.id = 'dm-fp-title';
    dialog.setAttribute('aria-labelledby',heading.id);
    const tree = element('ul','dm-fp-tree');
    tree.setAttribute('role','tree');
    tree.setAttribute('aria-label','Destination folders');
    const hints = element('p','sr-only','Use arrow keys to browse. Press Enter to choose a destination, then confirm.');
    hints.id = 'dm-fp-help';
    tree.setAttribute('aria-describedby',hints.id);
    const empty = element('p','dm-fp-empty');
    const preview = element('p','dm-fp-path');
    preview.setAttribute('role','status');
    const pathLabel = element('span','dm-fp-path-label','Destination');
    const pathValue = element('strong');
    preview.append(pathLabel,pathValue);
    const error = element('p','dm-fp-error');
    error.setAttribute('role','alert');
    error.hidden = true;
    const actions = element('footer','dm-fp-actions');
    const cancel = element('button','dm-btn','Cancel');
    const confirm = element('button','dm-btn dm-primary',confirmLabel);
    cancel.type = confirm.type = 'button';
    actions.append(cancel,confirm);
    dialog.append(heading,hints,tree,empty,preview,error,actions);

    const byId = new Map(folders.map(folder => [folder.id,folder]));
    const children = new Map();
    for (const folder of folders) {
      if (excludeIds.has(folder.id)) continue;
      const parentId = folder.parentId ?? null;
      if (!children.has(parentId)) children.set(parentId,[]);
      children.get(parentId).push(folder);
    }
    for (const siblings of children.values()) siblings.sort((a,b) => a.name.localeCompare(b.name));
    const expanded = new Set();
    function ancestors(id) {
      const chain = [], seen = new Set();
      for (let folder = byId.get(id); folder && !seen.has(folder.id); folder = byId.get(folder.parentId)) {
        seen.add(folder.id);
        chain.push(folder);
      }
      return chain.reverse();
    }
    for (const parent of ancestors(currentId).slice(0,-1)) expanded.add(parent.id);
    const items = new Map();
    let selected = currentId, cursor = currentId, submitting = false;
    let sequence = 0, search = '', lastSearch = 0;

    function updateSelection() {
      for (const [id,item] of items) item.setAttribute('aria-selected',String(id === selected));
      pathValue.textContent = selected === undefined ? 'Choose a destination' :
        selected === null ? rootLabel : ancestors(selected).map(folder => folder.name).join(' / ');
      confirm.disabled = submitting || selected === undefined || selected === currentId;
    }
    function focusItem(id, moveFocus = true) {
      const next = items.get(id);
      if (!next) return;
      if (items.has(cursor)) items.get(cursor).tabIndex = -1;
      cursor = id;
      next.tabIndex = 0;
      if (moveFocus) next.focus();
    }
    function choose(id) {
      selected = id;
      error.hidden = true;
      focusItem(id);
      updateSelection();
    }
    function appendItem(parent, id, name, level) {
      const item = element('li','dm-fp-item');
      item.setAttribute('role','treeitem');
      item.setAttribute('aria-level',String(level));
      item.tabIndex = -1;
      const row = element('div','dm-fp-row');
      row.style.setProperty('--dm-fp-indent',String(Math.min(level - 1,6)));
      const twist = element('span','dm-fp-twist');
      const glyph = element('span','dm-fp-glyph');
      const label = element('span','dm-fp-name',name);
      label.id = 'dm-fp-item-' + (++sequence);
      item.setAttribute('aria-labelledby',label.id);
      twist.setAttribute('aria-hidden','true');
      glyph.setAttribute('aria-hidden','true');
      if (id === null) glyph.classList.add('dm-fp-root');
      row.append(twist,glyph,label);
      item.append(row);
      parent.append(item);
      items.set(id,item);
      item.addEventListener('focus',() => focusItem(id,false));
      const nested = id === null ? null : children.get(id);
      if (nested?.length) {
        const isExpanded = expanded.has(id);
        item.setAttribute('aria-expanded',String(isExpanded));
        twist.classList.add('dm-fp-disclosure');
        if (isExpanded) {
          const group = element('ul','dm-fp-group');
          group.setAttribute('role','group');
          item.append(group);
          for (const folder of nested) appendItem(group,folder.id,folder.name,level + 1);
        }
      }
      item.addEventListener('click',event => {
        if (event.target.closest('[role="treeitem"]') !== item) return;
        if (nested?.length && twist.contains(event.target)) toggle(id);
        else choose(id);
      });
    }
    function draw() {
      items.clear();
      tree.replaceChildren();
      if (!excludeIds.has(null)) appendItem(tree,null,rootLabel,1);
      const roots = children.get(null) || [];
      for (const folder of roots) appendItem(tree,folder.id,folder.name,1);
      empty.hidden = roots.length > 0;
      empty.textContent = folders.length ? 'No other folders available.' : 'No folders yet.';
      focusItem(items.has(cursor) ? cursor : items.keys().next().value,false);
      updateSelection();
    }
    function toggle(id) {
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      cursor = id;
      draw();
      focusItem(id);
    }
    tree.addEventListener('keydown',event => {
      if (event.altKey || event.ctrlKey || event.metaKey || submitting) return;
      const visible = [...items.keys()];
      const position = visible.indexOf(cursor);
      const folder = byId.get(cursor);
      switch (event.key) {
        case 'ArrowDown': focusItem(visible[Math.min(position + 1,visible.length - 1)]); break;
        case 'ArrowUp': focusItem(visible[Math.max(position - 1,0)]); break;
        case 'Home': focusItem(visible[0]); break;
        case 'End': focusItem(visible[visible.length - 1]); break;
        case 'ArrowRight':
          if (!folder || !children.has(cursor)) break;
          if (expanded.has(cursor)) focusItem(children.get(cursor)[0].id);
          else toggle(cursor);
          break;
        case 'ArrowLeft':
          if (expanded.has(cursor)) toggle(cursor);
          else if (folder?.parentId != null) focusItem(folder.parentId);
          break;
        case 'Enter':
        case ' ':
          choose(cursor);
          if (event.key === 'Enter' && !confirm.disabled) confirm.focus();
          break;
        default: {
          if (event.key.length !== 1) return;
          const now = Date.now();
          search = (now - lastSearch < 650 ? search : '') + event.key.toLocaleLowerCase();
          lastSearch = now;
          const rotated = [...visible.slice(position + 1),...visible.slice(0,position + 1)];
          const match = rotated.find(id => (byId.get(id)?.name || rootLabel).toLocaleLowerCase().startsWith(search));
          if (match !== undefined) focusItem(match);
        }
      }
      event.preventDefault();
    });

    const closeOnNavigation = () => dialog.close();
    window.addEventListener('hashchange',closeOnNavigation);
    dialog.addEventListener('close',() => {
      window.removeEventListener('hashchange',closeOnNavigation);
      dialog.remove();
      const other = document.querySelector('dialog[open]');
      if (trigger?.isConnected && !trigger.disabled && trigger.getClientRects().length &&
          (!other || other.contains(trigger))) trigger.focus();
    },{once:true});
    cancel.addEventListener('click',() => dialog.close());
    dialog.addEventListener('cancel',event => { if (submitting) event.preventDefault(); });
    confirm.addEventListener('click',async () => {
      if (confirm.disabled) return;
      submitting = true;
      tree.inert = true;
      cancel.disabled = confirm.disabled = true;
      try {
        await onConfirm(selected);
        dialog.close();
      } catch (reason) {
        error.textContent = reason?.message || 'The destination could not be saved.';
        error.hidden = false;
        tree.inert = false;
        submitting = cancel.disabled = false;
        updateSelection();
        confirm.focus();
      }
    });
    draw();
    if (!items.has(selected)) { selected = undefined; updateSelection(); }
    const initialFocus = items.get(cursor) || cancel;
    initialFocus.setAttribute('autofocus','');
    document.body.append(dialog);
    dialog.showModal();
    initialFocus.focus();
    return dialog;
  }

  window.DatasetFolderPicker = {open};
})();
