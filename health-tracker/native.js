'use strict';

/* ---------- 手機 App（Capacitor）原生功能 ----------
 * 在 Android／iOS App 裡執行時：
 *   - 服藥與每月回顧提醒改用系統通知預先排程，App 完全關閉、手機重新開機後也會提醒
 *   - 匯出與備份檔案改用系統分享選單（WebView 不支援網頁下載）
 *   - iOS 可以直接讀取 Apple「健康」的資料（health-mobile/plugins/healthkit）
 * 在一般瀏覽器中，這裡的功能都不會啟用。
 */
const Native = (() => {
  const cap = window.Capacitor;
  const enabled = !!cap?.isNativePlatform?.();
  const platform = enabled ? cap.getPlatform?.() || 'android' : 'web';
  const plugin = (name) => (enabled ? cap.Plugins?.[name] || cap.registerPlugin?.(name) : null);
  const LN = plugin('LocalNotifications');
  const FS = plugin('Filesystem');
  const SH = plugin('Share');
  const HK = platform === 'ios' ? plugin('HealthKit') : null;
  const DOSE_ACTION = 'DOSE';

  // 通知 id 必須是正的 32 位元整數：用字串雜湊產生，同一個提醒每次都得到同一個 id
  const hashId = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 1) || 1;
  };

  async function init({ onTake, onOpen }) {
    if (!enabled || !LN) return;
    try {
      await LN.registerActionTypes({ types: [{ id: DOSE_ACTION, actions: [{ id: 'take', title: '✓ 已服用' }] }] });
      await LN.addListener('localNotificationActionPerformed', (ev) => {
        const x = ev.notification?.extra || {};
        if (x.doseId && ev.actionId === 'take') onTake(x.doseId);
        else if (x.doseId) onOpen('meds');
        else if (x.view) onOpen(x.view, x.profileId);
      });
    } catch (e) {
      console.warn('通知初始化失敗', e);
    }
  }

  /** 'granted' | 'denied' | 'default' | 'unsupported' */
  async function permission(ask = false) {
    if (!enabled || !LN) return 'unsupported';
    try {
      let p = (await LN.checkPermissions()).display;
      if (p !== 'granted' && ask) p = (await LN.requestPermissions()).display;
      return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default';
    } catch {
      return 'unsupported';
    }
  }

  let lastSignature = '';
  /**
   * 重新排程所有提醒。items：[{ key, at: Date, title, body, action?, extra? }]
   * 先取消這個 App 排過的通知，再全部重排，確保刪除藥物或已服用的時段不會再響。
   */
  async function schedule(items) {
    if (!enabled || !LN || (await permission(false)) !== 'granted') return false;
    const signature = JSON.stringify(items.map((i) => [i.key, +i.at, i.title, i.body]));
    if (signature === lastSignature) return true;
    const pending = (await LN.getPending()).notifications || [];
    const ours = pending.filter((n) => n.extra?.app === 'health-tracker');
    if (ours.length) await LN.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
    if (items.length) {
      await LN.schedule({
        notifications: items.map((i) => ({
          id: hashId(i.key),
          title: i.title,
          body: i.body,
          schedule: { at: i.at, allowWhileIdle: true },
          actionTypeId: i.action,
          smallIcon: 'ic_stat_health',
          iconColor: '#0f766e',
          extra: { app: 'health-tracker', ...(i.extra || {}) },
        })),
      });
    }
    lastSignature = signature;
    return true;
  }

  /** 把文字檔寫到 App 暫存區，再開啟系統分享選單（存到雲端硬碟、傳 LINE、寄 Email…） */
  async function shareFile(filename, content) {
    const { uri } = await FS.writeFile({ path: filename, data: content, directory: 'CACHE', encoding: 'utf8' });
    try {
      await SH.share({ title: filename, files: [uri], dialogTitle: '儲存或分享' });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(e?.message || '')) return 'cancelled';
      throw e;
    }
  }

  /** Apple 健康：先跳出授權畫面（只有第一次會問），再讀取最近 days 天的資料 */
  const healthKit = HK && {
    async available() {
      try { return (await HK.isAvailable()).value; } catch { return false; }
    },
    async read(days) {
      await HK.requestAuthorization();
      return HK.readData({ days });
    },
  };

  return { enabled, platform, init, permission, schedule, shareFile, healthKit };
})();
