# 健康紀錄 Android 版

把 [`../health-tracker`](../health-tracker/README.md) 的網頁 App 用 [Capacitor](https://capacitorjs.com/) 包成 Android App。功能與網頁版相同，另外：

| | 網頁版（PWA） | Android App |
| --- | --- | --- |
| 資料保存 | 瀏覽器（IndexedDB），清除網站資料會刪除 | App 內部資料庫，不會被自動清除；隨 Android 系統備份（Google 帳號）一起備份 |
| 服藥／每月回顧提醒 | App 開著或在背景時才會跳通知 | **系統通知預先排程**，App 關閉、手機重開機後也會提醒，可在通知上直接按「已服用」 |
| 匯出、備份檔案 | 下載或分享 | 系統分享選單（存到雲端硬碟、檔案、LINE、Email…） |
| Google 雲端硬碟一鍵備份 | 可用（需 OAuth 用戶端 ID） | 不支援（Google 不允許在 App 內嵌網頁登入），改用分享選單存到雲端硬碟 |

## 安裝到手機

1. 用 Android 手機打開 <https://github.com/1120yg-allen/fly-fly/releases/tag/android-latest>
2. 點 `health-tracker-<版本>.apk` 下載
3. 開啟下載的檔案；第一次會要求允許「安裝不明應用程式」，在設定中允許你的瀏覽器或「檔案」App 即可
4. 安裝完成後打開「健康紀錄」，到「服藥」頁按「開啟通知」

> 這個 APK 沒有經過 Google Play 審查，安裝時 Play 安全防護可能顯示警告，選「仍要安裝」即可。

### 更新
有新版時重複上面的步驟，安裝時會直接覆蓋舊版，**資料會保留**。

### 從網頁版搬資料到 App
網頁版和 App 的資料是分開的：在網頁版「設定 → 雲端備份 → 備份到 iCloud／雲端硬碟」存一份備份檔，再到 App 的「設定 → 從備份檔還原」選擇那個檔案。

## 自動編譯

`.github/workflows/android.yml` 會在 `health-tracker/` 或 `health-android/` 有變更時，在 GitHub Actions 上編譯 APK，並發佈到 Releases 的 `android-latest`（也會上傳到該次 Actions 執行的 Artifacts）。也可以在 GitHub 的 Actions 頁面手動執行「Android APK」。

## 簽章金鑰

Android 只允許**同一把金鑰簽章**的新版覆蓋安裝。為了讓每次自動編譯的 APK 都能直接更新，repo 裡放了一把共用測試金鑰 `android/app/shared-dev.keystore`（密碼 `healthtracker`）。

⚠️ 這把金鑰是公開的，任何人都能用它簽出「看起來是同一個 App」的 APK。家人自用沒有問題，但**只從本 repo 的 Releases 下載安裝**。若要正式使用或上架 Google Play，請換成你自己的私人金鑰：

1. 產生金鑰（只做一次，請妥善保存，遺失後就無法更新 App）：
   ```bash
   keytool -genkeypair -v -keystore release.keystore -alias health -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 release.keystore > release.keystore.b64
   ```
2. 到 GitHub repo 的 **Settings → Secrets and variables → Actions** 新增：
   - `ANDROID_KEYSTORE_BASE64`：`release.keystore.b64` 的內容
   - `ANDROID_KEYSTORE_PASSWORD`：金鑰庫密碼
   - `ANDROID_KEY_ALIAS`：`health`
   - `ANDROID_KEY_PASSWORD`：金鑰密碼
3. 之後的編譯會改用你的金鑰。換金鑰後第一次更新需要**先備份、解除安裝舊版、再安裝新版並還原**

## 本機開發

需要 Node.js 22、JDK 21 與 Android SDK（或 Android Studio）：

```bash
cd health-android
npm install
npm run sync            # 複製 ../health-tracker 並同步到 android/
npx cap open android    # 用 Android Studio 開啟，可直接在手機或模擬器上執行
npm run apk             # 或直接編譯 APK：android/app/build/outputs/apk/release/
```

修改網頁功能時只要改 `health-tracker/`，再執行 `npm run sync` 即可；原生功能的橋接在 `health-tracker/native.js`。
