/* Orchestra Competition — file: js/canvas.js
   Canvas rendering, node DOM creation, edge rendering, node drag,
   edge drag (connection), palette drop, keyboard shortcuts, add/delete/copy/paste.
   Depends on globals from app.js (state, NODE_TYPES, utilities). */
window.App = window.App || {};

/* ============================================================
   Canvas rendering
   ============================================================ */
function renderCanvas(){
  const canvas = $('#canvas');
  $$('.node').forEach(n => n.remove());
  for(const node of state.nodes){
    const el = createNodeElement(node);
    canvas.appendChild(el);
  }
  renderEdges();
}

function createNodeElement(node){
  const t = NODE_TYPES[node.type];
  const el = document.createElement('div');
  el.className = 'node';
  el.dataset.id = node.id;
  el.dataset.state = node.runState || 'idle';
  el.style.left = node.position.x + 'px';
  el.style.top = node.position.y + 'px';
  if(state.selectedNodeIds.has(node.id)) el.classList.add('selected');

  const subtitle = (node.type==='agent' || node.type==='convergence' || node.type==='adversarial')
    ? (node.agentName||'') : '';
  const iter = state.nodeIter[node.id];
  const iterBadge = (node.runState==='running' && iter) ? `<div class="iter-badge">↻ ${iter.iter}/${iter.max}</div>` : '';
  const statusPill = (node.runState && node.runState!=='idle') ? `<div class="status-pill ${node.runState}">${statusLabel(node.runState)}</div>` : '';

  let portsHtml = '<div class="ports-row">';
  portsHtml += `<div class="port in-0" data-node="${node.id}" data-port="in-0" data-dir="in"></div>`;
  if(t.outPorts>=1) portsHtml += `<div class="port out-0" data-node="${node.id}" data-port="out-0" data-dir="out"></div>`;
  if(t.outPorts>=2) portsHtml += `<div class="port out-1" data-node="${node.id}" data-port="out-1" data-dir="out"></div>`;
  portsHtml += '</div>';

  el.innerHTML = `
    <div class="accent-bar" style="background:${t.accent}"></div>
    <div class="header">
      <span class="type-label" style="color:${t.accent}">${t.label}</span>
      <span class="drag-handle" data-handle="1">⋮⋮</span>
    </div>
    <div class="body">
      <div class="title">${escapeHtml(node.title)}</div>
      ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    ${portsHtml}
    ${iterBadge}
    ${statusPill}
  `;

  const handle = el.querySelector('[data-handle="1"]');
  handle.addEventListener('mousedown', e => startNodeDrag(e, node));
  el.addEventListener('mousedown', e => {
    if(e.target.classList.contains('port')) return;
    if(e.button!==0) return;
    handleNodeClick(e, node);
    startNodeDrag(e, node);
  });
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    selectNode(node.id, false);
    toast(`Selected ${node.title} — edit in Inspector`);
  });

  el.querySelectorAll('.port').forEach(p => {
    p.addEventListener('mousedown', e => {
      e.stopPropagation();
      startEdgeDrag(e, node, p.dataset.port, p.dataset.dir);
    });
  });

  return el;
}

/* ============================================================
   Edge rendering
   ============================================================ */
function renderEdges(){
  const svg = $('#edges-svg');
  svg.innerHTML = '';
  for(const edge of state.edges){
    const src = state.nodes.find(n=>n.id===edge.sourceNode);
    const tgt = state.nodes.find(n=>n.id===edge.targetNode);
    if(!src || !tgt) continue;
    const sp = portPos(src, edge.sourcePort, 'out');
    const tp = portPos(tgt, edge.targetPort, 'in');
    const path = bezierPath(sp, tp);
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg','path');
    pathEl.setAttribute('d', path);
    pathEl.setAttribute('class','edge' + (src.runState==='running'?' flow':'') + (tgt.runState==='skipped'?' skipped':''));
    pathEl.dataset.edgeId = edge.id;
    pathEl.style.pointerEvents = 'stroke';
    pathEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmGlass(`Delete this edge?\n${src.title} → ${tgt.title}`);
      if(ok){
        state.edges = state.edges.filter(ed => ed.id !== edge.id);
        renderEdges();
      }
    });
    svg.appendChild(pathEl);
  }
}

function portPos(node, portName, dir){
  const W = 186, H = 86;
  if(dir==='in'){
    return { x: node.position.x + 0, y: node.position.y + H - 9 };
  }
  if(portName==='out-0'){
    return { x: node.position.x + W, y: node.position.y + H - 9 };
  }
  if(portName==='out-1'){
    return { x: node.position.x + W, y: node.position.y + H - 4 };
  }
  return { x: node.position.x + W, y: node.position.y + H/2 };
}

function bezierPath(a, b){
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`;
}

/* ============================================================
   Canvas interaction
   ============================================================ */
function handleNodeClick(e, node){
  const additive = e.metaKey || e.ctrlKey || e.shiftKey;
  selectNode(node.id, additive);
}

function selectNode(id, additive){
  if(additive){
    if(state.selectedNodeIds.has(id)) state.selectedNodeIds.delete(id);
    else state.selectedNodeIds.add(id);
  } else {
    state.selectedNodeIds.clear();
    state.selectedNodeIds.add(id);
  }
  state.inspectorNodeId = state.selectedNodeIds.size===1 ? id : null;
  $$('.node').forEach(el => {
    el.classList.toggle('selected', state.selectedNodeIds.has(el.dataset.id));
  });
  renderInspector();
  updateRunButton();
}

function deselectAll(){
  state.selectedNodeIds.clear();
  state.inspectorNodeId = null;
  $$('.node').forEach(el => el.classList.remove('selected'));
  renderInspector();
  updateRunButton();
}

/* ---------- Node drag ---------- */
let dragState = null;
function startNodeDrag(e, node){
  if(e.button!==0) return;
  if(e.target.classList.contains('port')) return;
  const canvasRect = $('#canvas-wrap').getBoundingClientRect();
  const startX = e.clientX, startY = e.clientY;
  const origPos = { x: node.position.x, y: node.position.y };
  dragState = { node, startX, startY, origPos, canvasRect, moved:false };
  window.addEventListener('mousemove', onNodeDragMove);
  window.addEventListener('mouseup', onNodeDragEnd);
}
function onNodeDragMove(e){
  if(!dragState) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if(Math.abs(dx)>2 || Math.abs(dy)>2) dragState.moved = true;
  const node = dragState.node;
  node.position.x = Math.max(0, dragState.origPos.x + dx);
  node.position.y = Math.max(0, dragState.origPos.y + dy);
  const el = document.querySelector(`.node[data-id="${node.id}"]`);
  if(el){ el.style.left = node.position.x+'px'; el.style.top = node.position.y+'px'; }
  renderEdges();
}
function onNodeDragEnd(){
  dragState = null;
  window.removeEventListener('mousemove', onNodeDragMove);
  window.removeEventListener('mouseup', onNodeDragEnd);
}

/* ---------- Edge drag (connect nodes) ---------- */
let edgeDragState = null;
function startEdgeDrag(e, node, portName, dir){
  if(dir!=='out') return;
  const startPos = portPos(node, portName, 'out');
  edgeDragState = { sourceNode: node.id, sourcePort: portName, startPos };
  const svg = $('#edges-svg');
  const tempPath = document.createElementNS('http://www.w3.org/2000/svg','path');
  tempPath.setAttribute('class','temp-edge');
  tempPath.setAttribute('d', `M ${startPos.x} ${startPos.y} L ${startPos.x} ${startPos.y}`);
  tempPath.id = '_temp-edge';
  svg.appendChild(tempPath);
  window.addEventListener('mousemove', onEdgeDragMove);
  window.addEventListener('mouseup', onEdgeDragEnd);
}
function onEdgeDragMove(e){
  if(!edgeDragState) return;
  const canvasRect = $('#canvas-wrap').getBoundingClientRect();
  const x = e.clientX - canvasRect.left + $('#canvas-wrap').scrollLeft;
  const y = e.clientY - canvasRect.top + $('#canvas-wrap').scrollTop;
  const sp = edgeDragState.startPos;
  const path = bezierPath(sp, {x,y});
  $('#_temp-edge').setAttribute('d', path);
}
function onEdgeDragEnd(e){
  if(!edgeDragState){ cleanupEdgeDrag(); return; }
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if(target && target.classList.contains('port') && target.dataset.dir==='in'){
    const targetNodeId = target.dataset.node;
    const targetPort = target.dataset.port;
    if(targetNodeId !== edgeDragState.sourceNode){
      const exists = state.edges.some(ed => ed.sourceNode===edgeDragState.sourceNode && ed.sourcePort===edgeDragState.sourcePort && ed.targetNode===targetNodeId && ed.targetPort===targetPort);
      if(!exists){
        state.edges.push({
          id: uuid(),
          sourceNode: edgeDragState.sourceNode,
          sourcePort: edgeDragState.sourcePort,
          targetNode: targetNodeId,
          targetPort: targetPort,
        });
        renderEdges();
        toast('Connected');
      } else {
        toast('Edge already exists');
      }
    }
  }
  cleanupEdgeDrag();
}
function cleanupEdgeDrag(){
  edgeDragState = null;
  const tp = $('#_temp-edge');
  if(tp) tp.remove();
  window.removeEventListener('mousemove', onEdgeDragMove);
  window.removeEventListener('mouseup', onEdgeDragEnd);
}

/* ---------- Canvas blank click: deselect ----------
   Scripts are at the end of <body>, so #canvas already exists when this runs. */
(function bindCanvasBlankClick(){
  const cv = $('#canvas');
  if(cv){
    cv.addEventListener('mousedown', e => {
      if(e.target.id==='canvas' || e.target.id==='edges-svg' || e.target.tagName==='svg'){
        deselectAll();
      }
    });
  }
})();

/* ---------- Keyboard shortcuts ---------- */
document.addEventListener('keydown', e => {
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;

  if((e.metaKey||e.ctrlKey) && e.shiftKey && (e.key==='R'||e.key==='r')){
    e.preventDefault();
    runWorkflow();
    return;
  }
  if((e.key==='Delete'||e.key==='Backspace') && state.selectedNodeIds.size>0){
    e.preventDefault();
    deleteSelected();
    return;
  }
  if((e.metaKey||e.ctrlKey) && (e.key==='c'||e.key==='C') && state.selectedNodeIds.size>0){
    e.preventDefault();
    copySelection();
    return;
  }
  if((e.metaKey||e.ctrlKey) && (e.key==='v'||e.key==='V') && state.clipboard){
    e.preventDefault();
    pasteSelection();
    return;
  }
});

function deleteSelected(){
  const ids = Array.from(state.selectedNodeIds);
  state.nodes = state.nodes.filter(n => !ids.includes(n.id));
  state.edges = state.edges.filter(e => !ids.includes(e.sourceNode) && !ids.includes(e.targetNode));
  state.selectedNodeIds.clear();
  state.inspectorNodeId = null;
  renderCanvas();
  renderInspector();
  updateRunButton();
  toast(`Deleted ${ids.length} node(s)`);
}

function copySelection(){
  state.clipboard = Array.from(state.selectedNodeIds).map(id => {
    const n = state.nodes.find(x=>x.id===id);
    return n ? JSON.parse(JSON.stringify(n)) : null;
  }).filter(Boolean);
  toast(`Copied ${state.clipboard.length} node(s)`);
}
function pasteSelection(){
  if(!state.clipboard) return;
  const newIds = [];
  for(const n of state.clipboard){
    const copy = JSON.parse(JSON.stringify(n));
    copy.id = uuid();
    copy.position = { x: n.position.x + 20, y: n.position.y + 20 };
    copy.runState = 'idle';
    state.nodes.push(copy);
    newIds.push(copy.id);
  }
  state.selectedNodeIds = new Set(newIds);
  state.inspectorNodeId = newIds.length===1 ? newIds[0] : null;
  renderCanvas();
  renderInspector();
  updateRunButton();
  toast(`Pasted ${newIds.length} node(s)`);
}

/* ---------- Palette drag → new node ---------- */
(function bindPalette(){
  const nodes = $$('.palette-node');
  nodes.forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/node-type', el.dataset.t);
      e.dataTransfer.effectAllowed = 'copy';
    });
  });
  const wrap = $('#canvas-wrap');
  if(!wrap) return;
  wrap.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/node-type');
    if(!type) return;
    const rect = $('#canvas-wrap').getBoundingClientRect();
    const x = e.clientX - rect.left + $('#canvas-wrap').scrollLeft - 93;
    const y = e.clientY - rect.top + $('#canvas-wrap').scrollTop - 43;
    addNode(type, { x: Math.max(0,x), y: Math.max(0,y) });
  });
})();

/* ---------- Add new node (with adversarial support) ---------- */
function addNode(type, position){
  const id = 'n' + uuid().slice(0,8);
  const base = { id, type, position, title: NODE_TYPES[type].label, runState:'idle' };
  if(type==='agent')        Object.assign(base, { agentName:'qwen-plus', prompt:'' });
  if(type==='convergence')  Object.assign(base, { agentName:'qwen-plus', prompt:'', reviewPrompt:'', maxRounds:3 });
  if(type==='adversarial')  Object.assign(base, { agentName:'qwen-plus', prompt:'', adversarialPrompt:'' });
  if(type==='condition')    Object.assign(base, { conditionExpression:'true' });
  if(type==='humanReview')  Object.assign(base, { reviewInstructions:'' });
  if(type==='deliver')      Object.assign(base, { outputPath:'./output.md' });
  state.nodes.push(base);
  renderCanvas();
  selectNode(id, false);
  toast(`Added ${NODE_TYPES[type].label} node`);
}

/* ============================================================
   Expose on shared namespace
   ============================================================ */
window.App.renderCanvas = renderCanvas;
window.App.createNodeElement = createNodeElement;
window.App.renderEdges = renderEdges;
window.App.selectNode = selectNode;
window.App.deselectAll = deselectAll;
window.App.addNode = addNode;
window.App.deleteSelected = deleteSelected;
window.App.copySelection = copySelection;
window.App.pasteSelection = pasteSelection;
