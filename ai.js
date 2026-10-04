// On-device AI: Whisper (speech → text) via Transformers.js and an open-source LLM via WebLLM (WebGPU).
// Libraries are loaded lazily from the CDN and cached by the service worker; model weights are cached
// by each library in browser storage, so everything works offline after the first download.
import { SKUS } from './catalog.js';
import { extractJSON } from './parser.js';

const WEBLLM_URLS = [
  'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2/+esm',
  'https://esm.run/@mlc-ai/web-llm@0.2',
  'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2/lib/index.js',
];
const TJS_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm',
];
async function importFirst(urls, check) {
  let lastErr;
  for (const u of urls) {
    try { const m = await import(u); if (check(m)) { log('Loaded library ' + u.replace('https://', '')); return m; } lastErr = new Error('Unexpected module shape: ' + u); }
    catch (e) { lastErr = e; log(`Library import failed (${u.replace('https://', '')}): ${e.message}`); }
  }
  throw lastErr;
}

export const ASR_MODELS = {
  base: { id: 'onnx-community/whisper-base', label: 'Whisper base · multilingual', size: '~80–200 MB' },
  small: { id: 'onnx-community/whisper-small', label: 'Whisper small · better Hindi', size: '~250–500 MB' },
};
export const LLM_SIZES = {
  standard: { base: 'Qwen2.5-1.5B-Instruct', label: 'Qwen2.5 1.5B', size: '~0.9 GB' },
  lite: { base: 'Qwen2.5-0.5B-Instruct', label: 'Qwen2.5 0.5B (lite)', size: '~300 MB' },
};

export const ai = {
  caps: null,
  asr: null, asrInfo: null, asrState: 'idle', asrProgress: 0,
  llm: null, llmId: null, llmState: 'idle', llmProgress: 0,
};

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });

export const logLines = [];
export function log(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  logLines.push(line);
  if (logLines.length > 300) logLines.shift();
  console.log('[BeatBook]', msg);
  emit();
}

export async function detectCaps() {
  const caps = { webgpu: false, f16: false, adapter: '', memory: navigator.deviceMemory || null, storage: null, persisted: null, secure: window.isSecureContext };
  if (navigator.gpu) {
    try {
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (a) {
        caps.webgpu = true;
        caps.f16 = a.features.has('shader-f16');
        let info = a.info;
        if (!info && a.requestAdapterInfo) { try { info = await a.requestAdapterInfo(); } catch { /* ignore */ } }
        if (info) caps.adapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' · ');
        caps.maxBuffer = a.limits?.maxStorageBufferBindingSize;
      }
    } catch (e) { log('WebGPU adapter error: ' + e.message); }
  }
  try { caps.storage = await navigator.storage.estimate(); } catch { /* ignore */ }
  try { caps.persisted = await navigator.storage.persisted(); } catch { /* ignore */ }
  ai.caps = caps;
  log(`Device: WebGPU=${caps.webgpu} f16=${caps.f16} ${caps.adapter} RAM≈${caps.memory ?? '?'}GB`);
  emit();
  return caps;
}

export async function requestPersist() {
  try { const ok = await navigator.storage.persist(); ai.caps && (ai.caps.persisted = ok); log('Persistent storage: ' + ok); } catch { /* ignore */ }
}

// ---------- Speech (Whisper) ----------
let tjs = null;
async function getTJS() {
  if (!tjs) {
    tjs = await importFirst(TJS_URLS, m => typeof m.pipeline === 'function');
    if (tjs.env) tjs.env.allowLocalModels = false;
  }
  return tjs;
}

export async function asrCached(size) {
  try {
    const c = await caches.open('transformers-cache');
    const keys = await c.keys();
    return keys.some(r => r.url.includes(ASR_MODELS[size].id));
  } catch { return false; }
}

export async function loadASR(size = 'base', forceWasm = false) {
  if (ai.asrState === 'loading') return;
  const model = ASR_MODELS[size].id;
  ai.asrState = 'loading'; ai.asrProgress = 0; emit();
  const files = {};
  const cb = p => {
    if (p.status === 'progress' && p.total) {
      files[p.file] = [p.loaded, p.total];
      let L = 0, T = 0; Object.values(files).forEach(([l, t]) => { L += l; T += t; });
      ai.asrProgress = T ? L / T : 0; emit();
    }
  };
  const tries = [];
  if (ai.caps?.webgpu && !forceWasm) tries.push({ device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
  tries.push({ device: 'wasm', dtype: 'q8' });
  let lastErr;
  try {
    const T = await getTJS();
    if (ai.asr) { try { await ai.asr.dispose?.(); } catch { /* ignore */ } ai.asr = null; }
    for (const opt of tries) {
      try {
        log(`Loading ${model} on ${opt.device}…`);
        const t0 = performance.now();
        ai.asr = await T.pipeline('automatic-speech-recognition', model, { ...opt, progress_callback: cb });
        ai.asrInfo = { model, size, device: opt.device };
        ai.asrState = 'ready'; ai.asrProgress = 1;
        log(`Speech model ready on ${opt.device} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
        emit();
        return;
      } catch (e) { lastErr = e; log(`Speech model on ${opt.device} failed: ${e.message}`); }
    }
  } catch (e) { lastErr = e; log('Could not load Transformers.js: ' + e.message); }
  ai.asrState = 'error'; emit();
  throw lastErr;
}

async function decodeAudio(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const a = buf.getChannelData(0), b = buf.getChannelData(1), out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
    return out;
  } finally { ctx.close?.(); }
}

const LANG_CODE = { english: 'en', hindi: 'hi' };
export async function transcribe(blob, lang = 'english') {
  const audio = await decodeAudio(blob);
  const secs = audio.length / 16000;
  let sum = 0; for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i];
  const rms = Math.sqrt(sum / Math.max(1, audio.length));
  if (secs < 0.4 || rms < 0.003) { log(`Skipped silent clip (${secs.toFixed(1)}s, rms ${rms.toFixed(4)})`); return { text: '', ms: 0, secs, silent: true }; }
  const opts = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
  if (lang && lang !== 'auto') opts.language = LANG_CODE[lang] || lang;
  const run = async () => {
    const t0 = performance.now();
    const out = await ai.asr(audio, opts);
    let text = (Array.isArray(out) ? out.map(o => o.text).join(' ') : out.text || '').trim();
    // Whisper sometimes hallucinates filler on near-silence
    if (/^(\[.*\]|\(.*\)|thank you\.?|thanks for watching!?|you|\.+)$/i.test(text)) text = '';
    return { text, ms: performance.now() - t0, secs };
  };
  try {
    return await run();
  } catch (e) {
    log('Transcription failed: ' + e.message);
    if (ai.asrInfo?.device === 'webgpu') {
      log('Retrying speech model on CPU (wasm)…');
      ai.asrState = 'idle';
      await loadASR(ai.asrInfo.size, true);
      return await run();
    }
    throw e;
  }
}

// ---------- Order AI (LLM via WebLLM) ----------
let webllm = null;
async function getWebLLM() {
  if (!webllm) webllm = await importFirst(WEBLLM_URLS, m => typeof m.CreateMLCEngine === 'function');
  return webllm;
}

async function pickModelId(size) {
  const w = await getWebLLM();
  const ids = new Set(w.prebuiltAppConfig.model_list.map(m => m.model_id));
  const base = LLM_SIZES[size].base;
  const order = ai.caps?.f16
    ? [`${base}-q4f16_1-MLC`, `${base}-q4f32_1-MLC`]
    : [`${base}-q4f32_1-MLC`, `${base}-q4f16_1-MLC`];
  order.push('Llama-3.2-1B-Instruct-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f32_1-MLC');
  const id = order.find(x => ids.has(x)) || [...ids].find(x => x.startsWith(base));
  if (!id) throw new Error('No suitable model found in WebLLM list');
  return id;
}

export async function llmCached(size) {
  try {
    const w = await getWebLLM();
    const id = await pickModelId(size);
    return await w.hasModelInCache(id);
  } catch { return false; }
}

export async function loadLLM(size = 'standard') {
  if (ai.llmState === 'loading') return;
  if (!ai.caps?.webgpu) { ai.llmState = 'unsupported'; emit(); throw new Error('WebGPU not available in this browser'); }
  ai.llmState = 'loading'; ai.llmProgress = 0; emit();
  try {
    const w = await getWebLLM();
    const id = await pickModelId(size);
    if (ai.llm) { try { await ai.llm.unload(); } catch { /* ignore */ } ai.llm = null; }
    log(`Loading ${id}…`);
    const t0 = performance.now();
    ai.llm = await w.CreateMLCEngine(id, {
      initProgressCallback: r => { ai.llmProgress = r.progress ?? 0; emit(); },
    }, { context_window_size: 2048 });
    ai.llmId = id; ai.llmState = 'ready'; ai.llmProgress = 1;
    log(`Order AI ready (${id}) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    emit();
  } catch (e) {
    ai.llmState = 'error'; emit();
    log('Order AI failed to load: ' + e.message);
    throw e;
  }
}

const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sku: { type: 'string', enum: SKUS.map(s => s.id) },
          qty: { type: 'integer' },
          unit: { type: 'string', enum: ['pcs', 'dozen', 'case'] },
        },
        required: ['sku', 'qty', 'unit'],
      },
    },
    note: { type: 'string' },
  },
  required: ['lines', 'note'],
};

const CATALOGUE_TEXT = SKUS.map(s => {
  const fam = s.name;
  return `${s.id} | ${fam} | ${s.size}${s.def ? ' (default)' : ''}`;
}).join('\n');

const SYSTEM_PROMPT = `You turn a field sales rep's spoken order at a retail shop into JSON.
Rules:
- Use ONLY SKU ids from the catalogue. Match the product and the pack size spoken. If no size is spoken, use the SKU marked (default).
- Generic words map to products: coconut oil/nariyal = Coco Gold, hair oil/amla = Amla Shine, sunflower/refined oil = Sunfresh, tea/chai = Golden Leaf, biscuit = Morning Crunch, soap/sabun = Pearl, detergent/surf = Brite Wash, toothpaste/paste = Smile, shampoo = Silky, noodles = Quick Noodles.
- unit: "dozen" for dozen/darjan, "case" for case/box/carton/peti, otherwise "pcs".
- Hindi numbers: ek 1, do 2, teen 3, char 4, paanch 5, chhe 6, saat 7, aath 8, nau 9, das 10, barah 12, bees 20, pachaas 50, sau 100.
- A product that is out of stock or only mentioned (not ordered) is NOT a line.
- note: one short English sentence with anything that is not an order (stock-outs, competitor activity, complaints, payment, requests). Empty string if nothing.
Catalogue (SKU id | product | pack):
${CATALOGUE_TEXT}`;

const FEWSHOT = [
  { role: 'user', content: 'coco gold 200 ml do darjan, brite wash ek peti aur shopkeeper bol raha hai pearl soap khatam hai' },
  { role: 'assistant', content: '{"lines":[{"sku":"CG-200","qty":2,"unit":"dozen"},{"sku":"BW-500","qty":1,"unit":"case"}],"note":"Pearl soap is out of stock at this shop."}' },
];

export async function parseWithLLM(text) {
  if (!ai.llm) throw new Error('Order AI not loaded');
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...FEWSHOT, { role: 'user', content: text }];
  const t0 = performance.now();
  let content;
  try {
    const r = await ai.llm.chat.completions.create({
      messages, temperature: 0, max_tokens: 400,
      response_format: { type: 'json_object', schema: JSON.stringify(SCHEMA) },
    });
    content = r.choices[0].message.content;
  } catch (e) {
    log('Schema-constrained mode failed, retrying free-form: ' + e.message);
    const r = await ai.llm.chat.completions.create({ messages, temperature: 0, max_tokens: 400 });
    content = r.choices[0].message.content;
  }
  const ms = performance.now() - t0;
  log(`LLM ${(ms / 1000).toFixed(1)}s → ${content.slice(0, 160)}`);
  return { obj: extractJSON(content), raw: content, ms };
}

export function shortModelName() {
  if (!ai.llmId) return '';
  return ai.llmId.replace(/-q4f(16|32)_1-MLC$/, '').replace('-Instruct', '');
}
