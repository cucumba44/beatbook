import { FAMILIES, SKUS, skuById, OUTLETS, REP, NO_ORDER_REASONS, SAMPLES, LAST_ORDERS } from './catalog.js';
import { parseRules, validateLLM, mergeLines, pcsFor } from './parser.js';
import * as AI from './ai.js';

const { ai, log } = AI;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const today = () => new Date().toLocaleDateString('en-CA');
const prettyDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// ---------- state ----------
const KEY = 'beatbook.v1';
const DEFAULT_SETTINGS = { lang: 'english', llm: 'standard', asr: 'base', parser: 'ai', speak: 'on' };
function freshDay(settings) {
  return {
    date: today(),
    outlets: OUTLETS.map(o => ({ ...o, status: 'pending', lines: [], note: '', transcript: '', parser: '', photo: null, reason: '', time: null })),
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
  };
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.outlets)) { s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) }; return s; }
  } catch { /* ignore */ }
  return freshDay();
}
let state = loadState();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { log('Save failed: ' + e.message); toast('Phone storage is full — could not save'); }
}

let welcomed = false; try { welcomed = localStorage.getItem('bb.welcomed') === '1'; } catch { /* ignore */ }
const ui = { tab: 'beat', visit: null, draft: null, busy: false, status: '', noOrder: false, testOut: '', welcome: !welcomed };
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (!ui.visit && ui.tab === 'beat') render(); });
const fmtDur = s => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);
let rec = null, recTimer = null, ignorePop = false;

// ---------- helpers ----------
const lineValue = l => l.pcs * (skuById[l.sku]?.price || 0);
const orderValue = lines => lines.reduce((a, l) => a + lineValue(l), 0);
const unitShort = l => (l.unit === 'dozen' ? 'dozen' : l.unit === 'case' ? (l.qty === 1 ? 'case' : 'cases') : 'pcs');
function totals() {
  const o = state.outlets;
  const ordered = o.filter(x => x.status === 'ordered');
  return {
    total: o.length,
    visited: o.filter(x => x.status !== 'pending').length,
    productive: ordered.length,
    value: ordered.reduce((a, x) => a + orderValue(x.lines), 0),
    lines: ordered.reduce((a, x) => a + x.lines.length, 0),
    timed: o.filter(x => x.durationSec),
    byAI: ordered.filter(x => /on-device ai/i.test(x.parser || '')).length,
  };
}
function speakOrder(lines) {
  if (state.settings.speak !== 'on' || !('speechSynthesis' in window) || !lines.length) return;
  try {
    const parts = lines.map(l => { const s = skuById[l.sku]; return `${s.short} ${s.size.replace('ml', 'M L').replace(/(\d) g\b/, '$1 gram')}, ${l.qty} ${unitShort(l) === 'pcs' ? 'pieces' : unitShort(l)}`; });
    const u = new SpeechSynthesisUtterance(`${parts.join('. ')}. Total ${Math.round(orderValue(lines))} rupees.`);
    u.lang = 'en-IN'; u.rate = 1.02;
    const v = speechSynthesis.getVoices().find(x => x.lang === 'en-IN' && x.localService) || speechSynthesis.getVoices().find(x => x.lang === 'en-IN');
    if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) { log('Read-back failed: ' + e.message); }
}
function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function setStatus(msg) { ui.status = msg; const el = $('#vstatus'); if (el) el.textContent = msg; }
function waitState(key) {
  return new Promise((res, rej) => {
    const t = setInterval(() => {
      if (ai[key] === 'ready') { clearInterval(t); res(); }
      else if (ai[key] === 'error' || ai[key] === 'unsupported' || ai[key] === 'idle') { clearInterval(t); rej(new Error('model not available')); }
    }, 300);
  });
}
async function ensureASR() {
  if (ai.asrState === 'ready') return;
  if (ai.asrState === 'loading') return waitState('asrState');
  await AI.loadASR(state.settings.asr);
}

const ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4M8 21h8"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  spin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></path></svg>',
  chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
};

function aiPill() {
  const both = ai.asrState === 'ready' && ai.llmState === 'ready';
  if (both) return '<span class="pill ok"><span class="dot"></span>On-device AI ready · works offline</span>';
  if (ai.asrState === 'loading' || ai.llmState === 'loading') {
    const p = Math.round(100 * (ai.llmState === 'loading' ? ai.llmProgress : ai.asrProgress));
    return `<span class="pill warn"><span class="dot"></span>${ai.llmState === 'loading' ? 'Order AI' : 'Speech AI'} loading ${p}%</span>`;
  }
  if (ai.asrState === 'ready' || ai.llmState === 'ready') return '<span class="pill warn"><span class="dot"></span>AI partly ready</span>';
  return '<span class="pill off"><span class="dot"></span>AI not set up — tap to set up</span>';
}
function seg(key, options) {
  return `<div class="seg" style="grid-template-columns:repeat(${options.length},1fr)">${options.map(([v, label]) =>
    `<button data-set="${key}" data-val="${v}" class="${state.settings[key] === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
}

// ---------- views ----------
function render() {
  const view = $('#view');
  $('#tabs').style.display = ui.visit ? 'none' : '';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#topSub').innerHTML = `${esc(prettyDate(state.date))}<br>${esc(REP.name)}`;
  if (ui.visit) view.innerHTML = renderVisit();
  else if (ui.tab === 'report') view.innerHTML = renderReport();
  else if (ui.tab === 'ai') view.innerHTML = renderAI();
  else view.innerHTML = renderBeat();
  const w = $('#welcome');
  if (ui.welcome && !ui.visit) { if (w) w.outerHTML = renderWelcome(); else document.body.insertAdjacentHTML('beforeend', renderWelcome()); }
  else if (w) w.remove();
}

function renderWelcome() {
  return `<div class="sheet-bg" id="welcome" role="dialog" aria-modal="true" aria-labelledby="wtitle"><div class="sheet">
    <div class="row" style="gap:10px"><img src="icon-192.png" alt="" style="width:40px;height:40px;border-radius:11px"><div><h1 class="title" id="wtitle">BeatBook</h1><div class="small muted">Voice orders for field sales reps</div></div></div>
    <p style="margin:14px 0 10px">Reps speak the order at the shop. AI running <b>on the phone</b> turns it into a clean order sheet, even with no network.</p>
    <ol class="steps">
      <li><b>Speak the order</b> in English or Hindi, like "Coco Gold 200 ml do darjan".</li>
      <li><b>On-device AI</b> fills the order lines, matched to the product list. Check and save.</li>
      <li><b>One tap</b> sends the day's report to the laptop for the area manager.</li>
    </ol>
    <div class="stack" style="gap:8px;margin-top:14px">
      <button class="btn primary block" data-act="w-demo">See a sample day</button>
      <button class="btn block" data-act="w-ai">Set up on-device AI (Wi-Fi, one time)</button>
      <button class="link" data-act="w-close" style="align-self:center">Start exploring</button>
    </div>
    <div class="small muted" style="margin-top:10px;text-align:center">Demo data: fictional brands, shops and rep.</div>
  </div></div>`;
}
function closeWelcome() { ui.welcome = false; try { localStorage.setItem('bb.welcomed', '1'); } catch { /* ignore */ } }

function renderBeat() {
  const t = totals();
  const setup = !(ai.asrState === 'ready' && ai.llmState === 'ready') && ai.asrState !== 'loading' && ai.llmState !== 'loading';
  return `<div class="stack">
    <div><h1 class="title">${esc(REP.beat)}</h1><div class="muted small">Distributor: ${esc(REP.distributor)}</div></div>
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><button class="link" data-go="ai" id="aiPill">${aiPill()}</button>${installPrompt ? '<button class="btn sm" data-act="install">Install app</button>' : ''}</div>
    <div class="kpis">
      <div class="kpi"><b>${t.visited}/${t.total}</b><span>Outlets visited</span></div>
      <div class="kpi"><b>${t.productive}</b><span>With orders</span></div>
      <div class="kpi"><b>${inr(t.value)}</b><span>Order value</span></div>
    </div>
    ${setup ? `<div class="card stack" style="gap:8px"><b>Set up on-device AI once</b><div class="small muted">Download the speech and order-reading models on Wi-Fi. After that BeatBook works with no network at all.</div><button class="btn primary" data-go="ai">Set up AI</button></div>` : ''}
    <h2>Today's outlets</h2>
    ${state.outlets.map((o, i) => {
      const pill = o.status === 'ordered' ? `<span class="pill ok">${inr(orderValue(o.lines))}</span>`
        : o.status === 'noorder' ? '<span class="pill warn">No order</span>' : '<span class="pill off">To visit</span>';
      return `<button class="outlet" data-open="${o.id}">
        <span class="num">${i + 1}</span>
        <span class="meta"><div class="name">${esc(o.name)}</div><div class="small muted">${esc(o.area)}${o.time ? ' · ' + esc(o.time) : ''}</div></span>
        ${pill}<span class="chev">${ICON.chev}</span></button>`;
    }).join('')}
  </div>`;
}

function lineHTML(l, i) {
  const s = skuById[l.sku];
  const fam = FAMILIES.find(f => f.key === s.family);
  const variantSel = fam.variants.length > 1
    ? `<select data-variant="${i}" style="min-height:30px;padding:3px 6px;font-size:13px;width:auto;margin-top:3px">${fam.variants.map(v => `<option value="${v.id}" ${v.id === l.sku ? 'selected' : ''}>${esc(v.size)}</option>`).join('')}</select>`
    : `<div class="small muted">${esc(s.size)}</div>`;
  return `<div class="line">
    <div class="info"><div class="pname">${esc(s.short)}</div>${variantSel}
      <div class="small muted">${l.pcs} pcs · ${inr(lineValue(l))}</div>
      ${l.flag ? `<div class="flag">${esc(l.flag)}</div>` : ''}</div>
    <div class="stepper"><button data-act="dec" data-i="${i}" aria-label="Less">−</button><div class="q">${l.qty}<small>${unitShort(l)}</small></div><button data-act="inc" data-i="${i}" aria-label="More">+</button></div>
    <button class="x" data-act="del" data-i="${i}" aria-label="Remove">×</button>
  </div>`;
}

function renderVisit() {
  const o = state.outlets.find(x => x.id === ui.visit);
  const d = ui.draft;
  const micClass = rec ? 'rec' : ui.busy ? 'busy' : '';
  const micIcon = rec ? ICON.stop : ui.busy ? ICON.spin : ICON.mic;
  const defaultStatus = rec ? 'Listening… tap to stop' : 'Tap and speak the order';
  const value = orderValue(d.lines);
  const badge = d.parser ? `<span class="badge ${/rules/i.test(d.parser) ? 'rule' : ''}">${esc(d.parser)}</span>` : '';
  return `<div class="stack">
    <button class="back" data-act="back">‹ Back to beat</button>
    <div><h1 class="title">${esc(o.name)}</h1><div class="muted small">${esc(o.area)} · ${esc(o.owner)}</div></div>
    <div class="card mic-wrap">
      <button class="mic ${micClass}" data-act="mic" aria-label="${rec ? 'Stop recording' : 'Record order'}">${micIcon}</button>
      <div class="status" id="vstatus">${esc(ui.status || defaultStatus)}</div>
      <div style="width:100%;max-width:300px">${seg('lang', [['english', 'English'], ['hindi', 'Hindi'], ['auto', 'Auto']])}</div>
    </div>
    <div class="card stack" style="gap:8px">
      <div class="row" style="justify-content:space-between"><b>What was heard</b><button class="link" data-act="sample">Try a sample order</button></div>
      <textarea id="transcript" rows="3" placeholder="The transcript appears here. You can also type or fix the order, then tap Read order.">${esc(d.transcript)}</textarea>
      <div class="row" style="justify-content:space-between;flex-wrap:wrap"><span>${badge}</span><button class="btn sm" data-act="parse" ${ui.busy ? 'disabled' : ''}>Read order</button></div>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:4px"><b>Order</b><b>${inr(value)}</b></div>
      ${d.lines.length ? d.lines.map(lineHTML).join('') : '<div class="empty small">No items yet. Speak the order, or add products below.</div>'}
      ${d.unmatched?.length ? `<div class="flag small" style="margin-top:6px">Couldn't match: ${d.unmatched.map(esc).join(', ')}</div>` : ''}
      <select id="addSku" style="margin-top:10px"><option value="">+ Add a product…</option>${FAMILIES.map(f => `<optgroup label="${esc(f.name)}">${f.variants.map(v => `<option value="${v.id}">${esc(f.short)} · ${esc(v.size)} · ${inr(v.price)}</option>`).join('')}</optgroup>`).join('')}</select>
    </div>
    ${lastOrderCard(o)}
    <div class="card stack" style="gap:8px">
      <b>Shop notes</b>
      <textarea id="note" rows="2" placeholder="Stock-outs, competitor activity, requests…">${esc(d.note)}</textarea>
    </div>
    <div class="card stack" style="gap:8px">
      <div class="row" style="justify-content:space-between"><b>Shelf photo</b><button class="btn sm" data-act="photo">${d.photo ? 'Retake' : 'Take photo'}</button></div>
      ${d.photo ? `<img class="photo" src="${d.photo}" alt="Shelf photo">` : '<div class="small muted">Optional. Automatic shelf check (stock gaps, competitor products) is next on the roadmap.</div>'}
    </div>
    ${ui.noOrder ? `<div class="card stack" style="gap:8px"><b>Why no order?</b><div class="chips">${NO_ORDER_REASONS.map(r => `<button class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>` : ''}
    <div style="height:70px"></div>
  </div>
  <div class="footer-actions"><div class="inner">
    <button class="btn" data-act="noorder">No order</button>
    <button class="btn primary" data-act="save">Save order · ${inr(value)}</button>
  </div></div>`;
}

function lastOrderCard(o) {
  const last = LAST_ORDERS[o.id];
  if (!last) return '';
  const lines = last.lines.map(l => ({ ...l, pcs: pcsFor(l.sku, l.qty, l.unit) }));
  return `<div class="card stack" style="gap:6px">
    <div class="row" style="justify-content:space-between"><b>Last order · ${last.daysAgo} days ago</b><span class="muted small">${inr(orderValue(lines))}</span></div>
    <div class="small muted">${lines.map(l => { const s = skuById[l.sku]; return `${esc(s.short)} ${esc(s.size)} × ${l.qty} ${unitShort(l)}`; }).join(' · ')}</div>
    <button class="btn sm" data-act="repeat" style="align-self:flex-start">Repeat last order</button>
  </div>`;
}

function renderReport() {
  const t = totals();
  const visited = state.outlets.filter(o => o.status !== 'pending');
  const notes = state.outlets.filter(o => o.note).map(o => ({ name: o.name, note: o.note }));
  if (!visited.length) {
    return `<div class="stack"><div><h1 class="title">Daily report</h1><div class="muted small">${esc(prettyDate(state.date))}</div></div>
      <div class="card empty">No visits yet today.<br><br><button class="btn" data-act="demo">Load a sample day</button></div></div>`;
  }
  return `<div class="stack" id="report">
    <div><h1 class="title">Daily report</h1><div class="muted small">${esc(prettyDate(state.date))} · ${esc(REP.name)} · ${esc(REP.beat)}</div></div>
    <div class="kpis">
      <div class="kpi"><b>${t.visited}/${t.total}</b><span>Visited</span></div>
      <div class="kpi"><b>${t.productive}</b><span>With orders</span></div>
      <div class="kpi"><b>${inr(t.value)}</b><span>Order value</span></div>
    </div>
    <div class="card">
      ${visited.map(o => `<div class="report-outlet">
        <div class="row" style="justify-content:space-between"><b>${esc(o.name)}</b><span class="small ${o.status === 'ordered' ? '' : 'muted'}">${o.status === 'ordered' ? inr(orderValue(o.lines)) : 'No order · ' + esc(o.reason)}</span></div>
        ${o.lines.length ? `<ul>${o.lines.map(l => { const s = skuById[l.sku]; return `<li>${esc(s.short)} ${esc(s.size)} — ${l.qty} ${unitShort(l)}${l.unit === 'pcs' ? '' : ` (${l.pcs} pcs)`}</li>`; }).join('')}</ul>` : ''}
      </div>`).join('')}
    </div>
    ${t.timed.length || t.byAI ? `<div class="small muted">${t.timed.length ? `Avg time to capture an order: <b>${fmtDur(t.timed.reduce((a, x) => a + x.durationSec, 0) / t.timed.length)}</b>` : ''}${t.timed.length && t.byAI ? ' · ' : ''}${t.byAI ? `Read by on-device AI: <b>${t.byAI}/${t.productive}</b>` : ''}</div>` : ''}
    ${notes.length ? `<div class="card stack" style="gap:6px"><b>Market notes</b>${notes.map(n => `<div class="small"><b>${esc(n.name)}:</b> ${esc(n.note)}</div>`).join('')}</div>` : ''}
    <div class="stack no-print">
      <button class="btn primary block" data-act="share">Send report to laptop</button>
      <div class="row"><button class="btn block" data-act="csv">Download Excel (CSV)</button><button class="btn block" data-act="copy">Copy summary</button></div>
      <button class="btn block" data-act="print">Save as PDF</button>
      <div class="card small" style="background:var(--surface-2)"><b>On the laptop:</b> open <a href="manager.html" target="_blank" rel="noopener">BeatBook Manager</a> and drop in the CSV to see the area manager's dashboard.</div>
      <button class="btn ghost danger block" data-act="reset">Start a new day (clears today)</button>
    </div>
  </div>`;
}

function modelRow(kind) {
  const isA = kind === 'asr';
  const st = isA ? ai.asrState : ai.llmState;
  const p = isA ? ai.asrProgress : ai.llmProgress;
  const meta = isA ? AI.ASR_MODELS[state.settings.asr] : AI.LLM_SIZES[state.settings.llm];
  const matches = isA ? ai.asrInfo?.size === state.settings.asr : (ai.llmId || '').startsWith(meta.base);
  const ready = st === 'ready' && matches;
  let pill;
  if (ready) pill = `<span class="pill ok"><span class="dot"></span>Ready · ${isA ? (ai.asrInfo.device === 'webgpu' ? 'GPU' : 'CPU') : 'GPU'}</span>`;
  else if (st === 'loading') pill = `<span class="pill warn"><span class="dot"></span>${Math.round(p * 100)}%</span>`;
  else if (st === 'error') pill = '<span class="pill bad"><span class="dot"></span>Failed</span>';
  else if (st === 'unsupported' || (!isA && ai.caps && !ai.caps.webgpu)) pill = '<span class="pill bad"><span class="dot"></span>Needs WebGPU</span>';
  else pill = '<span class="pill off"><span class="dot"></span>Not loaded</span>';
  const noGpu = !isA && ai.caps && !ai.caps.webgpu;
  const btn = noGpu ? '<div class="small muted">This browser has no WebGPU. Use the latest Chrome on Android 12 or newer. Orders are read by the rules engine meanwhile.</div>'
    : (!ready && st !== 'loading' && st !== 'unsupported')
    ? `<button class="btn sm" data-act="${isA ? 'loadasr' : 'loadllm'}">${st === 'error' ? 'Retry' : 'Download & load'}</button>` : '';
  return `<div class="stack" style="gap:8px">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><div style="font-weight:650">${isA ? 'Speech → text' : 'Order reading (LLM)'}</div><div class="small muted">${esc(meta.label)} · ${esc(meta.size)}${!isA && ai.llmId ? `<br>${esc(ai.llmId)}` : ''}</div></div>${pill}
    </div>
    ${st === 'loading' ? `<div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div>` : ''}
    ${btn}
  </div>`;
}

function renderAI() {
  const c = ai.caps || {};
  const gb = b => (b ? (b / 1e9).toFixed(2) + ' GB' : '—');
  const yes = v => (v ? '✓ Yes' : '✗ No');
  return `<div class="stack">
    <div><h1 class="title">On-device AI</h1><div class="muted small">Both models run on this phone. After a one-time download, BeatBook works in airplane mode and no order data leaves the device.</div></div>
    <div class="card stack">
      ${modelRow('asr')}
      <hr style="border:0;border-top:1px solid var(--line);margin:2px 0">
      ${modelRow('llm')}
      <button class="btn primary block" data-act="loadall" ${ai.asrState === 'loading' || ai.llmState === 'loading' ? 'disabled' : ''}>Download both models (Wi-Fi)</button>
    </div>
    <div class="card stack">
      <b>Settings</b>
      <div class="small muted">Speech language</div>${seg('lang', [['english', 'English'], ['hindi', 'Hindi'], ['auto', 'Auto']])}
      <div class="small muted">Order AI size</div>${seg('llm', [['standard', 'Standard 1.5B'], ['lite', 'Lite 0.5B']])}
      <div class="small muted">Speech model</div>${seg('asr', [['base', 'Base'], ['small', 'Small (better Hindi)']])}
      <div class="small muted">Read orders with</div>${seg('parser', [['ai', 'AI, rules as backup'], ['rules', 'Rules only']])}
      <div class="small muted">Read the order back aloud after speaking</div>${seg('speak', [['on', 'On'], ['off', 'Off']])}
    </div>
    <div class="card stack" style="gap:8px">
      <div class="row" style="justify-content:space-between"><b>Test the order AI</b><button class="btn sm" data-act="testai" ${ai.llmState === 'ready' ? '' : 'disabled'}>Run sample</button></div>
      <div class="small muted">Sends the sample order (${state.settings.lang === 'hindi' ? 'Hindi' : 'English'}) through the on-device model and shows its raw JSON.</div>
      ${ui.testOut ? `<div class="log">${esc(ui.testOut)}</div>` : ''}
    </div>
    <div class="card stack" style="gap:8px">
      <b>This device</b>
      <dl class="kv">
        <dt>Secure page (HTTPS)</dt><dd>${yes(c.secure)}</dd>
        <dt>WebGPU</dt><dd>${yes(c.webgpu)}</dd>
        <dt>16-bit shaders</dt><dd>${yes(c.f16)}</dd>
        <dt>GPU</dt><dd>${esc(c.adapter || '—')}</dd>
        <dt>RAM (reported)</dt><dd>${c.memory ? c.memory + ' GB+' : '—'}</dd>
        <dt>Storage used</dt><dd>${gb(c.storage?.usage)} of ${gb(c.storage?.quota)}</dd>
        <dt>Protected from cleanup</dt><dd>${yes(c.persisted)}</dd>
      </dl>
    </div>
    <div class="card stack" style="gap:6px">
      <b>Offline check</b>
      <div class="small">1. With both models showing Ready, turn on airplane mode.<br>2. Close BeatBook fully and open it again from the home screen.<br>3. Both models should reload and show Ready. Record an order to confirm.</div>
    </div>
    <div class="card stack" style="gap:8px">
      <div class="row" style="justify-content:space-between"><b>Diagnostics</b><button class="btn sm" data-act="copylog">Copy</button></div>
      <div class="log" id="log">${esc(AI.logLines.slice(-60).join('\n')) || 'No messages yet.'}</div>
    </div>
  </div>`;
}

// ---------- visit flow ----------
function openVisit(id) {
  const o = state.outlets.find(x => x.id === id);
  ui.visit = id;
  ui.draft = { lines: o.lines.map(l => ({ ...l })), note: o.note, transcript: o.transcript, parser: o.parser, photo: o.photo, unmatched: [], openedAt: Date.now() };
  ui.status = ''; ui.noOrder = false; ui.busy = false;
  history.pushState({ bb: 'visit' }, '');
  render(); window.scrollTo(0, 0);
}
function closeVisit(fromPop = false) {
  if (rec) stopRec(true);
  ui.visit = null; ui.draft = null; ui.noOrder = false;
  if (!fromPop && history.state?.bb === 'visit') { ignorePop = true; history.back(); }
  render(); window.scrollTo(0, 0);
}
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  if (ui.visit) closeVisit(true);
});

function saveVisit(status, reason = '') {
  const o = state.outlets.find(x => x.id === ui.visit);
  const d = ui.draft;
  Object.assign(o, {
    lines: status === 'ordered' ? d.lines : [], note: (d.note || '').trim(), transcript: d.transcript, parser: d.parser,
    photo: d.photo, status, reason, time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    durationSec: status === 'ordered' && d.openedAt ? Math.round((Date.now() - d.openedAt) / 1000) : (o.durationSec || null),
  });
  save();
  const msg = status === 'ordered' ? `Order saved · ${inr(orderValue(o.lines))}` : `Marked no order · ${reason}`;
  closeVisit();
  toast(msg);
}

async function parseText(text) {
  const wantAI = state.settings.parser === 'ai';
  const rules = () => parseRules(text);
  if (wantAI && ai.llmState === 'ready') {
    try {
      const r = await AI.parseWithLLM(text);
      const v = validateLLM(r.obj);
      if (v && v.lines.length) return { ...v, unmatched: [], by: `On-device AI · ${AI.shortModelName()} · ${(r.ms / 1000).toFixed(1)}s` };
      const rr = rules();
      if (rr.lines.length) return { ...rr, note: rr.note || v?.note || '', by: 'Rules engine (AI found no items)' };
      return { lines: [], note: v?.note || '', unmatched: rr.unmatched, by: `On-device AI · ${AI.shortModelName()}` };
    } catch (e) { log('AI parse failed, using rules: ' + e.message); return { ...rules(), by: 'Rules engine (AI error)' }; }
  }
  return { ...rules(), by: wantAI ? 'Rules engine · order AI not loaded' : 'Rules engine' };
}

async function parseInto(text, replace) {
  if (!text.trim()) { toast('Nothing to read yet'); return; }
  ui.busy = true;
  render();
  setStatus(state.settings.parser === 'ai' && ai.llmState === 'ready' ? 'Reading the order with on-device AI…' : 'Reading the order…');
  try {
    const r = await parseText(text);
    const d = ui.draft; if (!d) return;
    d.lines = replace ? r.lines : mergeLines([...d.lines, ...r.lines]);
    if (r.note && !(d.note || '').includes(r.note)) d.note = d.note ? `${d.note.trim()} ${r.note}` : r.note;
    d.parser = r.by; d.unmatched = r.unmatched || [];
    ui.status = r.lines.length ? `Found ${r.lines.length} item${r.lines.length > 1 ? 's' : ''} — check and save` : 'No products recognised. Edit the text or add items below.';
  } finally {
    ui.busy = false;
    if (ui.visit) render();
  }
}

async function toggleMic() {
  if (rec) { stopRec(); return; }
  if (ui.busy) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('This browser cannot record audio here (needs HTTPS + Chrome).'); return; }
  if (ai.asrState === 'idle') AI.loadASR(state.settings.asr).catch(() => {});
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) { log('Mic error: ' + e.message); toast('Microphone permission is needed to record orders'); return; }
  const mr = new MediaRecorder(stream);
  const chunks = [];
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    if (mr._discard) return;
    handleAudio(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
  };
  mr.start();
  rec = { mr, t0: Date.now() };
  ui.status = 'Listening… tap to stop';
  render();
  recTimer = setInterval(() => {
    if (!rec) return;
    const s = Math.floor((Date.now() - rec.t0) / 1000);
    setStatus(`Listening… ${s}s · tap to stop`);
    if (s >= 45) stopRec();
  }, 500);
}
function stopRec(discard = false) {
  clearInterval(recTimer);
  if (!rec) return;
  rec.mr._discard = discard;
  try { rec.mr.stop(); } catch { /* ignore */ }
  rec = null;
  if (!discard) { ui.busy = true; ui.status = 'Processing…'; render(); }
}

async function handleAudio(blob) {
  ui.busy = true;
  try {
    if (ai.asrState !== 'ready') { setStatus('Preparing the speech model (first time can take a minute)…'); await ensureASR(); }
    setStatus('Transcribing on this phone…');
    const r = await AI.transcribe(blob, state.settings.lang);
    log(`Heard ${r.secs.toFixed(1)}s audio in ${(r.ms / 1000).toFixed(1)}s: ${r.text}`);
    if (!ui.draft) return;
    if (!r.text || r.text.length < 2) { ui.busy = false; ui.status = r.silent ? "Didn't hear anything. Tap the mic and speak a little louder." : "Didn't catch that. Try again, closer to the phone."; render(); return; }
    ui.draft.transcript = (ui.draft.transcript ? ui.draft.transcript.trim() + ' ' : '') + r.text;
    await parseInto(r.text, false);
    if (ui.draft) speakOrder(ui.draft.lines);
  } catch (e) {
    log('Voice flow error: ' + e.message);
    ui.busy = false;
    ui.status = 'Speech model not available. Type the order instead, or set up AI.';
    if (ui.visit) render();
  }
}

// ---------- report / export ----------
function csvText() {
  const cell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['Date', 'Rep', 'Beat', 'Distributor', 'Outlet', 'Area', 'Status', 'Time', 'SKU', 'Product', 'Pack', 'Qty', 'Unit', 'Pieces', 'Price (Rs)', 'Value (Rs)', 'No-order reason', 'Shop note', 'Read by']];
  for (const o of state.outlets) {
    if (o.status === 'pending') continue;
    const base = [state.date, REP.name, REP.beat, REP.distributor, o.name, o.area, o.status === 'ordered' ? 'Ordered' : 'No order', o.time || ''];
    if (!o.lines.length) rows.push([...base, '', '', '', '', '', '', '', '', o.reason, o.note, o.parser]);
    o.lines.forEach((l, i) => {
      const s = skuById[l.sku];
      rows.push([...base, s.id, s.name, s.size, l.qty, l.unit, l.pcs, s.price, lineValue(l), '', i === 0 ? o.note : '', i === 0 ? o.parser : '']);
    });
  }
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}
const fileName = () => `BeatBook_${state.date}.csv`;
function summaryText() {
  const t = totals();
  const out = [`BeatBook daily report · ${prettyDate(state.date)}`, `${REP.name} · ${REP.beat}`, `Visited ${t.visited}/${t.total} · Orders ${t.productive} · Value ${inr(t.value)}`, ''];
  state.outlets.filter(o => o.status !== 'pending').forEach((o, i) => {
    if (o.status === 'ordered') {
      out.push(`${i + 1}. ${o.name} — ${inr(orderValue(o.lines))}`);
      out.push('   ' + o.lines.map(l => { const s = skuById[l.sku]; return `${s.short} ${s.size} × ${l.qty} ${unitShort(l)}`; }).join('; '));
    } else out.push(`${i + 1}. ${o.name} — No order (${o.reason})`);
  });
  const notes = state.outlets.filter(o => o.note);
  if (notes.length) { out.push('', 'Market notes'); notes.forEach(o => out.push(`• ${o.name}: ${o.note}`)); }
  return out.join('\n');
}
function downloadCSV() {
  const blob = new Blob([csvText()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fileName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Excel file saved to Downloads');
}
async function shareReport() {
  const file = new File([csvText()], fileName(), { type: 'text/csv' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'BeatBook daily report', text: summaryText() });
      return;
    }
  } catch (e) { if (e.name === 'AbortError') return; log('Share failed: ' + e.message); }
  downloadCSV();
}
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(msg); } catch { toast('Copy failed'); }
    ta.remove();
  }
}
function loadDemoDay() {
  const demo = {
    O1: { t: 'Coco Gold 200 ml two dozen, Golden Leaf 500 gram 10 packets, Brite Wash 1 kg one case', note: 'Pearl soap out of stock.' },
    O2: { t: 'nariyal tel sau ml teen darjan, chai paanch packet, dus wala biscuit do peti', note: 'Competitor running a 10% scheme on coconut oil.' },
    O3: { reason: 'Payment pending' },
    O4: { t: 'Sunfresh 1 litre 2 case, Smile toothpaste 100 gram 1 dozen, Silky shampoo 10 strip', note: '' },
    O6: { t: 'Amla shine 200 ml 12 bottles, Quick noodles 2 case, Pearl soap 150 gram 1 dozen', note: 'Owner asked for a display rack.' },
  };
  const times = ['10:05 am', '10:40 am', '11:20 am', '12:10 pm', '', '1:35 pm'];
  state.outlets.forEach((o, i) => {
    const d = demo[o.id];
    if (!d) return;
    if (d.reason) Object.assign(o, { status: 'noorder', reason: d.reason, lines: [], time: times[i] });
    else { const r = parseRules(d.t); Object.assign(o, { status: 'ordered', lines: r.lines, transcript: d.t, note: d.note, parser: 'Sample data', time: times[i] }); }
  });
  save(); render(); toast('Sample day loaded');
}

// ---------- AI actions ----------
async function loadAll() {
  await AI.requestPersist();
  try { if (!(ai.asrState === 'ready' && ai.asrInfo?.size === state.settings.asr)) { ai.asrState = 'idle'; await AI.loadASR(state.settings.asr); } } catch (e) { toast('Speech model failed — see Diagnostics'); }
  try { if (!(ai.llmState === 'ready' && (ai.llmId || '').startsWith(AI.LLM_SIZES[state.settings.llm].base))) { ai.llmState = 'idle'; await AI.loadLLM(state.settings.llm); } } catch (e) { toast('Order AI failed — see Diagnostics'); }
  refreshCaps();
  if (ai.asrState === 'ready' && ai.llmState === 'ready') toast('On-device AI ready. You can go offline now.');
}
async function refreshCaps() { await AI.detectCaps(); if (ui.tab === 'ai' && !ui.visit) render(); }
async function testAI() {
  ui.testOut = 'Running…'; render();
  try {
    const sample = SAMPLES[state.settings.lang === 'hindi' ? 'hindi' : 'english'];
    const r = await AI.parseWithLLM(sample);
    const v = validateLLM(r.obj);
    ui.testOut = `Input: ${sample}\n\nTime: ${(r.ms / 1000).toFixed(1)}s\nRaw output:\n${r.raw}\n\nValid lines: ${v ? v.lines.length : 0}`;
  } catch (e) { ui.testOut = 'Error: ' + e.message; }
  render();
}

// ---------- events ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act],[data-tab],[data-open],[data-go],[data-set],[data-reason]');
  if (!el) return;
  if (el.dataset.tab) { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); if (ui.tab === 'ai') refreshCaps(); return; }
  if (el.dataset.go) { ui.tab = el.dataset.go; render(); window.scrollTo(0, 0); return; }
  if (el.dataset.open) { openVisit(el.dataset.open); return; }
  if (el.dataset.set) {
    const k = el.dataset.set, v = el.dataset.val;
    state.settings[k] = v; save();
    if (k === 'llm' && ai.llmState !== 'loading' && ai.llmId && !ai.llmId.startsWith(AI.LLM_SIZES[v].base)) toast('Tap "Download & load" to switch the order AI');
    if (k === 'asr' && ai.asrState !== 'loading' && ai.asrInfo && ai.asrInfo.size !== v) toast('Tap "Download & load" to switch the speech model');
    render(); return;
  }
  if (el.dataset.reason) { saveVisit('noorder', el.dataset.reason); return; }
  const act = el.dataset.act, d = ui.draft, i = Number(el.dataset.i);
  switch (act) {
    case 'back': closeVisit(); break;
    case 'mic': toggleMic(); break;
    case 'sample': {
      const s = SAMPLES[state.settings.lang === 'hindi' ? 'hindi' : 'english'];
      d.transcript = s; render(); await parseInto(s, true); break;
    }
    case 'parse': { const ta = $('#transcript'); d.transcript = ta ? ta.value : d.transcript; await parseInto(d.transcript, true); break; }
    case 'inc': case 'dec': {
      const l = d.lines[i]; l.qty = Math.max(1, l.qty + (act === 'inc' ? 1 : -1)); l.pcs = pcsFor(l.sku, l.qty, l.unit); l.flag = ''; render(); break;
    }
    case 'del': d.lines.splice(i, 1); render(); break;
    case 'photo': $('#photoInput').click(); break;
    case 'noorder': ui.noOrder = !ui.noOrder; render(); if (ui.noOrder) window.scrollTo(0, document.body.scrollHeight); break;
    case 'save': if (!d.lines.length) { toast('Add at least one item, or tap No order'); break; } saveVisit('ordered'); break;
    case 'share': shareReport(); break;
    case 'csv': downloadCSV(); break;
    case 'copy': copyText(summaryText(), 'Summary copied — paste it on your laptop or WhatsApp'); break;
    case 'print': window.print(); break;
    case 'reset': if (confirm('Clear all of today\'s visits and start a new day?')) { state = freshDay(state.settings); save(); render(); toast('New day started'); } break;
    case 'demo': loadDemoDay(); break;
    case 'w-demo': closeWelcome(); loadDemoDay(); ui.tab = 'report'; render(); break;
    case 'w-ai': closeWelcome(); ui.tab = 'ai'; render(); refreshCaps(); break;
    case 'w-close': closeWelcome(); render(); break;
    case 'about': ui.welcome = true; render(); break;
    case 'install': if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; render(); }); } break;
    case 'repeat': {
      const last = LAST_ORDERS[ui.visit];
      d.lines = mergeLines([...d.lines, ...last.lines.map(l => ({ ...l, pcs: pcsFor(l.sku, l.qty, l.unit), flag: '' }))]);
      d.parser = d.parser || 'Repeated last order'; ui.status = 'Last order added — adjust and save'; render(); break;
    }
    case 'loadasr': ai.asrState = 'idle'; AI.requestPersist(); AI.loadASR(state.settings.asr).catch(() => toast('Speech model failed — see Diagnostics')).finally(refreshCaps); break;
    case 'loadllm': ai.llmState = 'idle'; AI.requestPersist(); AI.loadLLM(state.settings.llm).catch(() => toast('Order AI failed — see Diagnostics')).finally(refreshCaps); break;
    case 'loadall': loadAll(); break;
    case 'testai': testAI(); break;
    case 'copylog': copyText(AI.logLines.join('\n') + '\n\nUA: ' + navigator.userAgent, 'Diagnostics copied'); break;
  }
});
document.addEventListener('input', e => {
  if (!ui.draft) return;
  if (e.target.id === 'transcript') ui.draft.transcript = e.target.value;
  if (e.target.id === 'note') ui.draft.note = e.target.value;
});
document.addEventListener('change', async e => {
  if (e.target.id === 'addSku' && e.target.value && ui.draft) {
    ui.draft.lines = mergeLines([...ui.draft.lines, { sku: e.target.value, qty: 1, unit: 'pcs', pcs: 1, flag: '' }]);
    render(); return;
  }
  if (e.target.dataset.variant !== undefined && ui.draft) {
    const l = ui.draft.lines[Number(e.target.dataset.variant)];
    l.sku = e.target.value; l.pcs = pcsFor(l.sku, l.qty, l.unit); l.flag = '';
    ui.draft.lines = mergeLines(ui.draft.lines); render(); return;
  }
  if (e.target.id === 'photoInput') {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f || !ui.draft) return;
    try { ui.draft.photo = await downscale(f, 720); render(); } catch (err) { log('Photo error: ' + err.message); toast('Could not read that photo'); }
  }
});
async function downscale(file, max) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

// live AI status updates without re-rendering text fields
let pendingRefresh = false;
AI.onChange(() => {
  if (ai.llmState === 'ready') { try { localStorage.setItem('bb.llmOnce', '1'); } catch { /* ignore */ } }
  if (pendingRefresh) return;
  pendingRefresh = true;
  setTimeout(() => {
    pendingRefresh = false;
    if (ui.visit) return;
    if (ui.tab === 'ai') render();
    else if (ui.tab === 'beat') { const p = $('#aiPill'); if (p) p.innerHTML = aiPill(); }
  }, 250);
});
window.addEventListener('error', e => log('Error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', e => log('Unhandled: ' + (e.reason?.message || e.reason)));

// ---------- boot ----------
async function boot() {
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e => log('Service worker failed: ' + e.message));
  await AI.detectCaps();
  render();
  const asrHit = await AI.asrCached(state.settings.asr);
  let once = false; try { once = localStorage.getItem('bb.llmOnce') === '1'; } catch { /* ignore */ }
  const llmHit = ai.caps.webgpu && once ? await AI.llmCached(state.settings.llm) : false;
  log(`Models already on phone: speech=${asrHit} orderAI=${llmHit}`);
  if (asrHit) { try { await AI.loadASR(state.settings.asr); } catch { /* logged */ } }
  if (llmHit) { try { await AI.loadLLM(state.settings.llm); } catch { /* logged */ } }
  if (!ui.visit) render();
}
boot();
