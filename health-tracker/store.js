'use strict';

/* ---------- 資料層：多人、軟刪除、合併 ----------
 * 同步的資料（db）：profiles / entries / meds / doses，每筆紀錄都有 id 與 updatedAt（毫秒）。
 * 刪除時保留 { id, profileId, deleted: true, updatedAt } 的墓碑，讓刪除也能同步到其他裝置。
 * 只屬於這台裝置的設定（local）：目前成員、同步帳號金鑰、已通知過的提醒。
 *
 * 儲存位置：
 *   - db 存在 IndexedDB（容量通常是可用空間的一部分，遠大於 localStorage 的約 5 MB）
 *   - local 設定很小，存在 localStorage
 *   - 瀏覽器不支援 IndexedDB（例如部分無痕模式）時，退回 localStorage
 * 寫入會合併 250 毫秒內的連續修改，切到背景或關閉頁面時立即寫入。
 */
const STORAGE_KEY = 'health-tracker:v2';
const LEGACY_KEY = 'health-tracker:v1';
const LOCAL_KEY = 'health-tracker:local';
const PENDING_KEY = 'health-tracker:pending'; // 頁面關閉時尚未寫入 IndexedDB 的緊急副本
const COLLECTIONS = ['profiles', 'entries', 'meds', 'doses'];
const AVATARS = ['🙂', '👩', '👨', '👵', '👴', '👧', '👦', '👶', '🐱', '🐶'];

const DEFAULT_PROFILE = { height: null, goalWeight: null, waterGoal: 2000 };

let db = emptyData();
let local = { currentProfileId: null, sync: null, notified: {} };
const changeListeners = [];

/** 儲存狀態（設定頁會顯示） */
const storage = { backend: 'localStorage', persisted: null, lastSavedAt: null, error: null };
let onExternalChange = null; // 其他分頁修改資料後呼叫

/* ---------- IndexedDB ---------- */
const IDB_NAME = 'health-tracker';
const IDB_STORE = 'kv';
let idb = null;

function openIdb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const timer = setTimeout(() => reject(new Error('indexedDB timeout')), 4000);
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { clearTimeout(timer); return reject(e); }
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => {
      clearTimeout(timer);
      const conn = req.result;
      // 其他分頁升級或刪除資料庫、或系統回收連線時：關閉並在下次寫入前重新連線
      conn.onversionchange = () => { conn.close(); if (idb === conn) idb = null; };
      conn.onclose = () => { if (idb === conn) idb = null; };
      resolve(conn);
    };
    req.onerror = () => { clearTimeout(timer); reject(req.error); };
    req.onblocked = () => { clearTimeout(timer); reject(new Error('indexedDB blocked')); };
  });
}

let useIdb = false; // 這個瀏覽器能否使用 IndexedDB（連線暫時關閉時仍為 true）

async function ensureIdb() {
  if (!idb) idb = await openIdb();
  return idb;
}

/** 連線已關閉（InvalidStateError）時重新連線再試一次 */
async function withStore(mode, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      const conn = await ensureIdb();
      return await new Promise((resolve, reject) => {
        const tx = conn.transaction(IDB_STORE, mode);
        const result = fn(tx.objectStore(IDB_STORE));
        tx.oncomplete = () => resolve(result.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('寫入中斷'));
      });
    } catch (e) {
      if (attempt === 0 && e?.name === 'InvalidStateError') { idb = null; continue; }
      throw e;
    }
  }
}

const idbGet = (key) => withStore('readonly', (st) => st.get(key));
/** 寫入在建立交易的當下就會複製一份資料，之後再修改 db 不影響這次寫入 */
const idbPut = (key, value) => withStore('readwrite', (st) => st.put(value, key));

let writeTimer = null;
let writing = null;
let dirty = false;
// 尚未寫入 IndexedDB 的單筆修改（新增、編輯、刪除）。大量修改（匯入、同步、合併）時改用整份副本。
let journal = [];
let bulkSeq = 0;      // 每次大量修改 +1
let savedBulkSeq = 0; // 最近一次成功寫入時的 bulkSeq
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('health-tracker') : null;
const tabId = Math.random().toString(36).slice(2);

function scheduleWrite() {
  dirty = true;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushWrites, 100);
}

/** 立即把尚未寫入的修改存進 IndexedDB */
async function flushWrites() {
  clearTimeout(writeTimer);
  if (!useIdb) return;
  while (writing) await writing;
  if (!dirty) return;
  dirty = false;
  const jLen = journal.length;
  const seq = bulkSeq;
  writing = idbPut('db', db)
    .then(() => {
      journal.splice(0, jLen);
      savedBulkSeq = seq;
      storage.lastSavedAt = Date.now();
      storage.error = null;
      if (!dirty) { try { localStorage.removeItem(PENDING_KEY); } catch { /* 忽略 */ } }
      channel?.postMessage({ type: 'saved', from: tabId });
    })
    .catch((e) => {
      console.error('IndexedDB 寫入失敗', e);
      storage.error = e?.name === 'QuotaExceededError' ? '儲存空間不足' : '寫入失敗';
      dirty = true;
      // 至少嘗試存一份到 localStorage
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch { /* 空間也不夠 */ }
      if (typeof toast === 'function') toast(`儲存失敗：${storage.error}，請匯出備份`);
    })
    .finally(() => { writing = null; });
  return writing;
}

/**
 * 頁面關閉時，瀏覽器可能來不及完成 IndexedDB 寫入，
 * 先同步存一份到 localStorage（4 MB 以內），下次開啟時合併回來。
 */
function saveEmergencyCopy() {
  if (!dirty && !writing) return;
  try {
    if (bulkSeq === savedBulkSeq) {
      // 只有單筆修改：存修改過的紀錄即可，資料再多也很小
      localStorage.setItem(PENDING_KEY, JSON.stringify({ journal }));
    } else {
      const json = JSON.stringify(db);
      if (json.length < 4e6) localStorage.setItem(PENDING_KEY, json);
    }
  } catch { /* 空間不足時只能依賴 IndexedDB */ }
}

// 切到背景、關閉或重新整理前立即寫入
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { saveEmergencyCopy(); flushWrites(); }
});
window.addEventListener('pagehide', () => { saveEmergencyCopy(); flushWrites(); });

// 另一個分頁寫入後，把它的資料合併進來（以較新的為準），避免互相覆蓋
channel?.addEventListener('message', async (ev) => {
  if (ev.data?.type !== 'saved' || ev.data.from === tabId || !useIdb) return;
  try {
    const other = await idbGet('db');
    if (!other) return;
    const before = fingerprint(db);
    db = mergeData(db, sanitize(other));
    ensureProfile();
    if (fingerprint(db) !== fingerprint(sanitize(other))) scheduleWrite();
    if (fingerprint(db) !== before) onExternalChange?.();
  } catch (e) {
    console.warn(e);
  }
});

/** 請瀏覽器把這個網站的資料標為「長期保存」，空間不足時不要自動清除 */
async function requestPersistentStorage(ask = true) {
  if (!navigator.storage?.persisted) { storage.persisted = null; return null; }
  try {
    let ok = await navigator.storage.persisted();
    if (!ok && ask && navigator.storage.persist) ok = await navigator.storage.persist();
    storage.persisted = ok;
    return ok;
  } catch {
    return storage.persisted;
  }
}

async function storageEstimate() {
  try { return navigator.storage?.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
}

function emptyData() {
  return { version: 2, profiles: [], entries: [], meds: [], doses: [] };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const VALIDATORS = {
  profiles: (r) => typeof r.name === 'string',
  entries: (r) => typeof r.type === 'string' && typeof r.time === 'string' && !isNaN(new Date(r.time)) && isObj(r.values),
  meds: (r) => typeof r.name === 'string' && Array.isArray(r.times) && Array.isArray(r.days),
  doses: (r) => typeof r.medId === 'string' && /^\d{4}-\d\d-\d\d$/.test(r.date) && /^\d\d:\d\d$/.test(r.time),
};

function isValidRecord(coll, r) {
  if (!isObj(r) || typeof r.id !== 'string' || !r.id) return false;
  if (typeof r.updatedAt !== 'number') return false;
  if (r.deleted) return true;
  if (coll !== 'profiles' && typeof r.profileId !== 'string') return false;
  return VALIDATORS[coll](r);
}

function sanitize(data) {
  const out = emptyData();
  if (!isObj(data)) return out;
  for (const c of COLLECTIONS) {
    out[c] = Array.isArray(data[c]) ? data[c].filter((r) => isValidRecord(c, r)) : [];
  }
  return out;
}

/* 舊版（v1，單人）資料轉換 */
function migrateLegacy(old, profileId) {
  const t = Date.now();
  const profile = {
    id: profileId, name: '我', avatar: AVATARS[0],
    ...DEFAULT_PROFILE, ...(isObj(old.profile) ? old.profile : {}), updatedAt: t,
  };
  const entries = (Array.isArray(old.entries) ? old.entries : [])
    .filter((e) => isObj(e) && typeof e.id === 'string')
    .map((e) => ({ ...e, profileId, updatedAt: Date.parse(e.updatedAt || e.createdAt) || t }));
  return { profile, entries };
}

async function loadAll() {
  try {
    idb = await openIdb();
    useIdb = true;
    storage.backend = 'indexedDB';
  } catch (e) {
    console.warn('無法使用 IndexedDB，改用 localStorage', e);
    idb = null;
  }
  let fromIdb = null;
  if (useIdb) {
    try { fromIdb = await idbGet('db'); } catch (e) { console.error('讀取 IndexedDB 失敗', e); }
  }
  // localStorage 裡可能還有舊版資料（或 IndexedDB 寫入失敗時留下的備份）
  let fromLs = null;
  let rawLs = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    rawLs = raw;
    if (raw) {
      fromLs = sanitize(JSON.parse(raw));
    } else {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const { profile, entries } = migrateLegacy(JSON.parse(legacy), uid());
        fromLs = sanitize({ profiles: [profile], entries });
      }
    }
  } catch (e) {
    console.error('讀取資料失敗', e);
  }
  db = fromIdb ? sanitize(fromIdb) : emptyData();
  if (fromLs) {
    // 舊資料自己有成員時，捨棄 IndexedDB 裡從未使用過的自動建立成員，避免出現兩個「我」
    if (fromLs.profiles.some((p) => !p.deleted)) dropUnusedAutoProfiles();
    db = mergeData(db, fromLs);
  }
  let pending = null;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p.journal)) {
        const d = emptyData();
        for (const [coll, rec] of p.journal) if (COLLECTIONS.includes(coll)) d[coll].push(rec);
        pending = sanitize(d);
      } else {
        pending = sanitize(p);
      }
    }
  } catch { /* 損毀的副本直接忽略 */ }
  if (pending) db = mergeData(db, pending);
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) local = { ...local, ...JSON.parse(raw) };
  } catch (e) {
    console.error('讀取本機設定失敗', e);
  }
  ensureProfile();
  // 搬移完成：資料寫進 IndexedDB 成功後，才移除 localStorage 裡的舊副本
  if (useIdb && (fromLs || pending || !fromIdb)) {
    dirty = true;
    await flushWrites();
    // 只有在 localStorage 內容沒有被其他分頁（例如舊版 App）改動時才移除
    if (!dirty) {
      try {
        if (localStorage.getItem(STORAGE_KEY) === rawLs) localStorage.removeItem(STORAGE_KEY);
        if (fromLs && !rawLs) localStorage.removeItem(LEGACY_KEY);
      } catch { /* 忽略 */ }
    }
  }
}

function ensureProfile() {
  if (!live('profiles').length) {
    // auto：系統自動建立、尚未使用過的成員；加入雲端同步時會被捨棄，避免出現重複的「我」
    db.profiles.push({ id: uid(), name: '我', avatar: AVATARS[0], ...DEFAULT_PROFILE, auto: true, updatedAt: Date.now() });
  }
  if (!live('profiles').some((p) => p.id === local.currentProfileId)) {
    local.currentProfileId = live('profiles')[0].id;
  }
}

/**
 * 儲存資料；changed=true 代表同步資料有變更（會觸發雲端同步）。
 * records：這次修改的單筆紀錄 [[collection, record], …]；沒給代表大量修改。
 */
function persist(changed = true, records = null) {
  if (useIdb) {
    if (records) journal.push(...records); else bulkSeq++;
    scheduleWrite();
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      storage.lastSavedAt = Date.now();
    } catch (e) {
      console.error(e);
      storage.error = '儲存空間不足';
      if (typeof toast === 'function') toast('儲存失敗：瀏覽器儲存空間不足，請匯出備份');
      return false;
    }
  }
  persistLocal();
  if (changed) changeListeners.forEach((fn) => fn());
  return true;
}

function persistLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (e) { console.error(e); }
}

const live = (coll) => db[coll].filter((r) => !r.deleted);
const mine = (coll) => live(coll).filter((r) => r.profileId === local.currentProfileId);
const getById = (coll, id) => db[coll].find((r) => r.id === id && !r.deleted);

function upsert(coll, rec) {
  const r = { ...rec, updatedAt: Date.now() };
  const i = db[coll].findIndex((x) => x.id === r.id);
  if (i >= 0) db[coll][i] = r; else db[coll].push(r);
  return persist(true, [[coll, r]]) ? r : null;
}

function tombstone(coll, rec) {
  return { id: rec.id, profileId: rec.profileId, deleted: true, updatedAt: Date.now() };
}

function remove(coll, id) {
  const i = db[coll].findIndex((x) => x.id === id);
  if (i < 0) return;
  db[coll][i] = tombstone(coll, db[coll][i]);
  persist(true, [[coll, db[coll][i]]]);
}

/** 刪除成員以及他所有的紀錄 */
function removeProfile(id) {
  for (const c of COLLECTIONS) {
    db[c] = db[c].map((r) => ((c === 'profiles' ? r.id === id : r.profileId === id) && !r.deleted ? tombstone(c, r) : r));
  }
  ensureProfile();
  persist();
}

/** 移除從未使用過的自動建立成員（還沒同步過，直接刪除不留墓碑） */
function dropUnusedAutoProfiles() {
  const used = new Set(['entries', 'meds', 'doses'].flatMap((c) => db[c].map((r) => r.profileId)));
  db.profiles = db.profiles.filter((p) => !(p.auto && !used.has(p.id)));
}

function currentProfile() {
  return getById('profiles', local.currentProfileId);
}

/** 以 updatedAt 較新者為準合併兩份資料（相同時保留 a） */
function mergeData(a, b) {
  const out = emptyData();
  for (const c of COLLECTIONS) {
    const map = new Map(a[c].map((r) => [r.id, r]));
    for (const r of b[c]) {
      const cur = map.get(r.id);
      if (!cur || r.updatedAt > cur.updatedAt) map.set(r.id, r);
    }
    out[c] = [...map.values()];
  }
  return out;
}

/** 與順序無關的內容指紋，用來判斷是否需要上傳 */
function fingerprint(data) {
  return JSON.stringify(COLLECTIONS.map((c) => data[c].map((r) => `${r.id}:${r.updatedAt}`).sort()));
}

function onDataChange(fn) { changeListeners.push(fn); }
