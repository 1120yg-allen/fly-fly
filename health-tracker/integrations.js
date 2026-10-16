'use strict';

/* ---------- 連結 Apple 與 Google ----------
 * 1. 匯入健康資料（在裝置上解析，檔案不會上傳）
 *    - Apple「健康」App：設定頁「匯出所有健康資料」產生的 export.zip（或其中的 export.xml）
 *    - Google Takeout：Fitbit（Global Export Data/*.json）與 Google Fit（Daily activity metrics、睡眠 Sessions）
 *    同一天、同一種資料會用固定的 id，重複匯入只會更新，不會重複。
 * 2. 雲端備份
 *    - 分享備份檔：iPhone 選「儲存到檔案 → iCloud 雲端硬碟」，Android 選「雲端硬碟」
 *    - Google 雲端硬碟一鍵備份／還原（需要 Google OAuth 用戶端 ID，見 README）
 */

/* ---------- ZIP 讀取（支援 deflate 與 ZIP64，逐段解壓，不會一次載入整個檔案） ---------- */
const Zip = (() => {
  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);
  const u64 = (v, o) => Number(v.getBigUint64(o, true));
  const read = async (blob, start, len) => new DataView(await blob.slice(start, start + len).arrayBuffer());

  async function list(blob) {
    const tailLen = Math.min(blob.size, 65557);
    const tail = await read(blob, blob.size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('不是有效的 ZIP 檔');
    let count = u16(tail, eocd + 10);
    let cdSize = u32(tail, eocd + 12);
    let cdOffset = u32(tail, eocd + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) {
      // ZIP64：EOCD 前面有 locator 指向 ZIP64 EOCD
      const loc = eocd - 20;
      if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
        const z64 = await read(blob, u64(tail, loc + 8), 56);
        count = u64(z64, 32); cdSize = u64(z64, 40); cdOffset = u64(z64, 48);
      }
    }
    const cd = await read(blob, cdOffset, cdSize);
    const td = new TextDecoder();
    const entries = [];
    for (let p = 0, i = 0; i < count && p + 46 <= cd.byteLength; i++) {
      if (u32(cd, p) !== 0x02014b50) break;
      const method = u16(cd, p + 10);
      let compSize = u32(cd, p + 20), size = u32(cd, p + 24);
      const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
      let offset = u32(cd, p + 42);
      const name = td.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
      // ZIP64 extra field
      for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen;) {
        const id = u16(cd, e), len = u16(cd, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
          if (compSize === 0xffffffff) { compSize = u64(cd, q); q += 8; }
          if (offset === 0xffffffff) { offset = u64(cd, q); }
        }
        e += 4 + len;
      }
      if (!name.endsWith('/')) entries.push({ name, method, compSize, size, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  /** 回傳解壓後的位元組串流 */
  async function stream(blob, entry) {
    const lh = await read(blob, entry.offset, 30);
    if (u32(lh, 0) !== 0x04034b50) throw new Error('ZIP 檔內容損毀');
    const start = entry.offset + 30 + u16(lh, 26) + u16(lh, 28);
    const raw = blob.slice(start, start + entry.compSize).stream();
    if (entry.method === 0) return raw;
    if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('這個瀏覽器不支援解壓縮，請更新瀏覽器（iOS 16.4 以上）');
      return raw.pipeThrough(new DecompressionStream('deflate-raw'));
    }
    throw new Error(`不支援的壓縮方式（${entry.method}）`);
  }

  async function text(blob, entry) {
    return new Response(await stream(blob, entry)).text();
  }

  return { list, stream, text };
})();

/* ---------- 共用：每日彙整 ---------- */
const pad2i = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad2i(d.getMonth() + 1)}-${pad2i(d.getDate())}`;
const localTime = (d) => `${localDay(d)}T${pad2i(d.getHours())}:${pad2i(d.getMinutes())}`;

/** 每天、每個來源分別加總，最後取來源中最大者（iPhone 與手錶同時計步時避免重複計算） */
class DailyBySource {
  constructor() { this.map = new Map(); }
  add(day, source, v) {
    if (!this.map.has(day)) this.map.set(day, new Map());
    const m = this.map.get(day);
    m.set(source, (m.get(source) || 0) + v);
  }
  result() {
    const out = new Map();
    for (const [day, m] of this.map) out.set(day, Math.max(...m.values()));
    return out;
  }
}

function emptyImport(source) {
  return { source, steps: new Map(), water: new Map(), exercise: new Map(), sleep: new Map(), heart: new Map(),
    weight: new Map(), bp: [], glucose: [], temp: [], files: 0 };
}

/* ---------- Apple 健康 ---------- */
const APPLE_TYPES = {
  HKQuantityTypeIdentifierStepCount: 'steps',
  HKQuantityTypeIdentifierBodyMass: 'weight',
  HKQuantityTypeIdentifierRestingHeartRate: 'heart',
  HKQuantityTypeIdentifierBloodPressureSystolic: 'sys',
  HKQuantityTypeIdentifierBloodPressureDiastolic: 'dia',
  HKQuantityTypeIdentifierBloodGlucose: 'glucose',
  HKQuantityTypeIdentifierBodyTemperature: 'temp',
  HKQuantityTypeIdentifierDietaryWater: 'water',
  HKQuantityTypeIdentifierAppleExerciseTime: 'exercise',
  HKCategoryTypeIdentifierSleepAnalysis: 'sleep',
};

/** "2024-09-30 07:12:00 +0800" → Date */
function parseAppleDate(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) ([+-])(\d\d)(\d\d)$/.exec(s || '');
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const off = (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]);
  return new Date(utc - off * 60000);
}

function convertUnit(kind, value, unit) {
  const u = (unit || '').toLowerCase();
  if (kind === 'weight') return u === 'lb' ? value * 0.45359237 : u === 'g' ? value / 1000 : value;
  if (kind === 'glucose') return u.startsWith('mmol') ? value * 18.016 : value;
  if (kind === 'temp') return u === 'degf' ? (value - 32) * 5 / 9 : value;
  if (kind === 'water') return u === 'l' ? value * 1000 : u.startsWith('fl_oz') ? value * 29.5735 : value;
  return value;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (v) => v.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, e) => (e[0] === '#' ? String.fromCharCode(+e.slice(1)) : XML_ENTITIES[e]));

/** 逐段掃描 export.xml 的 <Record> 標籤（檔案可能數百 MB） */
async function parseAppleStream(textStream, totalBytes, since, onProgress) {
  const out = emptyImport('apple');
  const steps = new DailyBySource(), water = new DailyBySource(), exercise = new DailyBySource(), sleep = new DailyBySource();
  const bpPairs = new Map();
  const reader = textStream.getReader();
  let buf = '', seen = 0, count = 0;
  const attrRe = /(\w+)="([^"]*)"/g;

  const handle = (tag) => {
    const typeM = /\btype="([^"]+)"/.exec(tag);
    const kind = typeM && APPLE_TYPES[typeM[1]];
    if (!kind) return;
    const a = {};
    attrRe.lastIndex = 0;
    for (let m; (m = attrRe.exec(tag));) a[m[1]] = m[2].includes('&') ? decodeXml(m[2]) : m[2];
    const start = parseAppleDate(a.startDate);
    const end = parseAppleDate(a.endDate) || start;
    if (!start || end < since) return;
    const src = a.sourceName || '';
    count++;
    if (kind === 'sleep') {
      if (!/Asleep/.test(a.value || '')) return; // 只計算「睡著」，不含「在床上」與清醒
      sleep.add(localDay(end), src, (end - start) / 3600e3);
      return;
    }
    const v = convertUnit(kind, Number(a.value), a.unit);
    if (!Number.isFinite(v)) return;
    const day = localDay(start);
    if (kind === 'steps') steps.add(day, src, v);
    else if (kind === 'water') water.add(day, src, v);
    else if (kind === 'exercise') exercise.add(day, src, v);
    else if (kind === 'weight') out.weight.set(day, { time: localTime(start), weight: v });
    else if (kind === 'heart') out.heart.set(day, v);
    else if (kind === 'glucose') out.glucose.push({ time: localTime(start), value: v });
    else if (kind === 'temp') out.temp.push({ time: localTime(start), celsius: v });
    else if (kind === 'sys' || kind === 'dia') {
      const key = a.startDate;
      const pair = bpPairs.get(key) || { time: localTime(start) };
      pair[kind] = v;
      bpPairs.set(key, pair);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buf += value;
      seen += value.length;
      let i = 0;
      for (;;) {
        const s = buf.indexOf('<Record ', i);
        if (s < 0) { i = Math.max(i, buf.length - 8); break; }
        const e = buf.indexOf('>', s);
        if (e < 0) { i = s; break; }
        handle(buf.slice(s, e));
        i = e + 1;
      }
      buf = buf.slice(i);
      onProgress?.(totalBytes ? Math.min(0.99, seen / totalBytes) : 0, count);
    }
    if (done) break;
  }
  out.steps = steps.result();
  out.water = water.result();
  out.exercise = exercise.result();
  out.sleep = sleep.result();
  out.bp = [...bpPairs.values()].filter((p) => p.sys && p.dia);
  out.files = 1;
  return out;
}

/* ---------- Google（Takeout：Fitbit 與 Google Fit） ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = (rows.shift() || []).map((h) => h.replace(/^﻿/, '').trim());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/** Fitbit 的日期格式 "09/30/24 07:15:00" 或 "09/30/24" */
function parseFitbitDate(s) {
  const m = /^(\d\d)\/(\d\d)\/(\d\d)(?: (\d\d):(\d\d):(\d\d))?/.exec(s || '');
  if (!m) return null;
  return new Date(2000 + +m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/**
 * Takeout 可能同時有 Fitbit、Google Fit 總表與 Google Fit 每日檔案，三者的步數、運動、睡眠是重複的資料。
 * 先分開加總，最後每天取最大值（finalizeGoogle）。
 */
function googleBucket(out, name) {
  out.parts = out.parts || {};
  return (out.parts[name] = out.parts[name] || { steps: new Map(), exercise: new Map(), sleep: new Map() });
}

function finalizeGoogle(out) {
  for (const part of Object.values(out.parts || {})) {
    for (const k of ['steps', 'exercise', 'sleep']) {
      for (const [day, v] of part[k]) if (!(out[k].get(day) >= v)) out[k].set(day, v);
    }
  }
  return out;
}

function addGoogleFile(out, name, content, since) {
  const base = name.split('/').pop();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const sinceDay = localDay(since);
  const inRange = (day) => day >= sinceDay;
  const addMap = (map, day, v) => { if (inRange(day) && v != null) map.set(day, (map.get(day) || 0) + v); };

  // Fitbit JSON（Global Export Data）
  let m;
  if ((m = /^(steps|moderately_active_minutes|very_active_minutes|resting_heart_rate|weight|sleep)-\d{4}-\d\d-\d\d\.json$/.exec(base))) {
    let arr;
    try { arr = JSON.parse(content); } catch { return false; }
    if (!Array.isArray(arr)) return false;
    const kind = m[1];
    const part = googleBucket(out, 'fitbit');
    for (const r of arr) {
      if (kind === 'sleep') {
        const day = r.dateOfSleep;
        if (day && num(r.minutesAsleep) != null) addMap(part.sleep, day, num(r.minutesAsleep) / 60);
        continue;
      }
      if (kind === 'weight') {
        const d = parseFitbitDate(`${r.date} ${r.time || '00:00:00'}`);
        const w = num(r.weight);
        if (d && w != null && inRange(localDay(d))) out.weight.set(localDay(d), { time: localTime(d), weight: w, fitbit: true });
        continue;
      }
      const d = parseFitbitDate(r.dateTime);
      if (!d) continue;
      if (kind === 'resting_heart_rate') {
        const v = num(r.value?.value);
        if (v && inRange(localDay(d))) out.heart.set(localDay(d), v);
      } else if (kind === 'steps') {
        addMap(part.steps, localDay(d), num(r.value));
      } else {
        addMap(part.exercise, localDay(d), num(r.value));
      }
    }
    out.files++;
    return true;
  }

  // Google Fit：Daily activity metrics（總表，每列一天；或每日檔案，每列 15 分鐘）
  if (/\.csv$/i.test(base) && /Daily activity metrics|^\d{4}-\d\d-\d\d\.csv$/i.test(name)) {
    const rows = parseCSV(content);
    if (!rows.length) return false;
    const fileDay = /^(\d{4}-\d\d-\d\d)\.csv$/.exec(base)?.[1];
    const part = googleBucket(out, fileDay ? 'fitDay' : 'fitSummary');
    for (const r of rows) {
      const day = r.Date || fileDay;
      if (!day || !/^\d{4}-\d\d-\d\d$/.test(day)) continue;
      addMap(part.steps, day, num(r['Step count']));
      addMap(part.exercise, day, num(r['Heart Minutes'] ?? r['Heart minutes']));
      const w = num(r['Average weight (kg)']);
      if (w && inRange(day)) out.weight.set(day, { time: `${day}T08:00`, weight: w });
    }
    out.files++;
    return true;
  }

  // Google Fit：睡眠 Session（All Sessions/*.json）
  if (/\.json$/i.test(base) && /Sessions/i.test(name)) {
    let s;
    try { s = JSON.parse(content); } catch { return false; }
    if (s && (s.fitnessActivity === 'sleep' || s.activityType === 72) && s.startTime && s.endTime) {
      const start = new Date(s.startTime), end = new Date(s.endTime);
      if (end > start) addMap(googleBucket(out, 'fitSessions').sleep, localDay(end), (end - start) / 3600e3);
      out.files++;
      return true;
    }
    return false;
  }
  return false;
}

/* ---------- 讀取使用者選的檔案 ---------- */
const IMPORT_TYPES_TEXT = { apple: 'Apple 健康', google: 'Google（Fitbit／Google Fit）' };

async function readHealthFiles(fileList, since, onProgress) {
  const files = [...fileList];
  let apple = null;
  const google = emptyImport('google');
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.zip')) {
      onProgress?.('讀取 ZIP 檔案…', 0);
      const entries = await Zip.list(file);
      const xml = entries.find((e) => /(^|\/)export\.xml$/i.test(e.name) && !/cda/i.test(e.name));
      if (xml) {
        const stream = (await Zip.stream(file, xml)).pipeThrough(new TextDecoderStream());
        apple = await parseAppleStream(stream, xml.size, since, (p, n) => onProgress?.(`解析 Apple 健康資料（${n.toLocaleString()} 筆）…`, p));
        continue;
      }
      const relevant = entries.filter((e) => /\.(json|csv)$/i.test(e.name) && /(fitbit|fit\/|global export data|daily activity metrics|sessions)/i.test(e.name));
      for (const [i, e] of relevant.entries()) {
        addGoogleFile(google, e.name, await Zip.text(file, e), since);
        if (i % 20 === 0) onProgress?.(`解析 Google 資料（${i + 1}/${relevant.length} 個檔案）…`, i / relevant.length);
      }
    } else if (name.endsWith('.xml')) {
      const stream = file.stream().pipeThrough(new TextDecoderStream());
      apple = await parseAppleStream(stream, file.size, since, (p, n) => onProgress?.(`解析 Apple 健康資料（${n.toLocaleString()} 筆）…`, p));
    } else if (/\.(json|csv)$/.test(name)) {
      addGoogleFile(google, file.webkitRelativePath || file.name, await file.text(), since);
    }
  }
  return [apple, google.files ? finalizeGoogle(google) : null].filter(Boolean);
}

/** Fitbit 體重單位依使用者設定可能是磅：數值普遍大於 140 時視為磅 */
function fitbitWeightLooksLb(imp) {
  const ws = [...imp.weight.values()].filter((w) => w.fitbit).map((w) => w.weight).sort((a, b) => a - b);
  return ws.length > 0 && ws[Math.floor(ws.length / 2)] > 140;
}

/** 轉成 App 的紀錄（固定 id，重複匯入只會覆蓋） */
function importToEntries(imp, profileId, { fitbitLb = false } = {}) {
  const src = imp.source;
  const note = `由${IMPORT_TYPES_TEXT[src]}匯入`;
  const id = (type, key) => `imp-${profileId}-${src}-${type}-${key}`;
  const out = [];
  const push = (type, key, time, values) => out.push({ id: id(type, key), profileId, type, time, values, note, source: src, createdAt: new Date().toISOString() });
  const r1 = (n) => Math.round(n * 10) / 10;
  for (const [day, v] of imp.steps) if (v > 0) push('steps', day, `${day}T21:00`, { steps: Math.round(v) });
  for (const [day, v] of imp.water) if (v > 0) push('water', day, `${day}T21:00`, { ml: Math.round(v) });
  for (const [day, v] of imp.exercise) if (v >= 1) push('exercise', day, `${day}T20:00`, { minutes: Math.round(v), kind: src === 'apple' ? '運動時間（Apple）' : '活動時間（Google）' });
  for (const [day, v] of imp.sleep) if (v > 0.5) push('sleep', day, `${day}T07:00`, { hours: Math.round(v * 4) / 4 });
  for (const [day, v] of imp.heart) push('heart', day, `${day}T07:30`, { bpm: Math.round(v) });
  for (const [day, w] of imp.weight) push('weight', day, w.time, { weight: r1(w.fitbit && fitbitLb ? w.weight * 0.45359237 : w.weight) });
  for (const b of imp.bp) push('bp', b.time.replace(/[-:T]/g, ''), b.time, { sys: Math.round(b.sys), dia: Math.round(b.dia) });
  for (const g of imp.glucose) push('glucose', g.time.replace(/[-:T]/g, ''), g.time, { value: Math.round(g.value), context: 'random' });
  for (const t of imp.temp) push('temp', t.time.replace(/[-:T]/g, ''), t.time, { celsius: r1(t.celsius) });
  return out;
}

function importSummary(imp) {
  const parts = [
    ['步數', imp.steps.size, '天'], ['睡眠', imp.sleep.size, '晚'], ['運動', imp.exercise.size, '天'],
    ['靜止心率', imp.heart.size, '天'], ['體重', imp.weight.size, '筆'], ['血壓', imp.bp.length, '筆'],
    ['血糖', imp.glucose.length, '筆'], ['體溫', imp.temp.length, '筆'], ['飲水', imp.water.size, '天'],
  ].filter(([, n]) => n > 0);
  const days = [...imp.steps.keys(), ...imp.sleep.keys(), ...imp.weight.keys(), ...imp.heart.keys(), ...imp.exercise.keys()].sort();
  return { parts, from: days[0], to: days[days.length - 1], total: parts.reduce((n, [, c]) => n + c, 0) };
}

/**
 * 同一天、同一種「每日一筆」的資料若已由另一個來源匯入（例如 Apple 與 Google 都有步數），
 * 只保留數值較大的一筆，避免總覽把兩邊加總。回傳 { records（要寫入的）, replaced（要刪除的舊紀錄 id） }。
 */
const DAILY_IMPORT_TYPES = { steps: 'steps', water: 'ml', exercise: 'minutes', sleep: 'hours', heart: null };
function dedupeAcrossSources(records, existing) {
  const key = (e) => `${e.profileId}|${e.type}|${e.time.slice(0, 10)}`;
  const others = new Map();
  for (const e of existing) {
    if (!e.deleted && e.source && e.id.startsWith('imp-') && e.type in DAILY_IMPORT_TYPES) others.set(key(e) + '|' + e.source, e);
  }
  const out = [], replaced = [];
  for (const r of records) {
    if (!(r.type in DAILY_IMPORT_TYPES)) { out.push(r); continue; }
    const field = DAILY_IMPORT_TYPES[r.type];
    const rivals = [...others.entries()].filter(([k, e]) => k.startsWith(key(r) + '|') && e.source !== r.source).map(([, e]) => e);
    if (!rivals.length) { out.push(r); continue; }
    const best = rivals.reduce((a, b) => (field && b.values[field] > a.values[field] ? b : a));
    if (field && r.values[field] > best.values[field]) { out.push(r); replaced.push(...rivals.map((e) => e.id)); }
  }
  return { records: out, replaced };
}

/** 一次寫入大量紀錄（只存檔一次） */
function upsertMany(coll, records, removeIds = []) {
  const index = new Map(db[coll].map((r, i) => [r.id, i]));
  const t = Date.now();
  let added = 0;
  for (const id of removeIds) {
    const i = index.get(id);
    if (i != null) db[coll][i] = { id, profileId: db[coll][i].profileId, deleted: true, updatedAt: t };
  }
  for (const rec of records) {
    const r = { ...rec, updatedAt: t };
    const i = index.get(r.id);
    if (i == null) { index.set(r.id, db[coll].length); db[coll].push(r); added++; } else db[coll][i] = r;
  }
  return persist() ? { added, updated: records.length - added } : null;
}

/* ---------- 雲端備份 ---------- */
function backupPayload() {
  return JSON.stringify({ app: 'health-tracker', exportedAt: new Date().toISOString(), ...db });
}

/** 用系統分享選單備份：iPhone →「儲存到檔案」→ iCloud 雲端硬碟；Android →「雲端硬碟」 */
async function shareBackup() {
  const name = `health-backup-${localDay(new Date())}.json`;
  if (Native.enabled) return Native.shareFile(name, backupPayload());
  const file = new File([backupPayload()], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '健康紀錄備份' });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  download(name, await file.text(), 'application/json');
  return 'downloaded';
}

/** Google 雲端硬碟（應用程式專用資料夾，只有這個 App 看得到，不會出現在一般檔案列表） */
const GDrive = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const FILE_NAME = 'health-tracker-backup.json';
  let tokenClient = null, token = null, tokenExpiry = 0, gisLoading = null;

  const clientId = () => (local.gdrive?.clientId || window.HEALTH_TRACKER_CONFIG?.googleClientId || '').trim();

  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    gisLoading = gisLoading || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      s.onerror = () => { gisLoading = null; reject(new Error('無法載入 Google 登入，請確認網路連線')); };
      document.head.appendChild(s);
    });
    return gisLoading;
  }

  async function getToken() {
    if (token && Date.now() < tokenExpiry - 60e3) return token;
    if (!clientId()) throw new Error('尚未設定 Google OAuth 用戶端 ID');
    await loadGis();
    return new Promise((resolve, reject) => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId(), scope: SCOPE,
        callback: (resp) => {
          if (resp.error) return reject(new Error(resp.error === 'access_denied' ? '已取消 Google 授權' : `Google 授權失敗（${resp.error}）`));
          token = resp.access_token;
          tokenExpiry = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          resolve(token);
        },
        error_callback: (err) => reject(new Error(err?.type === 'popup_closed' ? '已關閉 Google 登入視窗' : '無法開啟 Google 登入視窗（請允許彈出視窗）')),
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  async function api(url, opts = {}) {
    const t = await getToken();
    const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${t}`, ...(opts.headers || {}) } });
    if (res.status === 401) { token = null; throw new Error('Google 授權已過期，請再試一次'); }
    if (!res.ok) throw new Error(`Google 雲端硬碟錯誤（${res.status}）`);
    return res;
  }

  async function findBackup() {
    const q = encodeURIComponent(`name='${FILE_NAME}'`);
    const res = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,size)&orderBy=modifiedTime desc`);
    return (await res.json()).files?.[0] || null;
  }

  async function backup() {
    const existing = await findBackup();
    const boundary = 'ht' + Math.random().toString(36).slice(2);
    const meta = existing ? { name: FILE_NAME } : { name: FILE_NAME, parents: ['appDataFolder'] };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${backupPayload()}\r\n--${boundary}--`;
    const url = existing
      ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart&fields=id,modifiedTime`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime';
    const res = await api(url, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    return res.json();
  }

  async function restore() {
    const f = await findBackup();
    if (!f) return null;
    const res = await api(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
    return { data: await res.json(), modifiedTime: f.modifiedTime };
  }

  return { clientId, backup, restore, findBackup };
})();
