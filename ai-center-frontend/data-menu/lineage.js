/* A dependency graph of the registered assets, dataset inputs and local indexes. */
(() => {
  'use strict';
  const svgNS = 'http://www.w3.org/2000/svg';
  let diagramId = 0;

  function el(tag, text, css) {
    const item = document.createElement(tag);
    if (css) item.className = css;
    if (text != null) item.textContent = text;
    return item;
  }

  function svg(tag, attributes) {
    const item = document.createElementNS(svgNS, tag);
    for (const [key,value] of Object.entries(attributes)) item.setAttribute(key, value);
    return item;
  }

  function button(text, click, css = 'dm-btn') {
    const item = el('button', text, css);
    item.type = 'button';
    item.addEventListener('click', click);
    return item;
  }

  const assetKey = (source, asset) => JSON.stringify([source, asset]);
  const datasetKey = id => 'dataset/' + id;
  const indexKey = id => 'index/' + id;
  const display = n => n.kind === 'asset' ? n.source.name + ' / ' + n.title : n.title;

  function buildGraph(snapshot, sources) {
    const graph = new Map();
    const link = (from, to) => {
      if (!from || !to || from === to) return;
      to.parent = from;
      from.children.push(to);
    };
    function add(key, values) {
      const node = {key, parent:null, children:[], ...values};
      graph.set(key, node);
      return node;
    }
    for (const source of sources) {
      for (const asset of source.assets?.length ? source.assets : [source]) {
        if (!asset.object) continue;
        const key = assetKey(source.id, asset.object);
        if (!graph.has(key)) add(key, {kind:'asset', title:asset.object, subtitle:source.name, source, asset});
      }
    }
    const layers = new Map();
    for (const layer of snapshot.layers || []) {
      if (layer.code) layers.set(layer.code, layer);
      if (layer.id) layers.set(layer.id, layer);
    }
    for (const ds of snapshot.datasets) {
      const layer = layers.get(ds.layer);
      const layerName = layer?.name || ds.layer || 'Dataset';
      const label = layer?.code || ds.layer || 'Dataset';
      add(datasetKey(ds.id), {kind:'dataset', ds, title:ds.name, layerName, label,
        subtitle:ds.archived ? label + ' · Archived' : layerName});
    }
    for (const ds of snapshot.datasets) {
      const own = graph.get(datasetKey(ds.id));
      const input = ds.upstreamId ? datasetKey(ds.upstreamId) : assetKey(ds.sourceId, ds.asset);
      link(graph.get(input), own);
      if (ds.archived || ds.dataType === 'table') continue;
      const built = Boolean(ds.indexedAt || ds.buildSignature);
      const index = add(indexKey(ds.id), {kind:'index', ds, built, title:ds.name,
        subtitle:built ? ds.indexStatus || 'Ready' : 'Not built'});
      link(own, index);
    }
    return graph;
  }

  function scopeGraph(focus, archived) {
    const visible = new Set();
    // Retain archived inputs that explain a live derivative's origin.
    for (let n = focus; n && !visible.has(n); n = n.parent) visible.add(n);
    const pending = [...focus.children];
    while (pending.length) {
      const n = pending.pop();
      if ((!archived && n.ds?.archived) || visible.has(n)) continue;
      visible.add(n);
      pending.push(...n.children);
    }
    return visible;
  }

  function positions(visible) {
    const pos = new Map();
    const leaves = new Map();
    let row = 0, maxDepth = 0;
    // A dataset has one declared input. Give each branch its own vertical space
    // and align its parent with the center of the downstream branches.
    function visit(n, depth) {
      if (pos.has(n)) return;
      const p = {column:depth, row};
      pos.set(n,p);
      if (n.kind !== 'index') maxDepth = Math.max(maxDepth,depth);
      const start = row;
      for (const child of n.children) if (visible.has(child)) visit(child,depth + 1);
      if (row === start) row++;
      p.row = (start + row - 1) / 2;
      if (n.kind === 'index') leaves.set(n,p);
    }
    for (const n of visible) if (!visible.has(n.parent)) visit(n, n.kind === 'asset' ? 0 : 1);
    for (const n of visible) if (!pos.has(n)) visit(n,1);
    for (const p of leaves.values()) p.column = maxDepth + 1;
    const columns = [];
    for (const [n,p] of pos) {
      (columns[p.column] ||= new Set()).add(n.kind === 'asset' ? 'Source assets' :
        n.kind === 'index' ? 'Retrieval indexes' : n.label);
    }
    return {pos, columns, rows:row};
  }

  function render(host, ctx) {
    const snapshot = ctx.store.snapshot();
    const graph = buildGraph(snapshot,ctx.sources);
    const id = typeof ctx.dataset === 'string' ? ctx.dataset : ctx.dataset?.id;
    const focus = graph.get(datasetKey(id));
    if (!focus) {host.replaceChildren();return;}
    let archived = Boolean(focus.ds.archived);
    let selected = null;
    const destinations = new Map((snapshot.storageLocations || []).map(l => [l.id,l.name]));
    const root = el('section',null,'ln-root');
    const toolbar = el('div',null,'ln-toolbar');
    toolbar.append(el('h2','Dataset lineage'));
    if (scopeGraph(focus,true).size > scopeGraph(focus,false).size) {
      const archiveLabel = el('label',null,'dm-check ln-archive'), archiveCheck = el('input');
      archiveCheck.type = 'checkbox'; archiveCheck.checked = archived;
      archiveCheck.addEventListener('change',() => {archived = archiveCheck.checked; draw();});
      archiveLabel.append(archiveCheck,document.createTextNode('Include archived descendants'));
      toolbar.append(archiveLabel);
    }
    const viewport = el('div',null,'ln-scroll');
    viewport.tabIndex = 0;
    viewport.setAttribute('role','region');
    viewport.setAttribute('aria-label','Scrollable lineage diagram');
    const legend = el('div',null,'ln-legend');
    const pendingIndex = el('span','Index not built','ln-dashed-key');
    legend.append(el('span','Data dependency','ln-solid-key'),pendingIndex);
    const inspector = el('section',null,'ln-inspector');
    inspector.setAttribute('aria-label','Selected lineage node');
    const details = el('details',null,'ln-relations');
    root.append(toolbar,legend,viewport,inspector,details);
    host.replaceChildren(root);
    let controls = new Map(), edges = [], visible;

    function choose(n, reveal = false) {
      selected = n;
      for (const [item,control] of controls) control.setAttribute('aria-pressed',String(item === n));
      for (const edge of edges) edge.path.classList.toggle('ln-neighbor',edge.from === n || edge.to === n);
      const meta = el('dl',null,'ln-properties');
      function prop(k,v) { meta.append(el('dt',k),el('dd',String(v))); }
      const title = el('h3',display(n));
      const identity = {asset:'Source asset',dataset:n.layerName,index:'Retrieval index'};
      const head = el('div',null,'ln-inspect-head');
      head.append(el('span',identity[n.kind],'dm-badge'),title);
      if (n.kind === 'asset') {
        prop('Source type',n.source.format || n.source.kind);
        prop('Location',n.source.loc || 'Unavailable');
        prop('Asset',n.asset.object);
        prop('Downstream datasets',n.children.length);
      } else if (n.kind === 'dataset') {
        prop('Layer',n.layerName);
        prop('Storage location',destinations.get(n.ds.storage) || n.ds.storage || 'Unassigned');
        prop('Upstream',n.parent ? display(n.parent) : 'Input unavailable');
        if (n.ds.dataType === 'table') prop('Retrieval',n.ds.archived ? 'Unavailable in archive' : 'Structured lookup');
        else prop('Retrieval index',n.ds.archived ? 'Withdrawn · dataset archived' : n.ds.indexStatus || 'Not built');
      } else {
        prop('Input dataset',n.ds.name);
        prop('Index status',n.subtitle);
        if (n.built) {
          prop('Indexed documents',n.ds.snapshotDocs?.length ?? 'Unavailable');
          if (n.ds.indexedAt) prop('Last indexed',n.ds.indexedAt);
        }
      }
      inspector.replaceChildren(head,meta);
      if (reveal) {
        const target = controls.get(n);
        if (target) {
          viewport.scrollLeft = target.offsetLeft - (viewport.clientWidth - target.offsetWidth) / 2;
          viewport.scrollTop = target.offsetTop - (viewport.clientHeight - target.offsetHeight) / 2;
        }
      }
    }

    function draw() {
      visible = scopeGraph(focus,archived);
      pendingIndex.hidden = !Array.from(visible).some(n => n.kind === 'index' && !n.built);
      controls = new Map(); edges = [];
      if (!visible.size) {
        viewport.replaceChildren(el('p','No registered assets or datasets to trace.','ln-empty'));
        inspector.replaceChildren(); details.hidden = true; return;
      }
      const {pos,columns,rows} = positions(visible);
      const cell = {w:175,h:62}, step = {x:220,y:80}, pad = 12, startY = 44;
      const width = 2*pad + (columns.length - 1)*step.x + cell.w;
      const height = startY + (rows - 1)*step.y + cell.h + pad;
      const board = el('div',null,'ln-board');
      board.style.width = width + 'px'; board.style.height = height + 'px';
      const wires = svg('svg',{width,height,'aria-hidden':'true'});
      const markerId = 'ln-arrow-' + ++diagramId;
      const defs = svg('defs',{}),marker = svg('marker',{id:markerId,viewBox:'0 0 8 8',refX:7,refY:4,
        markerWidth:7,markerHeight:7,orient:'auto',markerUnits:'userSpaceOnUse'});
      marker.append(svg('path',{d:'M1 1 L7 4 L1 7',class:'ln-arrow'})); defs.append(marker); wires.append(defs);
      board.append(wires);
      columns.forEach((labels,i) => {
        const heading = el('div',[...labels].join(' / '),'ln-column');
        heading.style.left = (pad + i*step.x) + 'px';heading.style.width = cell.w + 'px';
        board.append(heading);
      });
      const list = el('ul');
      for (const [n,p] of pos) {
        const x = pad + p.column*step.x, y = startY + p.row*step.y;
        const card = button(null,() => choose(n),'ln-node');
        card.dataset.kind = n.kind;
        card.dataset.state = n.ds?.archived ? 'archived' : n.kind === 'index' && !n.built ? 'pending' : 'active';
        card.style.left = x + 'px'; card.style.top = y + 'px';
        card.style.width = cell.w + 'px'; card.style.height = cell.h + 'px';
        card.setAttribute('aria-label',display(n) + ' · ' + n.kind + ' · ' + n.subtitle);
        card.append(el('span',n.title,'ln-node-title'),el('span',n.subtitle,'ln-node-meta'));
        controls.set(n,card);board.append(card);
        const parent = n.parent, from = pos.get(parent);
        if (!from) continue;
        const x1 = pad + from.column*step.x + cell.w, y1 = startY + from.row*step.y + cell.h/2;
        const y2 = y + cell.h/2;
        const mid = (x1 + x) / 2;
        const path = svg('path',{d:`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x-3} ${y2}`,
          class:'ln-wire' + (n.kind === 'index' && !n.built ? ' ln-pending' : ''),'marker-end':'url(#' + markerId + ')'});
        wires.append(path); edges.push({from:parent,to:n,path});
        const description = n.kind === 'index' ? 'retrieval index (' + n.subtitle + ')' : display(n);
        list.append(el('li',display(parent) + ' → ' + description));
      }
      viewport.replaceChildren(board);
      details.hidden = !edges.length;
      details.replaceChildren(el('summary','Dependency list (' + edges.length + ')'),list);
      choose(visible.has(selected) ? selected : focus,true);
    }
    draw();
  }

  window.DataLineageView = {render};
})();
