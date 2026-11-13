'use strict';

/* ---------- LINE（LINE MINI App／LINE 內建瀏覽器）----------
 * 在 LINE 裡開啟時：
 *   - 有設定 liffId 時載入 LIFF SDK，「分享給朋友」會開啟 LINE 的好友選擇畫面
 *   - LINE 內建瀏覽器不能下載檔案、也沒有網頁通知：檔案改交給手機的預設瀏覽器下載（handoff.html）
 * 不在 LINE 裡時，這裡的功能都不會啟用。
 */
const Line = (() => {
  const cfg = window.HEALTH_TRACKER_CONFIG || {};
  const inClient = /\bLine\//i.test(navigator.userAgent);
  const base = new URL('.', location.href).href;
  let ready = Promise.resolve(false);

  function init() {
    if (!inClient || !cfg.liffId) return ready;
    ready = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
      s.onload = () => window.liff.init({ liffId: cfg.liffId }).then(() => resolve(true), (e) => { console.warn('LIFF 初始化失敗', e); resolve(false); });
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return ready;
  }

  /** 給別人打開用的網址：有 MINI App 時用 LINE 的連結，否則用網頁網址 */
  const appUrl = () => (cfg.liffId ? `https://miniapp.line.me/${cfg.liffId}` : base);

  /** 'shared' | 'copied' | 'cancelled' */
  async function share() {
    const text = `健康紀錄：記錄血壓、血糖、體重、睡眠、運動與檢驗報告，資料只存在自己的手機。\n${appUrl()}`;
    if (await ready && window.liff.isApiAvailable?.('shareTargetPicker')) {
      const res = await window.liff.shareTargetPicker([{ type: 'text', text }]).catch(() => null);
      return res ? 'shared' : 'cancelled';
    }
    if (navigator.share) {
      try { await navigator.share({ text }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
    }
    await navigator.clipboard.writeText(text);
    return 'copied';
  }

  /** 交給預設瀏覽器下載的資料放在網址的 # 後面（不會傳到伺服器），太大的檔案放不下 */
  const HANDOFF_LIMIT = 150e3;
  const canSaveFile = (content) => content.length * 3 < HANDOFF_LIMIT * 2;

  /** 用手機的預設瀏覽器開啟 handoff.html，由它下載檔案（openExternalBrowser=1 是 LINE 提供的參數） */
  function saveFile(filename, content, mime) {
    const bytes = new TextEncoder().encode(content);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const hash = new URLSearchParams({ name: filename, mime, data: btoa(bin) });
    location.href = `${base}handoff.html?openExternalBrowser=1#${hash}`;
  }

  return { inClient, init, share, appUrl, canSaveFile, saveFile };
})();
