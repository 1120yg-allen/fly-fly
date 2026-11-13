'use strict';

/* 網站設定（選填）
 * googleClientId：Google 雲端硬碟一鍵備份用的 OAuth 用戶端 ID。
 * 填在這裡，所有使用這個網站的人都不用在 App 裡自行設定。申請步驟見 README。
 * liffId：LINE MINI App（或 LIFF App）的 LIFF ID，例如 '1234567890-abcdefgh'。填了之後在 LINE 裡可以用好友選擇畫面分享。
 * feedbackUrl：「意見回饋」按鈕要開啟的網址（例如 Google 表單）；留空則開啟 GitHub 的問題回報頁。
 */
window.HEALTH_TRACKER_CONFIG = {
  googleClientId: '',
  liffId: '',
  feedbackUrl: '',
};
