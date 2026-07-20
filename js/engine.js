/* Orchestra Competition — file: js/engine.js
   Workflow execution engine: topological sort, node execution,
   run loop, real Qwen API calls (replacing the mock simulate functions),
   adversarial node execution, condition routing, human review,
   output panel rendering. Depends on globals from app.js (state,
   utilities), api.js (window.QwenAPI), inspector.js (updateNodeUI helpers
   live here; renderInspector/findUpstream are in inspector.js). */
window.App = window.App || {};

/* ============================================================
   Topological sort (Kahn's algorithm)
   ============================================================ */
function topoSort(nodes, edges){
  const inDeg = {};
  const adj = {};
  nodes.forEach(n => { inDeg[n.id]=0; adj[n.id]=[]; });
  edges.forEach(e => {
    if(inDeg.hasOwnProperty(e.sourceNode) && inDeg.hasOwnProperty(e.targetNode)){
      adj[e.sourceNode].push(e.targetNode);
      inDeg[e.targetNode]++;
    }
  });
  const queue = nodes.filter(n => inDeg[n.id]===0).map(n=>n.id);
  const result = [];
  while(queue.length){
    const id = queue.shift();
    const n = nodes.find(x=>x.id===id);
    if(n) result.push(n);
    for(const next of adj[id]){
      inDeg[next]--;
      if(inDeg[next]===0) queue.push(next);
    }
  }
  // fallback: append any cyclic / unscheduled nodes
  nodes.forEach(n => { if(!result.find(r=>r.id===n.id)) result.push(n); });
  return result;
}

/* ---------- Selection + BFS upstream closure ---------- */
function computeSelectionWithUpstream(selectedIds){
  const sel = new Set(selectedIds);
  const queue = [...selectedIds];
  while(queue.length){
    const id = queue.shift();
    state.edges.filter(e => e.targetNode === id).forEach(e => {
      if(!sel.has(e.sourceNode)){
        sel.add(e.sourceNode);
        queue.push(e.sourceNode);
      }
    });
  }
  return state.nodes.filter(n => sel.has(n.id));
}

/* ============================================================
   Run main flow
   ============================================================ */
async function runWorkflow(){
  if(state.isRunning) return;
  state.isRunning = true;
  state.isCancelled = false;
  updateRunButton();
  updateStopButton();
  $('#output-live').style.display = 'flex';
  $('#status-bar').classList.add('show');
  $('#status-bar').innerHTML = `<span>● Running</span><span class="sep">|</span><span id="status-info">Initializing...</span>`;

  state.nodes.forEach(n => {
    n.runState = 'idle';
    n.output = null;
  });
  state.nodeStartTimes = {};
  state.nodeIter = {};
  state.runLog = [];
  state.expandedGroups = new Set(['_sys']);
  renderCanvas();
  scheduleRenderOutput();

  const sel = Array.from(state.selectedNodeIds);
  let execNodes = sel.length===0 ? state.nodes : computeSelectionWithUpstream(sel);
  const execIds = new Set(execNodes.map(n=>n.id));
  const execEdges = state.edges.filter(e => execIds.has(e.sourceNode) && execIds.has(e.targetNode));
  const sorted = topoSort(execNodes, execEdges);

  state.runRecord = {
    id: uuid(),
    workflowName: state.currentTemplateId || 'orchestra-workflow',
    status: 'inProgress',
    startedAt: now(),
    finishedAt: null,
    steps: [],
    variables: {},
    resumedFromRunId: null,
  };
  $('#export-btn').disabled = true;

  appendSystemLog(`▶ Run ${shortId(state.runRecord.id)} started · ${sorted.length} node(s) in execution set`);

  for(const node of sorted){
    if(state.isCancelled) break;
    await executeNode(node);
  }

  state.runRecord.finishedAt = now();
  if(state.isCancelled){
    state.runRecord.status = 'cancelled';
    appendSystemLog('■ Run cancelled');
  } else {
    state.runRecord.status = 'completed';
    appendSystemLog(`✓ Run completed · ${fmtDuration(state.runRecord.finishedAt - state.runRecord.startedAt)}`);
    burstSuccess();
  }

  state.isRunning = false;
  updateRunButton();
  updateStopButton();
  $('#output-live').style.display = 'none';
  $('#status-bar').classList.remove('show');
  $('#export-btn').disabled = false;
  scheduleRenderOutput();
}

/* ---------- Success burst ---------- */
function burstSuccess(){
  const bar = $('#status-bar');
  bar.classList.add('show');
  bar.style.background = 'rgba(24,213,139,.16)';
  bar.style.borderTopColor = 'var(--success)';
  bar.innerHTML = `<span>✓ Run complete</span><span class="sep">|</span><span>All nodes converged</span>`;
  setTimeout(()=>{ bar.classList.remove('show'); bar.style.background=''; bar.style.borderTopColor=''; }, 1800);
}

/* ============================================================
   executeNode — dispatches by node type to the simulate/run functions
   ============================================================ */
async function executeNode(node){
  if(node.runState === 'skipped') return;
  if(node.runState === 'completed') return;

  node.runState = 'running';
  state.nodeStartTimes[node.id] = now();
  updateNodeUI(node);
  appendRunLog(node.id, node.title, '', 'info', true);
  setStatusInfo(`${node.title} · running`);

  try {
    switch(node.type){
      case 'agent':       await simulateAgentRun(node); break;
      case 'adversarial': await simulateAdversarialRun(node); break;
      case 'convergence': await simulateConvergenceRun(node); break;
      case 'condition':   simulateConditionEval(node); break;
      case 'humanReview': await simulateHumanReview(node); break;
      case 'deliver':     simulateDeliver(node); break;
    }
    if(node.runState !== 'cancelled' && node.runState !== 'failed' && node.runState !== 'waitingForReview'){
      node.runState = 'completed';
    }
    state.runRecord.steps.push({
      stepId: node.id, title: node.title, status: node.runState,
      startedAt: state.nodeStartTimes[node.id], finishedAt: now(),
      output: node.output || null, error: node.runState==='failed' ? 'failed' : null,
    });
  } catch(e){
    node.runState = 'failed';
    appendRunLog(node.id, node.title, `[error] ${e.message}`, 'error');
    state.runRecord.steps.push({
      stepId: node.id, title: node.title, status:'failed',
      startedAt: state.nodeStartTimes[node.id], finishedAt: now(),
      output:null, error: e.message,
    });
  }
  delete state.nodeStartTimes[node.id];
  delete state.nodeIter[node.id];
  updateNodeUI(node);
  renderInspector();
}

function updateNodeUI(node){
  const el = document.querySelector(`.node[data-id="${node.id}"]`);
  if(el){
    el.dataset.state = node.runState || 'idle';
    const oldPill = el.querySelector('.status-pill'); if(oldPill) oldPill.remove();
    const oldIter = el.querySelector('.iter-badge'); if(oldIter) oldIter.remove();
    if(node.runState && node.runState!=='idle'){
      const pill = document.createElement('div');
      pill.className = 'status-pill ' + node.runState;
      pill.textContent = statusLabel(node.runState);
      el.appendChild(pill);
    }
    const iter = state.nodeIter[node.id];
    if(node.runState==='running' && iter){
      const ib = document.createElement('div');
      ib.className = 'iter-badge';
      ib.textContent = `↻ ${iter.iter}/${iter.max}`;
      el.appendChild(ib);
    }
  }
  renderEdges();
  scheduleRenderOutput();
}

function setStatusInfo(msg){
  const el = $('#status-info');
  if(el) el.textContent = msg;
}

/* ============================================================
   Real Qwen API execution functions
   ============================================================ */

/* ---------- Agent run — real Qwen API call with streaming ---------- */
async function simulateAgentRun(node){
  const model = node.agentName || 'qwen-plus';
  const cfg = AGENT_CONFIGS[model] || AGENT_CONFIGS['qwen-plus'];
  const systemPrompt = cfg ? cfg.systemPrompt : 'You are a helpful assistant.';

  // Gather upstream outputs (e.g. Producer output for Reviewer nodes)
  const upstream = findUpstream(node);
  const upstreamOutputs = upstream
    .filter(u => u.output)
    .map(u => `--- ${u.title} ---\n${u.output}`)
    .join('\n\n');

  let userContent = node.prompt || '(empty prompt)';
  if(upstreamOutputs){
    userContent = `${userContent}\n\n${upstreamOutputs}`;
  }

  const messages = [
    { role:'system', content: systemPrompt },
    { role:'user',   content: userContent },
  ];

  appendRunLog(node.id, node.title, `→ Calling Qwen API (${model})...`, 'info');

  const fullText = await window.QwenAPI.chat(model, messages, {
    stream: true,
    temperature: 0.7,
    max_tokens: 2048,
    onChunk: (delta) => {
      appendRunLog(node.id, node.title, delta, 'output');
    }
  });

  node.output = fullText;
}

/* ---------- Adversarial run — challenges upstream reviewer outputs ---------- */
async function simulateAdversarialRun(node){
  const model = node.agentName || 'qwen-plus';
  const cfg = AGENT_CONFIGS[model] || AGENT_CONFIGS['qwen-plus'];

  // Gather upstream outputs (reviewers / agents feeding into this node)
  const upstream = findUpstream(node);
  const upstreamOutputs = upstream
    .filter(u => u.output)
    .map(u => `--- ${u.title} (model: ${u.agentName||'?'}) ---\n${u.output}`)
    .join('\n\n');

  if(!upstreamOutputs){
    appendRunLog(node.id, node.title, 'No upstream reviewer outputs available — skipping adversarial challenge.', 'info');
    node.output = 'NO CHALLENGE — no upstream content.';
    return;
  }

  const adversarialInstructions = node.adversarialPrompt || cfg.systemPrompt ||
    'You are a red-team adversarial reviewer. Find flaws the reviewers missed.';

  const messages = [
    { role:'system', content: adversarialInstructions },
    { role:'user',   content: `Reviewer outputs to challenge:\n\n${upstreamOutputs}\n\nIf the reviews are sound, say "NO CHALLENGE" and explain why. Otherwise list concrete missed flaws.` },
  ];

  appendRunLog(node.id, node.title, `⚡ Adversarial challenge on ${upstream.length} upstream output(s) — calling ${model}...`, 'info');

  const fullText = await window.QwenAPI.chat(model, messages, {
    stream: true,
    temperature: 0.5,
    max_tokens: 2048,
    onChunk: (delta) => {
      appendRunLog(node.id, node.title, delta, 'output');
    }
  });

  node.output = fullText;

  // Detect challenge outcome for downstream condition node
  const challenged = !/\bNO\s+CHALLENGE\b/i.test(fullText);
  appendRunLog(node.id, node.title,
    challenged
      ? `⚡ Challenge raised — downstream condition should route to feedback loop.`
      : `✓ No challenge — reviews are sound.`,
    'info');
}

/* ---------- Convergence run — real iterative loop ---------- */
async function simulateConvergenceRun(node){
  const maxIter = node.maxRounds || 3;
  const model = node.agentName || 'qwen-plus';
  const cfg = AGENT_CONFIGS[model] || AGENT_CONFIGS['qwen-plus'];

  // Gather upstream outputs as context
  const upstream = findUpstream(node);
  const upstreamContext = upstream
    .filter(u => u.output)
    .map(u => `--- ${u.title} ---\n${u.output}`)
    .join('\n\n');

  let currentPrompt = node.prompt || '';
  if(upstreamContext){
    currentPrompt = `${currentPrompt}\n\nUpstream context:\n${upstreamContext}`;
  }

  for(let iter=1; iter<=maxIter; iter++){
    if(state.isCancelled) return;
    state.nodeIter[node.id] = { iter, max: maxIter };
    updateNodeUI(node);
    appendRunLog(node.id, node.title, `=== Iteration ${iter}/${maxIter} ===`, 'info');

    // Generate / aggregate
    const genMessages = [
      { role:'system', content: cfg.systemPrompt },
      { role:'user',   content: currentPrompt },
    ];
    const generated = await window.QwenAPI.chat(model, genMessages, {
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
      onChunk: (delta) => appendRunLog(node.id, node.title, delta, 'output')
    });
    node.output = generated;

    if(state.isCancelled) return;

    if(!node.reviewPrompt){
      appendRunLog(node.id, node.title, 'Review Prompt empty → pass through', 'info');
      return;
    }

    // Review
    const reviewMessages = [
      { role:'system', content: 'You are a critical reviewer. Evaluate the output against the review prompt. Reply "PASS" if acceptable, otherwise "FAIL" and give specific feedback.' },
      { role:'user',   content: `Review Prompt: ${node.reviewPrompt}\n\nOutput to review:\n${generated}` },
    ];
    const review = await window.QwenAPI.chat(model, reviewMessages, {
      stream: true,
      temperature: 0.3,
      max_tokens: 1024,
      onChunk: (delta) => appendRunLog(node.id, node.title, delta, 'reasoning')
    });

    if(state.isCancelled) return;

    const passed = /\bPASS\b/i.test(review) && !/\bFAIL\b/i.test(review);

    if(passed || iter >= maxIter){
      appendRunLog(node.id, node.title,
        passed
          ? `Review: PASS — iteration ${iter} reached quality bar, convergence done.`
          : `Review: MAX_ITER — iteration ${iter}/${maxIter} did not pass but no more rounds allowed.`,
        'info');
      return;
    } else {
      appendRunLog(node.id, node.title, `Review: LOOP — iteration ${iter} did not pass, regenerating with feedback.`, 'info');
      // Inject feedback into the prompt for next round
      currentPrompt = `${node.prompt}\n\nUpstream context:\n${upstreamContext}\n\n[Feedback from reviewer iter ${iter}]: ${review}`;
      await sleep(80);
    }
  }
}

/* ---------- Condition evaluation ---------- */
function simulateConditionEval(node){
  const expr = (node.conditionExpression||'').trim();
  const result = expr==='true' || expr==='1';
  appendRunLog(node.id, node.title, `Condition: "${expr}" → ${result? 'TRUE → out-0':'FALSE → out-1'}`, 'output');
  const falsePort = result ? 'out-1' : 'out-0';
  const skippedEdges = state.edges.filter(e => e.sourceNode===node.id && e.sourcePort===falsePort);
  for(const e of skippedEdges){
    const tgt = state.nodes.find(n=>n.id===e.targetNode);
    if(tgt){
      markSkippedDownstream(tgt.id);
    }
  }
}
function markSkippedDownstream(nodeId){
  const n = state.nodes.find(x=>x.id===nodeId);
  if(!n) return;
  n.runState = 'skipped';
  state.runRecord.steps.push({
    stepId:n.id, title:n.title, status:'skipped',
    startedAt:null, finishedAt:null, output:null, error:null,
  });
  appendRunLog(n.id, n.title, 'Skipped (condition false branch)', 'info');
  updateNodeUI(n);
  state.edges.filter(e=>e.sourceNode===nodeId).forEach(e => markSkippedDownstream(e.targetNode));
}

/* ---------- Human review ---------- */
async function simulateHumanReview(node){
  appendRunLog(node.id, node.title, `⏸ Waiting for human review: ${node.reviewInstructions||'(no instructions)'}`, 'info');
  node.runState = 'waitingForReview';
  state.selectedNodeIds.clear();
  state.selectedNodeIds.add(node.id);
  state.inspectorNodeId = node.id;
  $$('.node').forEach(el => el.classList.toggle('selected', el.dataset.id === node.id));
  updateNodeUI(node);
  renderInspector();
  setStatusInfo(`${node.title} · waiting for review · handle in the Inspector`);

  await new Promise(resolve => {
    state.pendingReview = { stepId: node.id, resolve };
  });

  const approved = state.pendingReview.approved;
  appendRunLog(node.id, node.title, `Human review: ${approved?'APPROVED ✓':'REJECTED ✗'}`, 'output');
  node.runState = approved ? 'completed' : 'cancelled';
  if(!approved){
    state.edges.filter(e=>e.sourceNode===node.id).forEach(e => markSkippedDownstream(e.targetNode));
  }
}

function resolveReview(stepId, approved){
  if(!state.pendingReview || state.pendingReview.stepId !== stepId) return;
  state.pendingReview.approved = approved;
  state.pendingReview.resolve();
}

/* ---------- Deliver ---------- */
function simulateDeliver(node){
  appendRunLog(node.id, node.title, `📄 Delivered to: ${node.outputPath||'(no path)'}`, 'success');
  // find a convergence / adversarial / agent output upstream to use as delivery content
  const upstream = findUpstream(node);
  const source = upstream.find(u => u.output) || state.nodes.find(n => n.output);
  const content = source ? source.output : '(no upstream output)';
  appendRunLog(node.id, node.title, `Delivered content:\n${content}`, 'output');
}

/* ---------- Cancel ---------- */
function stopWorkflow(){
  if(!state.isRunning) return;
  state.isCancelled = true;
  state.nodes.forEach(n => {
    if(n.runState==='running' || n.runState==='waitingForReview'){
      n.runState = 'cancelled';
      updateNodeUI(n);
      if(state.pendingReview && state.pendingReview.stepId === n.id){
        state.pendingReview.approved = false;
        state.pendingReview.resolve();
      }
    }
  });
  appendSystemLog('■ Stop requested — current node marked cancelled');
}

/* ============================================================
   RunLog / OutputPanel
   ============================================================ */
function appendRunLog(stepId, stepTitle, text, level, headerOnly){
  const streamable = level==='reasoning' || level==='output';
  if(!headerOnly && text && streamable){
    const last = state.runLog[state.runLog.length-1];
    if(last && last.stepId===stepId && last.level===level){
      last.text += (last.text? '\n':'') + text;
      scheduleRenderOutput();
      return;
    }
  }
  state.runLog.push({
    id: uuid(),
    timestamp: now(),
    stepId,
    stepTitle,
    text: text || '',
    level: level || 'info',
  });
  scheduleRenderOutput();
}

function appendSystemLog(text){
  state.runLog.push({
    id: uuid(),
    timestamp: now(),
    stepId: null,
    stepTitle: 'System',
    text,
    level: 'system',
  });
  scheduleRenderOutput();
}

/* ---------- rAF-batched render ---------- */
let _roScheduled = false;
function scheduleRenderOutput(){
  if(_roScheduled) return;
  _roScheduled = true;
  requestAnimationFrame(() => { _roScheduled = false; renderOutput(); });
}

function renderOutput(){
  const body = $('#output-body');
  if(!body) return;
  if(state.runLog.length===0){
    body.innerHTML = `<div class="output-empty">Streaming output will appear here grouped by node after running the workflow.</div>`;
    return;
  }

  const groups = [];
  const groupMap = {};
  state.runLog.forEach(e => {
    if(e.stepId===null){
      if(groupMap['_sys']===undefined){ groupMap['_sys']=groups.length; groups.push({stepId:null, stepTitle:'System', entries:[], level:'system'}); }
      groups[groupMap['_sys']].entries.push(e);
    }
  });
  state.runLog.forEach(e => {
    if(e.stepId===null) return;
    if(groupMap[e.stepId]===undefined){
      groupMap[e.stepId] = groups.length;
      groups.push({stepId:e.stepId, stepTitle:e.stepTitle, entries:[]});
    }
    groups[groupMap[e.stepId]].entries.push(e);
  });

  const nodeStatus = id => {
    if(id===null) return 'system';
    const n = state.nodes.find(x=>x.id===id);
    return n ? (n.runState||'idle') : 'idle';
  };

  let html = '';
  for(const g of groups){
    const status = nodeStatus(g.stepId);
    const groupKey = g.stepId===null ? '_sys' : g.stepId;
    const expanded = state.expandedGroups.has(groupKey);
    const reasoningCount = g.entries.filter(e=>e.level==='reasoning').length;
    const outputCount = g.entries.filter(e=>['output','success','info','error'].includes(e.level)).length;
    const statusIcon = statusIconFor(status);
    const isRunning = status==='running' || status==='waitingForReview';
    const dur = state.nodeStartTimes[g.stepId] ? now()-state.nodeStartTimes[g.stepId] : null;

    html += `<div class="log-group">`;
    html += `<div class="log-group-header ${expanded?'expanded':''}" data-toggle="${groupKey}">`;
    html += `<span class="arrow">▶</span>`;
    html += `<span class="status-icon ${status}">${statusIcon}</span>`;
    html += `<span class="title-text">${escapeHtml(g.stepTitle)}</span>`;
    if(reasoningCount>0) html += `<span class="count reasoning">🧠 ${reasoningCount}</span>`;
    if(outputCount>0) html += `<span class="count">📝 ${outputCount}</span>`;
    if(isRunning && dur!=null) html += `<span class="duration">${fmtDuration(dur)}</span>`;
    html += `<span class="pill ${status}">${statusLabel(status)}</span>`;
    html += `</div>`;
    if(expanded){
      html += `<div class="log-group-body expanded">`;
      for(const e of g.entries){
        if(!e.text) continue;
        html += `<div class="log-line ${e.level}">${escapeHtml(e.text)}</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }
  body.innerHTML = html;

  body.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.toggle;
      if(state.expandedGroups.has(key)) state.expandedGroups.delete(key);
      else state.expandedGroups.add(key);
      scheduleRenderOutput();
    });
  });

  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  if(atBottom) body.scrollTop = body.scrollHeight;
}

function statusIconFor(status){
  return {
    idle:'○', running:'◌', completed:'✓', failed:'✗',
    cancelled:'⊘', skipped:'⊘', waitingForReview:'⏸', system:'▸'
  }[status] || '○';
}

/* ---------- Refresh running durations every second ---------- */
setInterval(() => {
  if(state.isRunning && state.runLog.some(e => state.nodeStartTimes[e.stepId])){
    scheduleRenderOutput();
  }
}, 1000);

/* ============================================================
   Expose on shared namespace
   ============================================================ */
window.App.topoSort = topoSort;
window.App.computeSelectionWithUpstream = computeSelectionWithUpstream;
window.App.runWorkflow = runWorkflow;
window.App.executeNode = executeNode;
window.App.updateNodeUI = updateNodeUI;
window.App.setStatusInfo = setStatusInfo;
window.App.simulateAgentRun = simulateAgentRun;
window.App.simulateAdversarialRun = simulateAdversarialRun;
window.App.simulateConvergenceRun = simulateConvergenceRun;
window.App.simulateConditionEval = simulateConditionEval;
window.App.simulateHumanReview = simulateHumanReview;
window.App.resolveReview = resolveReview;
window.App.simulateDeliver = simulateDeliver;
window.App.stopWorkflow = stopWorkflow;
window.App.appendRunLog = appendRunLog;
window.App.appendSystemLog = appendSystemLog;
window.App.scheduleRenderOutput = scheduleRenderOutput;
window.App.renderOutput = renderOutput;
