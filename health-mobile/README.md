# 健康紀錄 Android／iPhone 版

把 [`../health-tracker`](../health-tracker/README.md) 的網頁 App 用 [Capacitor](https://capacitorjs.com/) 包成 Android 與 iOS App。功能與網頁版相同，另外：

| | 網頁版（PWA） | Android App | iPhone App |
| --- | --- | --- | --- |
| 資料保存 | 瀏覽器（IndexedDB），清除網站資料會刪除 | App 內部資料庫，不會被自動清除；隨 Android 系統備份一起備份 | App 內部資料庫；請定期用「備份到 iCloud」存備份檔 |
| 服藥／每月回顧提醒 | App 開著或在背景時才會跳通知 | **系統通知預先排程**，App 關閉、手機重開機後也會提醒，可在通知上直接按「已服用」 | 同 Android（iOS 最多預排 64 個通知，App 每次打開時會自動補上） |
| Apple 健康 | 匯入 `export.zip` | — | **直接讀取**（步數、睡眠、運動、靜止心率、體重、血壓、血糖、體溫、飲水），只讀不寫 |
| 匯出、備份檔案 | 下載或分享 | 系統分享選單 | 系統分享選單（可存到 iCloud 雲端硬碟） |
| Google 雲端硬碟一鍵備份 | 可用（需 OAuth 用戶端 ID） | 不支援（Google 不允許在 App 內嵌網頁登入），改用分享選單 | 同左 |

## 安裝到 Android 手機

1. 用 Android 手機打開 <https://github.com/1120yg-allen/fly-fly/releases/tag/android-latest>
2. 點 `health-tracker-<版本>.apk` 下載
3. 開啟下載的檔案；第一次會要求允許「安裝不明應用程式」，在設定中允許你的瀏覽器或「檔案」App 即可
4. 安裝完成後打開「健康紀錄」，到「服藥」頁按「開啟通知」

> 這個 APK 沒有經過 Google Play 審查，安裝時 Play 安全防護可能顯示警告，選「仍要安裝」即可。

### 更新
有新版時重複上面的步驟，安裝時會直接覆蓋舊版，**資料會保留**。

### 從網頁版搬資料到 App
網頁版和 App 的資料是分開的：在網頁版「設定 → 雲端備份 → 備份到 iCloud／雲端硬碟」存一份備份檔，再到 App 的「設定 → 從備份檔還原」選擇那個檔案。

## 安裝到 iPhone

Apple 只允許從 App Store／TestFlight 或「用 Apple ID 簽章」的方式安裝 App。這裡提供兩種方式：

### 方式一：免費，用 Sideloadly 自行簽章（需要一台 Windows 或 Mac 電腦）

1. 在電腦安裝 [Sideloadly](https://sideloadly.io/)（Windows 另需安裝 Apple 官網版的 iTunes 與 iCloud）
2. 下載 <https://github.com/1120yg-allen/fly-fly/releases/tag/ios-latest> 的 `health-tracker-ios-<版本>.ipa`
3. iPhone 用傳輸線接上電腦，在 Sideloadly 選擇該 .ipa、輸入你的 Apple ID，按 Start
4. iPhone 到「設定 → 一般 → VPN 與裝置管理」信任你的 Apple ID；iOS 16 以上還要到「設定 → 隱私權與安全性 → 開發者模式」開啟
5. 打開「健康紀錄」→「設定 → 匯入 Apple 與 Google 健康資料 →  從 Apple 健康讀取」，在授權畫面開啟要分享的項目

⚠️ 免費 Apple ID 簽章的 App **每 7 天會過期**，到期前用 Sideloadly 再裝一次即可（覆蓋安裝，資料會保留；Sideloadly 也可設定自動續簽）。若「從 Apple 健康讀取」出現錯誤，表示簽章時沒有帶入 HealthKit 權限，可改用網頁版的「匯入 export.zip」。

### 方式二：Apple 開發者帳號（每年 US$99），用 TestFlight 安裝

不會 7 天過期，家人也能直接從 TestFlight 安裝。需要在 Mac 上用 Xcode 開啟專案（`npm run ios`），在 Signing & Capabilities 選擇你的 Team（HealthKit 權限已設定好），再 Product → Archive 上傳到 App Store Connect。之後若要改成由 GitHub Actions 自動上傳 TestFlight，可以再設定簽章憑證到 Secrets。

## 自動編譯

- `.github/workflows/android.yml`：`health-tracker/` 或 `health-mobile/` 有變更時，在 GitHub Actions 上編譯 APK，發佈到 Releases 的 `android-latest`
- `.github/workflows/ios.yml`：在 macOS 上編譯 iPhone 版，把未簽章的 .ipa 發佈到 Releases 的 `ios-latest`

也可以在 GitHub 的 Actions 頁面手動執行。

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

Android 需要 Node.js 22、JDK 21 與 Android SDK（或 Android Studio）；iOS 需要 Mac 與 Xcode：

```bash
cd health-mobile
npm install
npm run sync            # 複製 ../health-tracker 並同步到 android/
npx cap open android    # 用 Android Studio 開啟，可直接在手機或模擬器上執行
npm run apk             # 或直接編譯 APK：android/app/build/outputs/apk/release/
npm run ios             # 同步到 ios/ 並用 Xcode 開啟
```

Apple 健康的讀取在本專案自帶的外掛 `plugins/healthkit/`（Swift，只讀取、不寫入），JS 端在 `health-tracker/native.js` 與 `integrations.js` 的 `healthKitToImport`。

修改網頁功能時只要改 `health-tracker/`，再執行 `npm run sync` 即可；原生功能的橋接在 `health-tracker/native.js`。
