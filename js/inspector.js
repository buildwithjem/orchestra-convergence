/* Orchestra Competition — file: js/inspector.js
   Inspector panel rendering and field bindings.
   Handles all node types including adversarial (extra Adversarial Prompt field).
   Depends on globals from app.js (state, NODE_TYPES, AGENT_CONFIGS, utilities)
   and engine.js (resolveReview). */
window.App = window.App || {};

/* ============================================================
   Inspector panel
   ============================================================ */
function renderInspector(){
  const body = $('#insp-body');
  const idEl = $('#insp-node-id');
  const node = state.nodes.find(n => n.id === state.inspectorNodeId);

  if(state.selectedNodeIds.size === 0){
    body.innerHTML = `<div class="insp-empty"><span class="icon">◇</span>Select a node to edit</div>`;
    idEl.textContent = '';
    return;
  }
  if(state.selectedNodeIds.size > 1){
    body.innerHTML = `<div class="insp-empty"><span class="icon">▦</span>${state.selectedNodeIds.size} node(s) selected<br><span style="font-size:11px">Press ⌘C to copy / Del to delete</span></div>`;
    idEl.textContent = '';
    return;
  }
  if(!node){
    body.innerHTML = `<div class="insp-empty"><span class="icon">◇</span>Select a node to edit</div>`;
    idEl.textContent = '';
    return;
  }
  idEl.textContent = '#' + shortId(node.id);
  const t = NODE_TYPES[node.type];
  const accent = t.accent;

  let html = `<div class="insp-section">
    <div class="sec-title"><span class="dot" style="background:${accent}"></span>${t.label}</div>
    <div class="sec-body">
      <div class="field"><label>Title</label><input type="text" data-field="title" value="${escapeHtml(node.title)}"></div>`;

  // Agent / Convergence / Adversarial → binding + system prompt + task
  if(node.type==='agent' || node.type==='convergence' || node.type==='adversarial'){
    const agents = Object.keys(AGENT_CONFIGS);
    html += `<div class="field"><label>Binding</label><select data-field="agentName">` +
      agents.map(a => `<option value="${a}" ${node.agentName===a?'selected':''}>${AGENT_CONFIGS[a].displayName}</option>`).join('') +
      `</select></div>`;
    const cfg = AGENT_CONFIGS[node.agentName];
    html += `<div class="field"><label>Type</label><div class="readonly"><span class="v">${cfg?cfg.type:'—'}</span></div></div>`;
    html += `<div class="field"><label>System Prompt</label><textarea class="code" readonly>${escapeHtml(cfg?cfg.systemPrompt:'')}</textarea></div>`;
    html += `</div></div><div class="insp-section"><div class="sec-title"><span class="dot" style="background:${accent}"></span>Task</div><div class="sec-body">`;
    html += `<div class="field"><label>Prompt</label><textarea data-field="prompt">${escapeHtml(node.prompt||'')}</textarea></div>`;
  }

  // Adversarial-only: Adversarial Prompt
  if(node.type==='adversarial'){
    html += `<div class="field"><label>Adversarial Prompt</label><textarea data-field="adversarialPrompt" placeholder="Red-team instructions: how this agent challenges reviewers">${escapeHtml(node.adversarialPrompt||'')}</textarea></div>`;
    html += `<div class="field-hint">The adversarial agent receives upstream reviewer outputs and attacks them. If left empty, the system prompt is used.</div>`;
  }

  // Convergence-only: review prompt + max rounds
  if(node.type==='convergence'){
    html += `<div class="field"><label>Review Prompt</label><textarea data-field="reviewPrompt" placeholder="empty = pass through">${escapeHtml(node.reviewPrompt||'')}</textarea></div>`;
    html += `<div class="field"><label>Max Rounds</label><input type="number" min="1" max="10" data-field="maxRounds" value="${node.maxRounds||3}"></div>`;
    if(!node.reviewPrompt){
      html += `<div class="field-warn">⚠ Review Prompt empty → convergence passes through, no review.</div>`;
    }
  }

  // Condition node
  if(node.type==='condition'){
    html += `</div></div><div class="insp-section"><div class="sec-title"><span class="dot" style="background:${accent}"></span>Condition</div><div class="sec-body">`;
    html += `<div class="field"><label>Expression</label><textarea class="code" data-field="conditionExpression" placeholder="true / false / 1 / 0">${escapeHtml(node.conditionExpression||'')}</textarea></div>`;
    html += `<div class="field-hint">Demo: "true"/"1" → out-0, "false"/"0" → out-1</div>`;
    html += `</div></div><div class="insp-section"><div class="sec-title"><span class="dot" style="background:${accent}"></span>Upstream References</div><div class="sec-body">`;
    const upstream = findUpstream(node);
    if(upstream.length===0){
      html += `<div style="font-size:11px;color:var(--text-3)">No upstream nodes</div>`;
    } else {
      html += `<div class="upstream-list">`;
      upstream.forEach(u => { html += `<div class="item"><span>${escapeHtml(u.title)}</span><span class="uuid">${shortId(u.id)}</span></div>`; });
      html += `</div>`;
    }
  }

  // Human review node
  if(node.type==='humanReview'){
    html += `</div></div><div class="insp-section"><div class="sec-title"><span class="dot" style="background:${accent}"></span>Human Review</div><div class="sec-body">`;
    html += `<div class="field"><label>Review Instructions</label><textarea data-field="reviewInstructions">${escapeHtml(node.reviewInstructions||'')}</textarea></div>`;
    if(node.runState === 'waitingForReview'){
      html += `<div class="field-warn" style="background:rgba(24,213,139,.12);border-color:rgba(24,213,139,.45);color:var(--success)">Waiting for human review</div>`;
      html += `<div class="review-actions">
        <button class="btn" data-review-action="approve">Approve</button>
        <button class="btn danger" data-review-action="reject">Reject</button>
      </div>`;
    }
  }

  // Deliver node
  if(node.type==='deliver'){
    html += `</div></div><div class="insp-section"><div class="sec-title"><span class="dot" style="background:${accent}"></span>Deliver</div><div class="sec-body">`;
    html += `<div class="field"><label>Output Path</label><input type="text" data-field="outputPath" value="${escapeHtml(node.outputPath||'')}"></div>`;
  }

  html += `</div></div>`;

  // Runtime section (only when node has run)
  if(node.runState && node.runState!=='idle'){
    html += `<div class="insp-section"><div class="sec-title"><span class="dot" style="background:#888"></span>Runtime</div><div class="sec-body">`;
    html += `<div class="field"><label>State</label><div class="readonly"><span class="v">${node.runState}</span></div></div>`;
    if(node.output) html += `<div class="field"><label>Output</label><textarea class="code" readonly>${escapeHtml(node.output)}</textarea></div>`;
    html += `</div></div>`;
  }

  body.innerHTML = html;

  // Bind field inputs
  body.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('input', e => {
      const field = input.dataset.field;
      let v = input.value;
      if(input.type==='number') v = parseInt(v)||1;
      node[field] = v;
      if(field==='title' || field==='agentName'){
        const el = document.querySelector(`.node[data-id="${node.id}"]`);
        if(el){
          const newEl = createNodeElement(node);
          el.replaceWith(newEl);
        }
        renderEdges();
      }
      if((field==='reviewPrompt' && node.type==='convergence') ||
         (field==='adversarialPrompt' && node.type==='adversarial')){
        // No re-render needed for these (no conditional UI depends on them being empty)
      }
    });
  });

  // Bind review-action buttons (resolveReview lives in engine.js)
  body.querySelectorAll('[data-review-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      const approved = btn.dataset.reviewAction === 'approve';
      resolveReview(node.id, approved);
    });
  });
}

/* ---------- Upstream lookup ---------- */
function findUpstream(node){
  const upstreamIds = state.edges.filter(e => e.targetNode === node.id).map(e => e.sourceNode);
  return state.nodes.filter(n => upstreamIds.includes(n.id));
}

/* ============================================================
   Run / Stop button state
   ============================================================ */
function updateRunButton(){
  const btn = $('#run-btn');
  const sel = state.selectedNodeIds.size;
  if(state.isRunning){
    btn.disabled = true;
    btn.innerHTML = 'Running...';
    return;
  }
  btn.disabled = false;
  if(sel===0) btn.innerHTML = 'Run <span class="kbd">⌘⇧R</span>';
  else if(sel===1) btn.innerHTML = 'Run Node <span class="kbd">⌘⇧R</span>';
  else btn.innerHTML = `Run Selection (${sel}/${state.nodes.length}) <span class="kbd">⌘⇧R</span>`;
}

function updateStopButton(){
  $('#stop-btn').disabled = !state.isRunning;
}

/* ============================================================
   Expose on shared namespace
   ============================================================ */
window.App.renderInspector = renderInspector;
window.App.findUpstream = findUpstream;
window.App.updateRunButton = updateRunButton;
window.App.updateStopButton = updateStopButton;
