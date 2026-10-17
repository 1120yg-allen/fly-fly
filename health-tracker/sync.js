'use strict';

/* ---------- 雲端同步（選用，端對端加密） ----------
 * 由「同步帳號 + 同步密碼」在裝置上以 PBKDF2 推導出：
 *   - AES-GCM 加密金鑰：資料在離開裝置前加密，伺服器只看得到密文
 *   - 存取權杖：伺服器只保存它的雜湊，用來確認是同一位使用者
 *   - 保險箱 ID：帳號的雜湊，伺服器看不到帳號名稱
 * 密碼本身不會被儲存或傳送；忘記密碼就無法解開雲端資料（本機資料不受影響）。
 */
const Sync = (() => {
  const PBKDF2_ITERATIONS = 310000;
  const te = new TextEncoder();
  const td = new TextDecoder();

  const status = { state: 'off', message: '', lastSyncAt: null };
  const statusListeners = [];
  let running = null;
  let again = false;
  let timer = null;

  function setStatus(state, message = '') {
    Object.assign(status, { state, message });
    if (state === 'idle') status.lastSyncAt = Date.now();
    statusListeners.forEach((fn) => fn(status));
  }

  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  function available() {
    return !!(window.crypto && crypto.subtle && window.fetch);
  }

  async function deriveCredentials(account, password) {
    const acct = account.trim().toLowerCase();
    const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('health-tracker|' + acct), iterations: PBKDF2_ITERATIONS },
      base, 512);
    const vaultId = toHex(await crypto.subtle.digest('SHA-256', te.encode('vault|' + acct)));
    return { vaultId, key: toB64(bits.slice(0, 32)), token: toHex(bits.slice(32)) };
  }

  const importKey = (b64) => crypto.subtle.importKey('raw', fromB64(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);

  async function encrypt(obj, keyB64) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(keyB64), te.encode(JSON.stringify(obj)));
    return { iv: toB64(iv), ct: toB64(ct) };
  }

  async function decrypt(blob, keyB64) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, await importKey(keyB64), fromB64(blob.ct));
    return JSON.parse(td.decode(pt));
  }

  class SyncError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  async function request(cfg, method, body, version) {
    const headers = { Authorization: `Bearer ${cfg.token}` };
    if (body) headers['Content-Type'] = 'application/json';
    if (version != null) headers['If-Match'] = String(version);
    let res;
    try {
      res = await fetch(`${cfg.server}/api/vault/${cfg.vaultId}`, { method, headers, body: body && JSON.stringify(body), cache: 'no-store' });
    } catch {
      throw new SyncError('無法連線到同步伺服器', 'offline');
    }
    if (res.status === 404 && method === 'GET') return null;
    if (res.status === 401) throw new SyncError('同步密碼錯誤', 'auth');
    if (res.status === 409) throw new SyncError('版本衝突', 'conflict');
    if (res.status === 429) throw new SyncError('嘗試次數過多，請稍後再試', 'rate');
    if (!res.ok) throw new SyncError(`伺服器錯誤（${res.status}）`, 'server');
    return res.json();
  }

  function normalizeServer(url) {
    const u = new URL(url.trim());
    if (!/^https?:$/.test(u.protocol)) throw new SyncError('伺服器網址需以 http:// 或 https:// 開頭');
    return u.origin + u.pathname.replace(/\/+$/, '');
  }

  /** 第一次連線：推導金鑰、確認密碼正確，然後把設定記在這台裝置上 */
  async function connect(server, account, password) {
    if (!available()) throw new SyncError('此瀏覽器不支援加密功能（需使用 https 或 localhost 開啟）');
    if (!account.trim() || password.length < 8) throw new SyncError('請輸入帳號，密碼至少 8 個字元');
    const cfg = { server: normalizeServer(server), account: account.trim(), ...(await deriveCredentials(account, password)) };
    const remote = await request(cfg, 'GET');
    if (remote) {
      try { await decrypt(remote, cfg.key); } catch { throw new SyncError('同步密碼錯誤', 'auth'); }
    }
    local.sync = cfg;
    persistLocal();
    return syncNow();
  }

  function disconnect() {
    local.sync = null;
    persistLocal();
    clearTimeout(timer);
    setStatus('off');
  }

  async function syncOnce(cfg) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remoteBlob = await request(cfg, 'GET');
      const remoteVersion = remoteBlob ? remoteBlob.version : 0;
      let remote = null;
      if (remoteBlob) {
        try { remote = sanitize(await decrypt(remoteBlob, cfg.key)); } catch { throw new SyncError('無法解密雲端資料（密碼可能已在其他裝置變更）', 'auth'); }
      }
      if (remote && remote.profiles.some((p) => !p.deleted)) dropUnusedAutoProfiles();
      // 本機資料可能在等待網路時被修改，所以每次都從最新的 db 合併
      const merged = remote ? mergeData(db, remote) : db;
      if (!remote || fingerprint(merged) !== fingerprint(remote)) {
        try {
          await request(cfg, 'PUT', await encrypt(merged, cfg.key), remoteVersion);
        } catch (e) {
          if (e.code === 'conflict') continue; // 其他裝置剛好也在上傳：重新下載再合併
          throw e;
        }
      }
      const changedLocally = fingerprint(merged) !== fingerprint(db);
      db = mergeData(db, merged);
      ensureProfile();
      persist(false);
      return changedLocally;
    }
    throw new SyncError('同步衝突次數過多，請稍後再試', 'conflict');
  }

  /** 立即同步；回傳是否有從雲端拿到新資料 */
  async function syncNow() {
    const cfg = local.sync;
    if (!cfg) { setStatus('off'); return false; }
    if (running) { again = true; return running; }
    setStatus('syncing');
    running = (async () => {
      try {
        const changed = await syncOnce(cfg);
        setStatus('idle');
        return changed;
      } catch (e) {
        setStatus(e.code === 'offline' ? 'offline' : 'error', e.message);
        throw e;
      } finally {
        running = null;
        if (again) { again = false; schedule(500); }
      }
    })();
    return running;
  }

  /** 資料變更後延遲同步，合併連續的修改 */
  function schedule(delay = 2000) {
    if (!local.sync) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow().then((changed) => changed && Sync.onRemoteChange?.()).catch(() => {}), delay);
  }

  return {
    status, available, connect, disconnect, syncNow, schedule,
    onStatus: (fn) => statusListeners.push(fn),
    onRemoteChange: null,
    get enabled() { return !!local.sync; },
  };
})();
