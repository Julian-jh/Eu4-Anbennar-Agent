/* Folder navigation and maintenance for the local dataset catalog. */
(() => {
  'use strict';

  const expansionKey = 'ai-center.data-folders.expansion.v1';
  let expansion = null;
  let renderSequence = 0;
  let labelSequence = 0;
  const selectionKey = id => id == null ? 'all' : String(id);

  function path(folders,id) {
    const byId = new Map(folders.map(f => [f.id,f]));
    const names = [], seen = new Set();
    for (let folder = byId.get(id); folder && !seen.has(folder.id); folder = byId.get(folder.parentId)) {
      names.push(folder.name);
      seen.add(folder.id);
    }
    return names.reverse();
  }
  function childrenOf(folders) {
    const children = new Map();
    for (const f of folders) {
      const parent = f.parentId || null;
      if (!children.has(parent)) children.set(parent,[]);
      children.get(parent).push(f);
    }
    for (const rows of children.values()) rows.sort((a,b) => a.name.localeCompare(b.name));
    return children;
  }
  function idsInSubtree(folders,id) {
    const children = childrenOf(folders), result = new Set();
    const stack = id == null ? [...(children.get(null) || [])] : folders.filter(f => f.id === id);
    while (stack.length) {
      const item = stack.pop();
      if (result.has(item.id)) continue;
      result.add(item.id);
      for (const child of children.get(item.id) || []) stack.push(child);
    }
    return result;
  }
  function scopeFilter(folders,id) {
    if (!id) return () => true;
    if (id === 'unfiled') return dataset => !dataset.folderId;
    const ids = idsInSubtree(folders,id);
    return dataset => ids.has(dataset.folderId);
  }
  function node(tag,cls,text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
  }
  function button(label,cls,click) {
    const el = node('button',cls,label);
    el.type = 'button';
    el.addEventListener('click',click);
    return el;
  }
  function label(text,input) {
    const el = node('label','dm-ft-field');
    const caption = node('span','',text);
    caption.id = 'dm-folder-label-' + (++labelSequence);
    input.setAttribute('aria-labelledby',caption.id);
    el.append(caption,input);
    return el;
  }
  function folderOptions(folders,exceptId,includeRoot) {
    const excluded = exceptId ? idsInSubtree(folders,exceptId) : new Set();
    const byId = new Map(folders.map(f => [f.id,f]));
    const paths = new Map();
    function pathFor(folder) {
      if (paths.has(folder.id)) return paths.get(folder.id);
      const parent = byId.get(folder.parentId);
      const text = parent ? pathFor(parent) + ' / ' + folder.name : folder.name;
      paths.set(folder.id,text);
      return text;
    }
    const options = folders.filter(f => !excluded.has(f.id)).map(f => ({
      value:f.id,label:pathFor(f)
    })).sort((a,b) => a.label.localeCompare(b.label));
    if (includeRoot) options.unshift({value:'',label:'Workspace root'});
    return options;
  }
  function readExpansion(roots) {
    if (expansion !== null) return;
    try {
      const stored = JSON.parse(localStorage.getItem(expansionKey));
      if (Array.isArray(stored) && stored.every(v => typeof v === 'string')) expansion = new Set(stored);
    } catch { /* Folder browsing also works without browser storage. */ }
    if (expansion === null) expansion = new Set(roots.map(f => f.id));
  }
  function persistExpansion() {
    try {localStorage.setItem(expansionKey,JSON.stringify([...expansion]));}
    catch { /* Keep the current session's expansion state. */ }
  }

  function render(host,ctx) {
    const {folders,datasets,store,onSelect,afterMutation,browseOnly = false} = ctx;
    let selected = ctx.selected;
    const children = childrenOf(folders);
    const byId = new Map(folders.map(f => [f.id,f]));
    const roots = children.get(null) || [];
    const owner = browseOnly ? host : host.closest('aside,main') || document;
    const counts = new Map();
    let total = 0, unfiled = 0;
    for (const dataset of datasets) {
      if (dataset.archived) continue;
      total++;
      if (!byId.has(dataset.folderId)) {unfiled++;continue;}
      const seen = new Set();
      for (let f = byId.get(dataset.folderId); f && !seen.has(f.id); f = byId.get(f.parentId)) {
        seen.add(f.id);
        counts.set(f.id,(counts.get(f.id) || 0) + 1);
      }
    }
    readExpansion(roots);
    const expanded = browseOnly ? new Set(expansion) : expansion;
    function revealParents(id) {
      const seen = new Set();
      for (let f = byId.get(id); f && f.parentId && !seen.has(f.id); f = byId.get(f.parentId)) {
        seen.add(f.id);
        expanded.add(f.parentId);
      }
    }
    revealParents(selected);
    const view = node('section','dm-folders');
    view.setAttribute('aria-label','Dataset folders');
    const header = node('header','dm-ft-head'), title = node('h2','','Folders');
    const nav = node('nav','dm-ft-nav');
    nav.setAttribute('aria-label','Browse dataset folders');
    const feedback = node('p','dm-ft-feedback');
    feedback.setAttribute('role','status');
    feedback.hidden = true;
    const instance = 'dm-ft-' + (++renderSequence);
    const menu = node('div','dm-ft-menu');
    menu.id = instance + '-actions';
    menu.setAttribute('role','menu');
    menu.setAttribute('popover','manual');
    menu.hidden = true;
    header.append(title);
    if (ctx.tools) header.append(ctx.tools);
    host.replaceChildren(view);
    view.append(header,nav);
    if (!browseOnly) view.append(feedback,menu);
    function focusSelection(id) {
      const row = Array.from(owner.querySelectorAll('.dm-ft-pick')).find(b => b.dataset.key === selectionKey(id));
      row?.focus();
    }
    function selectFolder(id) {
      if (browseOnly) {
        selected = id;
        drawTree();
      }
      onSelect(id);
      focusSelection(id);
    }
    function toggle(id,open,focusDisclosure = false) {
      if (open) expanded.add(id);
      else expanded.delete(id);
      if (!browseOnly) persistExpansion();
      drawTree();
      if (!focusDisclosure) {focusSelection(id);return;}
      const disclosure = Array.from(nav.querySelectorAll('.dm-ft-toggle')).find(b => b.dataset.key === id);
      disclosure?.focus();
    }
    function pick(id,name,count,depth,hasChildren) {
      const li = node('li'), row = node('div','dm-ft-row');
      row.style.setProperty('--dm-ft-depth',String(Math.min(depth,5)));
      if (id === selected || (id == null && selected == null)) row.dataset.selected = 'true';
      let toggleButton;
      if (hasChildren) {
        const open = expanded.has(id);
        toggleButton = button(open ? '▾' : '▸','dm-ft-toggle',() => toggle(id,!open,true));
        toggleButton.dataset.key = id;
        toggleButton.setAttribute('aria-label',(open ? 'Collapse ' : 'Expand ') + name);
        toggleButton.setAttribute('aria-expanded',String(open));
      }
      row.append(toggleButton || node('span','dm-ft-spacer'));
      const choice = button('','dm-ft-pick',() => selectFolder(id));
      choice.dataset.key = selectionKey(id);
      if (row.dataset.selected) choice.setAttribute('aria-current','true');
      const glyph = node('span','dm-ft-glyph');
      glyph.dataset.kind = id === null ? 'all' : id === 'unfiled' ? 'unfiled' : 'folder';
      glyph.setAttribute('aria-hidden','true');
      const nameEl = node('span','dm-ft-name',name);
      const badge = node('span','dm-ft-count',count);
      badge.setAttribute('aria-hidden','true');
      choice.setAttribute('aria-description',count + (count === 1 ? ' active dataset' : ' active datasets') + (hasChildren ? ', including subfolders' : ''));
      choice.append(glyph,nameEl,badge);
      row.append(choice);
      if (!browseOnly && id !== 'unfiled') {
        const more = button('⋯','dm-ft-more',() => showMenu(more,id));
        more.dataset.key = selectionKey(id);
        more.title = 'Actions for ' + name;
        more.setAttribute('aria-label','Actions for ' + name);
        more.setAttribute('aria-haspopup','menu');
        more.setAttribute('aria-controls',menu.id);
        more.setAttribute('aria-expanded','false');
        more.addEventListener('keydown',event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            showMenu(more,id,event.key === 'ArrowUp');
          }
        });
        row.append(more);
      } else if (!browseOnly) row.append(node('span','dm-ft-spacer'));
      li.append(row);
      return {li,toggleButton};
    }
    function drawTree() {
      const list = node('ul','dm-ft-list');
      list.append(pick(null,'All datasets',total,0,false).li,pick('unfiled','Unfiled',unfiled,0,false).li);
      const seen = new Set();
      let branchIndex = 0;
      function appendFolders(parent,items,level) {
        for (const folder of items) {
          if (seen.has(folder.id)) continue;
          seen.add(folder.id);
          const sub = children.get(folder.id) || [];
          const {li,toggleButton} = pick(folder.id,folder.name,counts.get(folder.id) || 0,level,sub.length > 0);
          parent.append(li);
          if (!sub.length) continue;
          const branch = node('ul','dm-ft-list');
          branch.id = instance + '-branch-' + (++branchIndex);
          branch.hidden = !expanded.has(folder.id);
          toggleButton.setAttribute('aria-controls',branch.id);
          li.append(branch);
          if (!branch.hidden) appendFolders(branch,sub,level + 1);
        }
      }
      appendFolders(list,roots,0);
      nav.replaceChildren(list);
    }
    drawTree();
    nav.addEventListener('keydown',event => {
      const target = event.target.closest('.dm-ft-pick');
      if (!target || event.altKey || event.ctrlKey || event.metaKey) return;
      const items = [...nav.querySelectorAll('.dm-ft-pick')], index = items.indexOf(target);
      const folder = byId.get(target.dataset.key), sub = folder && children.get(folder.id);
      switch (event.key) {
        case 'ArrowDown':items[Math.min(items.length - 1,index + 1)].focus();break;
        case 'ArrowUp':items[Math.max(0,index - 1)].focus();break;
        case 'Home':items[0].focus();break;
        case 'End':items[items.length - 1].focus();break;
        case 'ArrowRight':
          if (!sub?.length) return;
          if (!expanded.has(folder.id)) toggle(folder.id,true);
          else focusSelection(sub[0].id);
          break;
        case 'ArrowLeft':
          if (!folder) return;
          if (sub?.length && expanded.has(folder.id)) toggle(folder.id,false);
          else if (folder.parentId) focusSelection(folder.parentId);
          else return;
          break;
        default:return;
      }
      event.preventDefault();
    });

    let menuTrigger = null, listeners = null;
    function closeMenu(restore = false) {
      if (!menuTrigger) return;
      const trigger = menuTrigger;
      menuTrigger = null;
      trigger.setAttribute('aria-expanded','false');
      listeners?.abort();
      listeners = null;
      if (menu.hidePopover && menu.matches(':popover-open')) menu.hidePopover();
      menu.hidden = true;
      if (restore && trigger.isConnected) trigger.focus();
    }
    function removalReason(folder) {
      const hasChildren = children.has(folder.id);
      const direct = datasets.filter(d => d.folderId === folder.id);
      if (!hasChildren && !direct.length) return '';
      return 'Only empty folders can be removed. ' + (hasChildren ? 'Move its subfolders first. ' : '')
        + (direct.some(d => !d.archived) ? 'Move its datasets first. ' : '')
        + (direct.some(d => d.archived) ? 'Restore and move its archived datasets first.' : '');
    }
    function showMenu(trigger,id,last = false) {
      if (menuTrigger === trigger) {closeMenu(true);return;}
      closeMenu();
      const folder = byId.get(id);
      const caption = folder?.name || 'All datasets';
      const reason = folder ? removalReason(folder).trim() : '';
      menu.replaceChildren();
      menu.setAttribute('aria-label','Actions for ' + caption);
      function item(text,run,disabledReason) {
        const choice = button(text,'dm-ft-menuitem',() => {
          if (disabledReason) return;
          closeMenu();
          run();
        });
        choice.setAttribute('role','menuitem');
        choice.tabIndex = -1;
        if (disabledReason) {
          choice.setAttribute('aria-disabled','true');
          choice.setAttribute('aria-describedby',instance + '-remove-note');
        }
        menu.append(choice);
      }
      if (folder) item('Rename',() => editFolder('rename',folder,trigger));
      item(folder ? 'Create subfolder' : 'Create folder',() => editFolder('create',folder,trigger));
      if (folder) {
        item('Move folder',() => moveFolder(folder,trigger));
        item('Remove',() => editFolder('remove',folder,trigger),reason);
        if (reason) {
          const note = node('p','dm-ft-reason',reason);
          note.id = instance + '-remove-note';
          menu.append(note);
        }
      }
      menuTrigger = trigger;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded','true');
      if (menu.showPopover) menu.showPopover();
      function position() {
        if (!trigger.isConnected || !trigger.getClientRects().length) {closeMenu();return;}
        const rect = trigger.getBoundingClientRect(), area = nav.getBoundingClientRect();
        if (rect.bottom <= area.top || rect.top >= area.bottom) {closeMenu();return;}
        const box = menu.getBoundingClientRect(), gap = 5, margin = 6;
        const left = Math.min(innerWidth-box.width-margin,Math.max(margin,rect.right-box.width));
        const below = rect.bottom+gap;
        const top = below+box.height <= innerHeight-margin ? below : Math.max(margin,rect.top-gap-box.height);
        menu.style.left = Math.max(margin,left) + 'px';
        menu.style.top = top + 'px';
      }
      position();
      if (!menuTrigger) return;
      const options = [...menu.querySelectorAll('[role=menuitem]')];
      (last ? options[options.length-1] : options[0]).focus({preventScroll:true});
      listeners = new AbortController();
      const signal = listeners.signal;
      document.addEventListener('pointerdown',e => {
        if (!menu.contains(e.target) && !trigger.contains(e.target)) closeMenu();
      },{capture:true,signal});
      document.addEventListener('focusin',e => {
        if (!menu.contains(e.target) && e.target !== trigger) closeMenu();
      },{signal});
      window.addEventListener('resize',position,{signal});
      document.addEventListener('scroll',position,{capture:true,signal});
      const observer = new MutationObserver(() => {if (!trigger.isConnected) closeMenu();});
      observer.observe(document.body,{childList:true,subtree:true});
      signal.addEventListener('abort',() => observer.disconnect(),{once:true});
    }
    menu.addEventListener('keydown',event => {
      const options = [...menu.querySelectorAll('[role=menuitem]')], at = options.indexOf(document.activeElement);
      switch (event.key) {
        case 'Escape': case 'ArrowLeft':closeMenu(true);break;
        case 'Tab':closeMenu(true);return;
        case 'ArrowDown':options[(at+1)%options.length]?.focus();break;
        case 'ArrowUp':options[(at+options.length-1)%options.length]?.focus();break;
        case 'Home':options[0]?.focus();break;
        case 'End':options[options.length-1]?.focus();break;
        default:return;
      }
      event.preventDefault();
      event.stopPropagation();
    });

    function complete(text,nextSelection = selected ?? null) {
      persistExpansion();
      afterMutation(nextSelection);
      const current = owner.querySelector('.dm-folders .dm-ft-feedback') || feedback;
      current.setAttribute('role','status');
      current.textContent = text;
      current.hidden = false;
      focusSelection(nextSelection);
    }
    function expandDestination(parentId) {
      if (!parentId) return;
      expansion.add(parentId);
      revealParents(parentId);
    }
    function moveFolder(folder,trigger) {
      window.DatasetFolderPicker.open({
        folders,currentId:folder.parentId || null,title:'Move ' + folder.name,confirmLabel:'Move folder',
        rootLabel:'Workspace root',excludeIds:idsInSubtree(folders,folder.id),trigger,
        onConfirm(parentId) {
          const destination = parentId || null;
          if (destination === (folder.parentId || null)) return;
          store.moveFolder(folder.id,destination);
          expandDestination(destination);
          complete('Folder moved.');
          requestAnimationFrame(() => focusSelection(selected));
        }
      });
    }
    function editFolder(operation,folder,trigger) {
      const remove = operation === 'remove', create = operation === 'create';
      const dialog = node('dialog','dm-ft-dialog');
      const title = node('h2','',remove ? 'Remove folder' : create ? (folder ? 'Create subfolder' : 'Create folder') : 'Rename folder');
      title.id = instance + '-dialog-title';
      dialog.setAttribute('aria-labelledby',title.id);
      const form = node('form','dm-ft-form');
      const context = node('p','dm-ft-context',(create ? 'Parent: ' : 'Folder: ') + (folder ? path(folders,folder.id).join(' / ') : 'Workspace root'));
      form.append(title,context);
      const input = document.createElement('input');
      if (remove) {
        form.append(node('p','','Remove this empty folder from the catalog?'));
      } else {
        input.type = 'text';
        input.autocomplete = 'off';
        input.required = true;
        input.value = create ? '' : folder.name;
        form.append(label('Folder name',input));
      }
      const error = node('p','dm-ft-feedback');
      error.setAttribute('role','alert');
      error.hidden = true;
      const cancel = button('Cancel','dm-ft-link',() => dialog.close());
      const save = node('button','dm-ft-save',remove ? 'Remove folder' : create ? 'Create folder' : 'Save name');
      save.type = 'submit';
      const controls = node('div','dm-ft-actions');
      controls.append(cancel,save);
      form.append(error,controls);
      dialog.append(form);
      view.append(dialog);
      dialog.addEventListener('close',() => {
        dialog.remove();
        if (trigger.isConnected) trigger.focus();
      },{once:true});
      dialog.addEventListener('click',e => {
        if (e.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) dialog.close();
      });
      form.addEventListener('submit',event => {
        event.preventDefault();
        let nextSelection = selected ?? null;
        try {
          const name = input.value.trim();
          if (!remove && !name) throw new Error('Enter a folder name.');
          if (create) {
            store.addFolder({name,parentId:folder?.id || null});
            expandDestination(folder?.id);
          } else if (remove) {
            store.removeFolder(folder.id);
            expansion.delete(folder.id);
            if (selected === folder.id) nextSelection = folder.parentId || null;
          } else store.renameFolder(folder.id,name);
          dialog.close();
          complete(create ? 'Folder created.' : remove ? 'Empty folder removed.' : 'Folder renamed.',nextSelection);
        } catch (err) {
          error.textContent = err.message || 'The folder could not be updated.';
          error.hidden = false;
        }
      });
      dialog.showModal();
      if (remove) cancel.focus();
      else {input.focus();input.select();}
    }
  }
  window.DatasetFolderTree = {render,path,idsInSubtree,scopeFilter,folderOptions};
})();
