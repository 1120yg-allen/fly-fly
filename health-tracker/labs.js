'use strict';

/* ---------- 檢驗：判讀、參考值文字、報告文字解析 ---------- */
const LAB_ITEMS = {};
const LAB_CAT_OF = {};
for (const cat of LAB_CATEGORIES) {
  for (const item of cat.items) {
    LAB_ITEMS[item.key] = item;
    LAB_CAT_OF[item.key] = cat;
  }
}

const isNumericItem = (item) => !item.kind || item.kind === 'tier';
const fmtRangeNum = (n) => String(n);

/** 依性別取得參考範圍；未設定性別時取兩者聯集 */
function labRange(item, sex) {
  const r = item.range;
  if (!r) return null;
  if (r.M && r.F) {
    if (sex === 'M' || sex === 'F') return { low: r[sex][0], high: r[sex][1] };
    return { low: Math.min(r.M[0], r.F[0]), high: Math.max(r.M[1], r.F[1]), unisex: true };
  }
  if (Array.isArray(r)) return { low: r[0], high: r[1] };
  return {
    low: r.gt ?? r.ge ?? null, high: r.lt ?? r.le ?? null,
    strictLow: r.gt != null, strictHigh: r.lt != null,
  };
}

/** 參考值顯示文字，例如「3.25–9.16」「< 140」「男 13.1–17.2／女 11.0–15.2」 */
function labRefText(item, sex) {
  if (item.ref) return item.ref;
  const r = item.range;
  if (!r) return item.kind === 'text' ? '' : '未提供';
  const one = (x) => {
    if (Array.isArray(x)) return `${fmtRangeNum(x[0])}–${fmtRangeNum(x[1])}`;
    if (x.lt != null) return `< ${x.lt}`;
    if (x.le != null) return `≤ ${x.le}`;
    if (x.gt != null) return `> ${x.gt}`;
    if (x.ge != null) return `≥ ${x.ge}`;
    return '';
  };
  if (r.M && r.F) {
    if (sex === 'M') return `${one(r.M)}（男）`;
    if (sex === 'F') return `${one(r.F)}（女）`;
    return `男 ${one(r.M)}／女 ${one(r.F)}`;
  }
  return one(r);
}

/* 定性結果：陰性 / 微量 / 陽性 */
const QUAL_PATTERNS = [
  ['trace', /\+\s*\/\s*-|±|trace|微量/],
  ['neg', /negative|\bneg\b|陰性|\(\s*-\s*\)|non[\s-]*reactive|無反應|未發現|not\s*found|\bnone\b|\bnil\b|\bnormal\b|正常|未見|^\s*-\s*$|\bno\b|無/],
  ['pos', /positive|\bpos\b|陽性|reactive|\(\s*\++\s*\)|[1-4]\s*\+|\+{1,4}|異常|abnormal|found|發現/],
];

/** 回傳 { cls: 'neg'|'trace'|'pos', at, text } 或 null；取字串中最早出現者 */
function detectQual(s) {
  const str = String(s).toLowerCase();
  let best = null;
  for (const [cls, re] of QUAL_PATTERNS) {
    const m = re.exec(str);
    if (m && (!best || m.index < best.at)) best = { cls, at: m.index, text: m[0] };
  }
  return best;
}

const QUAL_LABEL = { neg: '陰性 (-)', trace: '微量 (+/-)', pos: '陽性 (+)' };

/** 把數值字串解析為數字："6.5"、"<0.1"、"0-2"（取上限） */
function labNumber(value) {
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  const range = /^(\d+(?:\.\d+)?)\s*[-~～]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (range) return Number(range[2]);
  const m = /^[<>≤≥]?=?\s*(-?\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : null;
}

/**
 * 判讀：回傳 { level: 'ok'|'warn'|'info', text } 或 null（無法判讀）
 * 「warn」代表需要注意（偏高、偏低、陽性）
 */
function evalLab(item, value, sex) {
  if (value == null || value === '') return null;
  if (item.kind === 'text') {
    const q = detectQual(value);
    if (!q) return null;
    if (q.cls === 'neg') return { level: 'ok', text: '正常' };
    if (q.cls === 'pos') return { level: 'warn', text: '異常' };
    return null;
  }
  if (item.kind === 'qual') {
    const q = detectQual(value);
    if (!q) return null;
    const normal = item.normal || ['neg'];
    if (normal.includes(q.cls)) return { level: 'ok', text: q.cls === 'trace' ? '微量' : '陰性' };
    return { level: 'warn', text: q.cls === 'trace' ? '微量' : '陽性' };
  }
  if (item.kind === 'sco') {
    const n = labNumber(value);
    let cls;
    if (n != null) {
      const { cutoff, inverse, gray, strict } = item.sco;
      if (gray && n >= gray[0] && n <= gray[1]) cls = 'gray';
      else if (gray) cls = n > gray[1] ? 'pos' : 'neg';
      else if (inverse) cls = n <= cutoff ? 'pos' : 'neg';
      else cls = (strict ? n > cutoff : n >= cutoff) ? 'pos' : 'neg';
    } else {
      const q = detectQual(value);
      if (!q) return null;
      cls = q.cls === 'trace' ? 'gray' : q.cls;
    }
    return item[cls] || null;
  }
  const n = labNumber(value);
  if (n == null || Number.isNaN(n)) return null;
  if (item.kind === 'tier') {
    for (const t of item.tiers) {
      if ((t.lt != null && n < t.lt) || (t.le != null && n <= t.le) || (t.lt == null && t.le == null)) return { level: t.level, text: t.text };
    }
    return null;
  }
  const r = labRange(item, sex);
  if (!r) return null;
  if (r.high != null && (r.strictHigh ? n >= r.high : n > r.high)) return { level: 'warn', text: '偏高', dir: 'high' };
  if (r.low != null && (r.strictLow ? n <= r.low : n < r.low)) return { level: 'warn', text: '偏低', dir: 'low' };
  return { level: 'ok', text: '正常' };
}

/** 儲存前整理輸入值：純數字存成 number，其餘保留文字 */
function normalizeLabValue(item, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (isNumericItem(item) || item.kind === 'sco') {
    const re = item.signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
    if (re.test(s)) return Number(s);
  }
  return s;
}

/* ---------- 報告文字解析（拍照辨識後使用） ---------- */
const SEP = '[\\s\\-.()/,:：_]*';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 正規化 OCR 文字：全形轉半形、小寫、希臘字母轉英文 */
function normalizeOcr(s) {
  return s.normalize('NFKC').toLowerCase()
    .replace(/[µμ]/g, 'u').replace(/γ/g, 'g').replace(/[αа]/g, 'a').replace(/β/g, 'b')
    .replace(/[–—−－]/g, '-').replace(/[～〜]/g, '~').replace(/[|｜]/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/©/g, '(-)'); // 小字的「(-)」常被辨識成「©」
}

function aliasRegex(alias) {
  const a = normalizeOcr(alias);
  if (/[^\x00-\x7f]/.test(a) && !/[a-z0-9]/.test(a)) {
    return new RegExp(a.split('').filter((c) => c.trim()).map(escapeRe).join('\\s*'), 'g');
  }
  const parts = a.split(/[\s\-.()/,:_]+/).filter(Boolean).map(escapeRe);
  return new RegExp(`(?<![a-z0-9])${parts.join(SEP)}(?![a-z0-9])`, 'g');
}

let aliasIndex = null;
function getAliasIndex() {
  if (aliasIndex) return aliasIndex;
  aliasIndex = [];
  for (const item of Object.values(LAB_ITEMS)) {
    for (const alias of item.aliases) aliasIndex.push({ item, re: aliasRegex(alias) });
  }
  return aliasIndex;
}

const CTX_PATTERNS = [
  ['urine', /尿液|尿沉渣|尿常規|urine|urinalysis|dipstick|sediment|\/\s*hpf|\/\s*lpf|試紙/],
  ['stool', /糞便|stool|fecal|feces/],
  ['blood', /血液常規|血液檢查|全血|cbc|生化|biochem|血清|serum|肝功能|腎功能|血脂|血糖|甲狀腺|腫瘤/],
];

function detectCtx(line) {
  for (const [ctx, re] of CTX_PATTERNS) if (re.test(line)) return ctx;
  return null;
}

/* 會被誤認為數值的單位或描述 */
const UNIT_NOISE = [
  /x?\s*10\s*[\^*e]?\s*[0-9]{1,2}\s*\/\s*u?l\b/g, // 10^3/uL、103/uL
  /\b[km]\s*\/\s*ul\b/g,
  /\/\s*24\s*h(?:rs?|ours?)?\b/g,
  /\d+\s*(?:min|分鐘)/g,
  /\d+\s*(?:hrs?|小時)\s*(?:p\.?\s*c\.?|飯後)?/g,
];

const NUM_TOKEN = /([<>≤≥]=?)?\s*(-?\d+(?:\.\d+)?)(?:\s*[-~]\s*(\d+(?:\.\d+)?))?/g;

function extractValue(item, segment) {
  let s = segment;
  // 去掉同一項目的其他名稱（例如「CA-125 癌症抗原125」中的 125）
  for (const alias of item.aliases) s = s.replace(aliasRegex(alias), ' ');
  for (const re of UNIT_NOISE) s = s.replace(re, ' ');

  if (item.kind === 'text') {
    const t = s.replace(/^[\s:：,.\-]+/, '').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 80) : null;
  }
  if (item.kind === 'qual') {
    const q = detectQual(s);
    return q ? (q.cls === 'pos' && /[1-4]\s*\+|\+{2,4}/.test(q.text) ? q.text.replace(/\s/g, '') : QUAL_LABEL[q.cls]) : null;
  }

  const tokens = [];
  for (const m of s.matchAll(NUM_TOKEN)) {
    const neg = m[2].startsWith('-');
    tokens.push({ cmp: m[1] || '', a: neg && !item.signed ? m[2].slice(1) : m[2], b: m[3], index: m.index });
  }
  const q = item.kind === 'sco' ? detectQual(s) : null;

  let value = null;
  if (item.rangeResult && tokens.length) {
    const t = tokens[0];
    value = t.b != null ? `${t.a}-${t.b}` : t.a;
  } else {
    const plain = tokens.find((t) => t.b == null && !t.cmp) || tokens.find((t) => t.b == null);
    if (plain) value = (plain.cmp ? plain.cmp : '') + plain.a;
  }
  if (value == null) {
    if (q) return QUAL_LABEL[q.cls];
    return null;
  }
  if (item.conv && s.includes(item.conv.from)) {
    const n = Number(value);
    if (!Number.isNaN(n)) value = String(Math.round(n * item.conv.factor * 100) / 100);
  }
  // 「08」這類開頭為 0 的整數，幾乎都是漏掉小數點的「0.8」
  if (/^0\d+$/.test(value)) value = `0.${value.slice(1)}`;
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

/**
 * 辨識時小數點容易遺漏（1.1 → 11）。數值遠超出參考範圍、且補上小數點後會落在合理範圍時，
 * 回傳建議值讓使用者確認；不會自動修改。
 */
function decimalSuggestion(item, value, sex) {
  if (!isNumericItem(item) || item.rangeResult || typeof value !== 'number' || !Number.isInteger(value) || value < 10) return null;
  const r = labRange(item, sex);
  if (!r || (r.high == null && r.low == null)) return null;
  const lo = r.low ?? 0;
  const hi = r.high ?? r.low * 2.5;
  if (value <= hi * 3) return null;
  const digits = String(value);
  let best = null;
  for (let i = 1; i < digits.length; i++) {
    const cand = Number(`${digits.slice(0, i)}.${digits.slice(i)}`);
    const dist = cand < lo ? (lo - cand) / (hi - lo || 1) : cand > hi ? (cand - hi) / (hi - lo || 1) : 0;
    if (!best || dist < best.dist) best = { value: cand, dist };
  }
  return best && best.dist < 1 ? best.value : null;
}

/** 找出報告日期（民國年也可以） */
function detectReportDate(lines) {
  const today = new Date();
  let best = null;
  for (const line of lines) {
    const hint = /採檢|採血|檢驗日|報告日|檢查日|收件|簽收|日期|date|collect|report/.test(line) ? 2 : 0;
    for (const m of line.matchAll(/(\d{2,4})\s*[\/.\-年]\s*(\d{1,2})\s*[\/.\-月]\s*(\d{1,2})/g)) {
      let y = Number(m[1]);
      if (y < 200) y += 1911;
      else if (y < 1000) continue;
      const mo = Number(m[2]), d = Number(m[3]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      const date = new Date(y, mo - 1, d);
      if (date > today || y < 1990) continue;
      const score = hint * 1e13 + date.getTime();
      if (!best || score > best.score) best = { score, date };
    }
  }
  return best ? best.date : null;
}

/**
 * 解析辨識出的文字。回傳 { values: { key: value }, matched: [{ key, line }], date }
 * 每一行可能有多個項目（例如報告分兩欄），依名稱出現的位置切開。
 */
function parseLabText(text) {
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map(normalizeOcr);
  const index = getAliasIndex();
  const values = {};
  const matched = [];
  let sectionCtx = null;

  lines.forEach((line, li) => {
    if (!line.trim()) return;
    const lineCtx = detectCtx(line);
    // 純標題行（沒有數字）用來切換段落
    if (lineCtx && !/\d/.test(line.replace(/\/\s*[hl]pf/g, ''))) { sectionCtx = lineCtx === 'blood' ? null : lineCtx; }
    const ctx = lineCtx && lineCtx !== 'blood' ? lineCtx : (lineCtx === 'blood' ? null : sectionCtx);

    // 血壓「120/80」寫在同一格
    const bp = /(?:血壓|blood\s*pressure|\bbp\b)[^\d]*(\d{2,3})\s*\/\s*(\d{2,3})/.exec(line);
    if (bp && !values.SBP) {
      values.SBP = Number(bp[1]); values.DBP = Number(bp[2]);
      matched.push({ key: 'SBP', line: rawLines[li] }, { key: 'DBP', line: rawLines[li] });
    }

    const cands = [];
    for (const { item, re } of index) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        if (!m[0]) { re.lastIndex++; continue; }
        const ctxScore = item.ctx ? (item.ctx === ctx ? 2 : -1) : (ctx ? 0 : 1);
        cands.push({ item, start: m.index, end: m.index + m[0].length, len: m[0].length, ctxScore });
      }
    }
    // 名稱越長越優先，其次看段落（尿液 / 糞便 / 血液）是否相符
    cands.sort((a, b) => b.len - a.len || b.ctxScore - a.ctxScore);
    const accepted = [];
    const occupied = []; // 已被較長名稱占用的位置（包含同一項目重複出現的名稱）
    for (const c of cands) {
      if (occupied.some((a) => c.start < a.end && a.start < c.end)) continue;
      occupied.push(c);
      // 同一行同一項目只取一次（英文縮寫與中文名稱並列時）
      if (!accepted.some((a) => a.item === c.item)) accepted.push(c);
    }
    accepted.sort((a, b) => a.start - b.start);
    accepted.forEach((c, i) => {
      const next = accepted[i + 1];
      const segment = line.slice(c.end, next ? next.start : line.length);
      if (values[c.item.key] != null) return;
      const v = extractValue(c.item, segment);
      if (v == null || v === '') return;
      values[c.item.key] = v;
      matched.push({ key: c.item.key, line: rawLines[li] });
    });
  });

  return { values, matched, date: detectReportDate(lines) };
}
