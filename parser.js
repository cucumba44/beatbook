// Deterministic order parser: safety net for the on-device LLM and validator for its output.
import { FAMILIES, skuById } from './catalog.js';

const DEV_DIGITS = '०१२३४५६७८९';

const NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, che: 6, chah: 6, cheh: 6,
  saat: 7, aath: 8, nau: 9, das: 10, dus: 10, gyarah: 11, gyaarah: 11, barah: 12, baarah: 12, bara: 12, terah: 13,
  chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20, ikkis: 21, bais: 22, teis: 23,
  chaubis: 24, chaubees: 24, pachees: 25, pachchis: 25, pachis: 25, tees: 30, chalees: 40, chalis: 40, pachaas: 50,
  pachas: 50, sau: 100,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'छे': 6, 'सात': 7, 'आठ': 8, 'नौ': 9,
  'दस': 10, 'ग्यारह': 11, 'बारह': 12, 'पंद्रह': 15, 'बीस': 20, 'चौबीस': 24, 'पच्चीस': 25, 'तीस': 30, 'चालीस': 40,
  'पचास': 50, 'सौ': 100,
};
const FRACTIONS = { half: 0.5, aadha: 0.5, adha: 0.5, aadhi: 0.5, 'आधा': 0.5, 'आधी': 0.5, dedh: 1.5, 'डेढ़': 1.5, dhai: 2.5, 'ढाई': 2.5 };

const QTY_UNITS = {
  pcs: ['pc', 'pcs', 'piece', 'pieces', 'pack', 'packs', 'packet', 'packets', 'pkt', 'pkts', 'nos', 'unit', 'units',
    'bottle', 'bottles', 'pouch', 'pouches', 'jar', 'jars', 'strip', 'strips', 'ladi', 'sachet', 'sachets',
    'पीस', 'पैकेट', 'बोतल', 'लड़ी', 'पाउच'],
  dozen: ['dozen', 'dozens', 'darjan', 'darzan', 'dozan', 'darjen', 'दर्जन'],
  case: ['case', 'cases', 'box', 'boxes', 'carton', 'cartons', 'peti', 'petti', 'petis', 'dabba', 'dabbe',
    'डिब्बा', 'डिब्बे', 'पेटी', 'कार्टन', 'केस'],
};
const SIZE_UNITS = {
  ml: ['ml', 'mls', 'millilitre', 'milliliter', 'मिली', 'एमएल'],
  l: ['l', 'ltr', 'litre', 'liter', 'litres', 'liters', 'lit', 'लीटर'],
  g: ['g', 'gm', 'gms', 'gram', 'grams', 'gramme', 'ग्राम'],
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'किलो'],
  rs: ['rs', 'rupees', 'rupee', 'rupay', 'rupaye', 'rupya', 'wala', 'wale', 'waala', 'वाला', 'वाले', 'रुपये', 'रुपए'],
};
const UNIT_LOOKUP = new Map();
for (const [unit, list] of Object.entries(QTY_UNITS)) list.forEach(w => UNIT_LOOKUP.set(w, { kind: 'qty', unit }));
for (const [unit, list] of Object.entries(SIZE_UNITS)) list.forEach(w => UNIT_LOOKUP.set(w, { kind: 'size', unit }));

const STOCKOUT = new Set(['khatam', 'khatm', 'khattam', 'finished', 'khalas', 'खत्म', 'ख़त्म', 'खतम']);
const SEP_WORDS = new Set(['and', 'aur', 'or', 'then', 'phir', 'fir', 'also', 'plus', 'और', 'फिर', 'तथा']);
const TENS = new Set([20, 30, 40, 50, 60, 70, 80, 90]);

export function sizeKey(v, unit) {
  if (unit === 'ml') return v >= 1000 ? `${v / 1000}l` : `${v}ml`;
  if (unit === 'l') return v < 1 ? `${Math.round(v * 1000)}ml` : `${v}l`;
  if (unit === 'g') return v >= 1000 ? `${v / 1000}kg` : `${v}g`;
  if (unit === 'kg') return v < 1 ? `${Math.round(v * 1000)}g` : `${v}kg`;
  if (unit === 'rs') return `rs${v}`;
  return `${v}${unit}`;
}

export function pcsFor(sku, qty, unit) {
  const s = typeof sku === 'string' ? skuById[sku] : sku;
  if (unit === 'dozen') return Math.round(qty * 12);
  if (unit === 'case') return Math.round(qty * (s?.caseQty || 1));
  return Math.round(qty);
}

export function tokenize(text) {
  let s = (text || '').toLowerCase().normalize('NFC');
  s = s.replace(/[०-९]/g, d => String(DEV_DIGITS.indexOf(d)));
  s = s.replace(/(?:₹|\brs\.?|\binr\b)\s*(\d+)/g, ' $1 rs ');
  s = s.replace(/(\d)\s*[x×]\b/g, '$1 ');
  s = s.replace(/(\d)([a-zऀ-ॣ०-ॿ₹])/g, '$1 $2').replace(/([a-zऀ-ॣ०-ॿ])(\d)/g, '$1 $2');
  s = s.replace(/(?<!\d)\.|\.(?!\d)|[,;:!?।|\n\r"“”‘’()[\]{}]/g, ' <sep> ');
  s = s.replace(/[-–—_/']/g, ' ');
  return s.split(/\s+/).filter(Boolean);
}

function lex(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '<sep>' || SEP_WORDS.has(t)) { out.push({ type: 'sep', raw: t }); continue; }
    let v = null, isWord = true;
    if (/^\d+(\.\d+)?$/.test(t)) { v = parseFloat(t); isWord = false; }
    else if (t in NUM_WORDS && !(t === 'do' && /^(de|dedo|kar|bhej|dena)$/.test(tokens[i - 1] || ''))) v = NUM_WORDS[t];
    else if (t in FRACTIONS) v = FRACTIONS[t];
    else if ((t === 'a' || t === 'an') && UNIT_LOOKUP.get(tokens[i + 1])?.kind === 'qty') v = 1;
    if (v !== null) {
      const prev = out[out.length - 1];
      if (prev && prev.type === 'num' && prev.isWord && isWord) {
        if (TENS.has(prev.v) && v > 0 && v < 10) { prev.v += v; prev.raw += ' ' + t; continue; }
        if (v === 100 && prev.v < 100) { prev.v *= 100; prev.raw += ' ' + t; continue; }
      }
      out.push({ type: 'num', v, raw: t, isWord });
      continue;
    }
    out.push({ type: 'word', t, raw: t });
  }
  return out;
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function tokSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a === b + 's' || b === a + 's') return 0.95;
  const latin = /^[a-z]+$/;
  if (!latin.test(a) || !latin.test(b)) return 0;
  if (Math.min(a.length, b.length) <= 3) return 0;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

function matchFamilies(items) {
  const words = items.map(it => (it.type === 'word' ? it.t : null));
  const cands = [];
  for (const fam of FAMILIES) {
    for (const alias of fam.aliases) {
      const at = alias.split(' ');
      for (let i = 0; i < words.length; i++) {
        if (!words[i]) continue;
        let score = 0, len = 0;
        if (i + at.length <= words.length && at.every((_, k) => words[i + k])) {
          let s = 0;
          for (let k = 0; k < at.length; k++) s += tokSim(words[i + k], at[k]);
          s /= at.length;
          if (s > score) { score = s; len = at.length; }
        }
        if (at.length > 1) { const s = tokSim(words[i], at.join('')); if (s > score) { score = s; len = 1; } }
        if (at.length === 1 && words[i + 1]) { const s = tokSim(words[i] + words[i + 1], at[0]); if (s >= 0.85 && s > score) { score = s; len = 2; } }
        if (score >= 0.8) cands.push({ pos: i, end: i + len - 1, fam: fam.key, score });
      }
    }
  }
  cands.sort((a, b) => (b.end - b.pos) - (a.end - a.pos) || b.score - a.score);
  const taken = new Array(words.length).fill(false);
  const chosen = [];
  for (const c of cands) {
    let ok = true;
    for (let k = c.pos; k <= c.end; k++) if (taken[k]) ok = false;
    if (!ok) continue;
    for (let k = c.pos; k <= c.end; k++) taken[k] = true;
    chosen.push(c);
  }
  chosen.sort((a, b) => a.pos - b.pos);
  const merged = [];
  for (const c of chosen) {
    const last = merged[merged.length - 1];
    if (last && last.fam === c.fam && c.pos - last.end <= 3 && items.slice(last.end + 1, c.pos).every(it => it.type === 'word')) {
      last.end = c.end; continue;
    }
    merged.push({ ...c });
  }
  return merged;
}

export function parseRules(text) {
  const items = lex(tokenize(text));
  // segment ids (separators split segments)
  let seg = 0;
  items.forEach(it => { if (it.type === 'sep') seg++; it.seg = seg; });

  const qty = [], size = [], stock = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.type === 'num') {
      const nx = items[i + 1];
      const u = nx && nx.type === 'word' ? UNIT_LOOKUP.get(nx.t) : null;
      if (u && u.kind === 'size') { size.push({ pos: i, end: i + 1, key: sizeKey(it.v, u.unit), seg: it.seg, raw: `${it.raw} ${nx.t}` }); i++; continue; }
      if (u && u.kind === 'qty') { qty.push({ pos: i, end: i + 1, v: it.v, unit: u.unit, seg: it.seg, raw: `${it.raw} ${nx.t}` }); i++; continue; }
      qty.push({ pos: i, end: i, v: it.v, unit: 'pcs', bare: true, seg: it.seg, raw: it.raw });
      continue;
    }
    if (it.type === 'word') {
      if (STOCKOUT.has(it.t)) stock.push(i);
      if (it.t === 'out' && items[i + 1]?.t === 'of' && items[i + 2]?.t === 'stock') stock.push(i);
    }
  }
  const fams = matchFamilies(items);
  const used = new Set();
  const lines = [], notes = [];
  const firstFam = fams.length ? fams[0].pos : Infinity;
  const qtyFirst = qty.length > 0 && qty[0].end < firstFam;

  fams.forEach((f, idx) => {
    const fam = FAMILIES.find(x => x.key === f.fam);
    const prevEnd = idx > 0 ? fams[idx - 1].end : -1;
    const nextStart = idx < fams.length - 1 ? fams[idx + 1].pos : items.length;
    const fSeg = items[f.pos].seg;
    const inZone = q => q.pos > prevEnd && q.end < nextStart && !used.has(q);

    // size first: explicit size mention nearest the product
    let zoneSizes = size.filter(inZone);
    const sameSegSizes = zoneSizes.filter(s => s.seg === fSeg);
    if (sameSegSizes.length) zoneSizes = sameSegSizes;
    let sizeHit = zoneSizes.sort((a, b) => Math.abs(a.pos - f.pos) - Math.abs(b.pos - f.pos))[0] || null;

    let zoneQty = qty.filter(inZone);
    // bare number matching a pack size of this product (e.g. "coco gold 200, 2 dozen") → treat as size
    if (!sizeHit && zoneQty.length > 1) {
      const bareSize = zoneQty.find(q => q.bare && fam.variants.some(v => parseFloat(v.key.replace(/^rs/, '')) === q.v));
      if (bareSize) {
        const v = fam.variants.find(vv => parseFloat(vv.key.replace(/^rs/, '')) === bareSize.v);
        sizeHit = { key: v.key, raw: bareSize.raw }; used.add(bareSize);
        zoneQty = zoneQty.filter(q => q !== bareSize);
      }
    }
    if (sizeHit && sizeHit.pos !== undefined) used.add(sizeHit);

    const before = zoneQty.filter(q => q.end < f.pos);
    const after = zoneQty.filter(q => q.pos > f.end);
    const pickFrom = (b, a) => (qtyFirst ? (b[b.length - 1] || a[0]) : (a[0] || b[b.length - 1]));
    const sameB = before.filter(q => q.seg === fSeg), sameA = after.filter(q => q.seg === fSeg);
    let pick = (sameB.length || sameA.length) ? pickFrom(sameB, sameA) : pickFrom(before, after);

    const stockHit = stock.find(p => p > f.end && p <= f.end + 5 && p < nextStart);
    if (stockHit !== undefined) {
      notes.push(`${fam.short} out of stock at shop.`);
      if (!pick || pick.pos < f.pos || pick.pos > stockHit) return; // no order for this product
    }

    let variant = sizeHit ? fam.variants.find(v => v.key === sizeHit.key) : null;
    let flag = '';
    if (sizeHit && !variant) flag = `Size "${sizeHit.raw}" not in list`;
    if (!variant) variant = fam.variants.find(v => v.def) || fam.variants[0];

    let q = 1, unit = 'pcs';
    if (pick) { used.add(pick); q = pick.v; unit = pick.unit; } else flag = flag || 'Quantity not heard';
    if (!Number.isInteger(q)) { q = pcsFor(variant, q, unit); unit = 'pcs'; }
    if (q <= 0) return;
    lines.push({ sku: variant.id, qty: q, unit, pcs: pcsFor(variant, q, unit), flag });
  });

  const unmatched = qty.filter(q => !used.has(q) && !q.bare).map(q => q.raw);
  return { lines: mergeLines(lines), note: notes.join(' '), unmatched };
}

export function mergeLines(lines) {
  const out = [];
  for (const l of lines) {
    const ex = out.find(o => o.sku === l.sku);
    if (!ex) { out.push({ ...l }); continue; }
    if (ex.unit === l.unit) ex.qty += l.qty;
    else { ex.qty = ex.pcs + l.pcs; ex.unit = 'pcs'; }
    ex.pcs = pcsFor(ex.sku, ex.qty, ex.unit);
    ex.flag = ex.flag || l.flag;
  }
  return out;
}

// Validate an LLM JSON result against the catalogue. Returns null if unusable.
export function validateLLM(obj) {
  if (!obj || !Array.isArray(obj.lines)) return null;
  const lines = [];
  for (const l of obj.lines) {
    if (!l || !skuById[l.sku]) continue;
    const q = Number(l.qty);
    if (!Number.isFinite(q) || q <= 0 || q > 9999) continue;
    const unit = ['pcs', 'dozen', 'case'].includes(l.unit) ? l.unit : 'pcs';
    const qty = Number.isInteger(q) ? q : pcsFor(l.sku, q, unit);
    lines.push({ sku: l.sku, qty, unit: Number.isInteger(q) ? unit : 'pcs', pcs: pcsFor(l.sku, qty, Number.isInteger(q) ? unit : 'pcs'), flag: '' });
  }
  return { lines: mergeLines(lines), note: typeof obj.note === 'string' ? obj.note.trim() : '' };
}

export function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}
