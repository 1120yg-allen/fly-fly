'use strict';

/* ---------- 資料層：多人、軟刪除、合併 ----------
 * 同步的資料（db）：profiles / entries / meds / doses，每筆紀錄都有 id 與 updatedAt（毫秒）。
 * 刪除時保留 { id, profileId, deleted: true, updatedAt } 的墓碑，讓刪除也能同步到其他裝置。
 * 只屬於這台裝置的設定（local）：目前成員、同步帳號金鑰、已通知過的提醒。
 */
const STORAGE_KEY = 'health-tracker:v2';
const LEGACY_KEY = 'health-tracker:v1';
const LOCAL_KEY = 'health-tracker:local';
const COLLECTIONS = ['profiles', 'entries', 'meds', 'doses'];
const AVATARS = ['🙂', '👩', '👨', '👵', '👴', '👧', '👦', '👶', '🐱', '🐶'];

const DEFAULT_PROFILE = { height: null, goalWeight: null, waterGoal: 2000 };

let db = emptyData();
let local = { currentProfileId: null, sync: null, notified: {} };
const changeListeners = [];

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

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      db = sanitize(JSON.parse(raw));
    } else {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const { profile, entries } = migrateLegacy(JSON.parse(legacy), uid());
        db = sanitize({ profiles: [profile], entries });
      }
    }
  } catch (e) {
    console.error('讀取資料失敗', e);
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) local = { ...local, ...JSON.parse(raw) };
  } catch (e) {
    console.error('讀取本機設定失敗', e);
  }
  ensureProfile();
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

/** 寫入 localStorage；changed=true 代表同步資料有變更（會觸發雲端同步） */
function persist(changed = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
  } catch (e) {
    console.error(e);
    if (typeof toast === 'function') toast('儲存失敗：瀏覽器儲存空間不可用');
    return false;
  }
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
  return persist() ? r : null;
}

function tombstone(coll, rec) {
  return { id: rec.id, profileId: rec.profileId, deleted: true, updatedAt: Date.now() };
}

function remove(coll, id) {
  const i = db[coll].findIndex((x) => x.id === id);
  if (i < 0) return;
  db[coll][i] = tombstone(coll, db[coll][i]);
  persist();
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
