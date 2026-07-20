/* Orchestra Competition — file: js/app.js
   Main orchestrator: utilities, shared state, node-type registry,
   Qwen agent configs, theme, navigation, modal, toolbar bindings,
   API-key modal, template selector, and boot sequence.
   All globals declared here are accessible across the other classic
   script files (no bundler). The window.App namespace exposes the
   public surface explicitly. */
window.App = window.App || {};

/* ============================================================
   Utility functions
   ============================================================ */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random()*16|0; const v = c==='x'?r:(r&0x3|0x8); return v.toString(16);
});
const shortId = id => id ? id.slice(0,8) : '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

function fmtTime(ts){
  if(!ts) return '—';
  const d = new Date(ts); const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtDuration(ms){
  if(!ms || ms<0) return '—';
  if(ms<1000) return `${ms}ms`;
  const s = ms/1000;
  if(s<60) return `${s.toFixed(1)}s`;
  const m=Math.floor(s/60); return `${m}m${Math.floor(s%60)}s`;
}
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.remove('show'),2200);
}
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function statusLabel(s){
  return {
    idle:'idle', running:'running', completed:'completed', failed:'failed',
    cancelled:'cancelled', skipped:'skipped', waitingForReview:'waiting'
  }[s] || s;
}

/* ============================================================
   Node type registry (accent colors)
   ============================================================ */
const NODE_TYPES = {
  agent:        { accent:'rgb(59,130,246)',  label:'Agent',         inPorts:1, outPorts:1 },
  convergence:  { accent:'rgb(124,92,252)',  label:'Convergence',   inPorts:1, outPorts:1 },
  adversarial:  { accent:'rgb(168,85,247)',  label:'Adversarial',   inPorts:1, outPorts:1 }, // purple-500
  condition:    { accent:'rgb(251,191,36)',  label:'Condition',     inPorts:1, outPorts:2 },
  humanReview:  { accent:'rgb(34,211,238)',  label:'Human Review',  inPorts:1, outPorts:1 },
  deliver:      { accent:'rgb(248,113,113)', label:'Deliver',       inPorts:1, outPorts:0 },
};

/* ============================================================
   Qwen agent configs (replaces echo/sleep/trae presets)
   ============================================================ */
const AGENT_CONFIGS = {
  'qwen-plus':  { type:'Qwen API', displayName:'Qwen Plus',  systemPrompt:'You are a helpful Qwen assistant. Be concise and precise.', model:'qwen-plus' },
  'qwen-max':    { type:'Qwen API', displayName:'Qwen Max',    systemPrompt:'You are a helpful Qwen assistant with strong reasoning. Be thorough.', model:'qwen-max' },
  'qwen-turbo':  { type:'Qwen API', displayName:'Qwen Turbo',  systemPrompt:'You are a helpful Qwen assistant. Be fast and concise.', model:'qwen-turbo' },
};

const CLI_PRESETS = [
  { id:'qwen-plus',  displayName:'Qwen Plus',  type:'Qwen API' },
  { id:'qwen-max',    displayName:'Qwen Max',    type:'Qwen API' },
  { id:'qwen-turbo',  displayName:'Qwen Turbo',  type:'Qwen API' },
];

/* ============================================================
   Initial workflow — load Adversarial Convergence template
   (deep-cloned so the template definition stays pristine)
   ============================================================ */
function buildInitialState(){
  const tpl = (window.TEMPLATES || []).find(t => t.id === 'adversarial-convergence') || (window.TEMPLATES||[])[0];
  if(!tpl){
    return { nodes: [], edges: [] };
  }
  return {
    nodes: JSON.parse(JSON.stringify(tpl.nodes)),
    edges: JSON.parse(JSON.stringify(tpl.edges)),
  };
}

/* ============================================================
   Global state (shared across modules)
   ============================================================ */
const _init = buildInitialState();
const state = {
  nodes: _init.nodes,
  edges: _init.edges,
  selectedNodeIds: new Set(),
  inspectorNodeId: null,
  runLog: [],
  runRecord: null,
  runHistory: [],
  isRunning: false,
  isCancelled: false,
  currentRunPromise: null,
  pendingReview: null,
  activePage: 'workflow',
  collapsedGroups: new Set(),
  expandedGroups: new Set(['_sys']),
  nodeStartTimes: {},
  nodeIter: {},
  clipboard: null,
  currentTemplateId: 'adversarial-convergence',
};

/* ============================================================
   Confirm modal (Promise-based)
   ============================================================ */
function confirmGlass(msg){
  return new Promise(resolve => {
    const bd = $('#modal-backdrop');
    $('#modal-msg').textContent = msg;
    bd.classList.add('show');
    const okBtn = $('#modal-ok');
    const cancelBtn = $('#modal-cancel');
    const done = val => {
      bd.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(val);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

/* ============================================================
   Timeline export
   ============================================================ */
function exportTimeline(){
  const r = state.runRecord;
  if(!r){ toast('No run records to export'); return; }
  let md = `# Run Timeline\n\n`;
  md += `- **Run ID**: ${r.id}\n`;
  md += `- **Workflow**: ${r.workflowName}\n`;
  md += `- **Status**: ${r.status}\n`;
  md += `- **Started**: ${fmtTime(r.startedAt)}\n`;
  md += `- **Finished**: ${r.finishedAt ? fmtTime(r.finishedAt) : '—'}\n`;
  md += `- **Duration**: ${fmtDuration((r.finishedAt||now()) - r.startedAt)}\n`;
  if(r.resumedFromRunId) md += `- **Resumed From**: ${r.resumedFromRunId}\n`;
  md += `\n## Steps\n\n`;
  for(const step of r.steps){
    md += `### ${step.title} (${step.status})\n`;
    md += `- Started: ${step.startedAt?fmtTime(step.startedAt):'—'}\n`;
    md += `- Finished: ${step.finishedAt?fmtTime(step.finishedAt):'—'}\n`;
    md += `- Duration: ${(step.startedAt&&step.finishedAt)?fmtDuration(step.finishedAt-step.startedAt):'—'}\n`;
    if(step.output) md += `\n**Output:**\n\`\`\`\n${step.output}\n\`\`\`\n`;
    if(step.error) md += `\n**Error:** ${step.error}\n`;
    md += `\n`;
  }
  md += `## Full Log\n\n`;
  for(const e of state.runLog){
    md += `**[${e.stepTitle}]** (${e.level}) ${e.text}\n\n`;
  }

  const blob = new Blob([md], { type:'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `timeline-${r.id.slice(0,8)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Timeline exported');
}

/* ============================================================
   Theme toggle (dark / light)
   ============================================================ */
let themeToggle;
function applyTheme(t){
  document.documentElement.dataset.theme = t;
  localStorage.setItem('orch-theme', t);
  if(themeToggle) themeToggle.dataset.theme = t;
}
function initTheme(){
  themeToggle = $('#theme-toggle');
  if(!themeToggle) return;
  themeToggle.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    applyTheme(cur === 'light' ? 'dark' : 'light');
  });
  const saved = localStorage.getItem('orch-theme') || 'dark';
  document.documentElement.dataset.theme = saved;
  themeToggle.dataset.theme = saved;
}

/* ============================================================
   Navigation (bottom tabs: Workflow / Benchmark)
   ============================================================ */
function initNavigation(){
  $$('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if(state.activePage === page) return;
      state.activePage = page;
      $$('.nav-tab').forEach(b => b.classList.toggle('active', b===btn));
      $$('.page').forEach(p => p.classList.remove('active'));
      $(`#page-${page}`).classList.add('active');
      if(page === 'benchmark' && typeof renderBenchmarkPage === 'function'){
        renderBenchmarkPage();
      }
    });
  });
}

/* ============================================================
   Toolbar bindings
   ============================================================ */
function initToolbar(){
  $('#run-btn').addEventListener('click', runWorkflow);
  $('#stop-btn').addEventListener('click', stopWorkflow);
  $('#export-btn').addEventListener('click', exportTimeline);
  $('#output-clear').addEventListener('click', () => {
    state.runLog = [];
    scheduleRenderOutput();
    toast('Output cleared');
  });
  $('#output-collapse').addEventListener('click', () => {
    const p = $('#output-panel');
    p.classList.toggle('collapsed');
    $('#output-collapse').textContent = p.classList.contains('collapsed') ? '▸' : '▾';
  });
}

/* ============================================================
   API Key modal
   ============================================================ */
function getApiKey(){ return localStorage.getItem('qwen-api-key') || ''; }
function setApiKey(k){
  const v = (k||'').trim();
  if(v) localStorage.setItem('qwen-api-key', v);
  else localStorage.removeItem('qwen-api-key');
  window.__QWEN_API_KEY__ = v;
}
function getDefaultModel(){ return localStorage.getItem('qwen-default-model') || 'qwen-plus'; }
function setDefaultModel(m){ if(m) localStorage.setItem('qwen-default-model', m); }

function refreshApiKeyStatus(){
  const el = $('#api-key-status');
  if(!el) return;
  if(getApiKey()){
    el.textContent = `Status: set (${getDefaultModel()})`;
    el.className = 'api-key-status set';
  } else {
    el.textContent = 'Status: not set — API calls will fail until you add a key.';
    el.className = 'api-key-status unset';
  }
}

function initApiKeyModal(){
  const btn = $('#api-key-btn');
  const modal = $('#api-key-modal');
  if(!btn || !modal) return;

  btn.addEventListener('click', () => {
    $('#api-key-input').value = getApiKey();
    $('#api-key-model').value = getDefaultModel();
    refreshApiKeyStatus();
    modal.classList.add('show');
  });
  $('#api-key-close').addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', e => { if(e.target === modal) modal.classList.remove('show'); });

  $('#api-key-save').addEventListener('click', () => {
    setApiKey($('#api-key-input').value);
    setDefaultModel($('#api-key-model').value);
    refreshApiKeyStatus();
    modal.classList.remove('show');
    if(getApiKey()) toast('API key saved');
    else toast('API key cleared');
  });
}

/* ============================================================
   Template selector
   ============================================================ */
function loadTemplate(templateId){
  const tpl = (window.TEMPLATES || []).find(t => t.id === templateId);
  if(!tpl){ toast('Template not found'); return; }
  state.nodes = JSON.parse(JSON.stringify(tpl.nodes));
  state.edges = JSON.parse(JSON.stringify(tpl.edges));
  state.selectedNodeIds.clear();
  state.inspectorNodeId = null;
  state.currentTemplateId = templateId;
  renderCanvas();
  renderInspector();
  updateRunButton();
  toast(`Loaded template: ${tpl.name}`);
}

function initTemplateSelector(){
  const sel = $('#template-select');
  if(!sel) return;
  // populate options
  sel.innerHTML = (window.TEMPLATES||[]).map(t => `<option value="${t.id}">${t.icon} ${t.name}</option>`).join('');
  sel.value = state.currentTemplateId || ((window.TEMPLATES||[])[0]&&window.TEMPLATES[0].id);
  sel.addEventListener('change', e => loadTemplate(e.target.value));
}

/* ============================================================
   Boot sequence — called after ALL script files have loaded
   (via inline <script> at the end of index.html)
   ============================================================ */
function bootOrchestra(){
  initTheme();
  initTemplateSelector();
  initNavigation();
  initToolbar();
  initApiKeyModal();
  // ensure API key is hydrated into window.__QWEN_API_KEY__
  setApiKey(getApiKey());

  renderCanvas();
  renderInspector();
  scheduleRenderOutput();
  updateRunButton();
  updateStopButton();

  // benchmark panel renders lazily on tab switch; but pre-render so it's ready
  if(typeof renderBenchmarkPage === 'function'){
    try{ renderBenchmarkPage(); }catch(e){}
  }

  setTimeout(() => toast('Orchestra loaded — click Run to start'), 400);
}

/* ============================================================
   Expose on shared namespace
   ============================================================ */
window.App.$ = $;
window.App.$$ = $$;
window.App.uuid = uuid;
window.App.shortId = shortId;
window.App.sleep = sleep;
window.App.now = now;
window.App.fmtTime = fmtTime;
window.App.fmtDuration = fmtDuration;
window.App.toast = toast;
window.App.escapeHtml = escapeHtml;
window.App.statusLabel = statusLabel;
window.App.NODE_TYPES = NODE_TYPES;
window.App.AGENT_CONFIGS = AGENT_CONFIGS;
window.App.CLI_PRESETS = CLI_PRESETS;
window.App.state = state;
window.App.confirmGlass = confirmGlass;
window.App.exportTimeline = exportTimeline;
window.App.applyTheme = applyTheme;
window.App.loadTemplate = loadTemplate;
window.App.getApiKey = getApiKey;
window.App.getDefaultModel = getDefaultModel;
window.App.bootOrchestra = bootOrchestra;
