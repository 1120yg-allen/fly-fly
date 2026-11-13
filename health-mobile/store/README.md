# App Store 上架資料

這裡整理了送審時在 App Store Connect 要填的內容，可以直接複製貼上。截圖在 [`screenshots/`](screenshots/)（1320 × 2868，iPhone 6.9 吋）。

## 基本資料

| 欄位 | 內容 |
| --- | --- |
| Bundle ID | `com.flyfly.healthtracker`（註冊時勾選 HealthKit） |
| 名稱（最多 30 字，全球不能重複） | 健康紀錄（已被使用時的備案：`健康紀錄－血壓血糖服藥`、`安心健康紀錄`） |
| 副標題（最多 30 字） | 血壓、血糖、服藥提醒與檢驗報告 |
| 主要語言 | 繁體中文 |
| 類別 | 主要：健康與健身　次要：醫療 |
| 價格 | 免費 |
| 年齡分級 | 問卷中「醫療／治療資訊」選「偶爾／輕微」，其餘皆「無」 |
| 隱私權政策網址 | <https://1120yg-allen.github.io/fly-fly/health-tracker/privacy.html> |
| 支援網址 | <https://1120yg-allen.github.io/fly-fly/health-tracker/support.html> |
| 版權 | `2026 <你的姓名>` |

## 宣傳文字（最多 170 字）

```
資料只存在你的手機，不用註冊、沒有廣告。記錄血壓、血糖、體重、睡眠與運動，準時提醒吃藥，拍下檢驗報告自動整理數值。
```

## 描述

```
健康紀錄是一個簡單、注重隱私的個人健康紀錄工具，適合自己使用，也可以幫家人一起記錄。

【每日紀錄】
・血壓、血糖、體重、心率、體溫、睡眠、運動、飲水、步數、心情
・趨勢圖表，一眼看出變化
・可從 Apple「健康」讀取步數、睡眠、運動、靜止心率、體重、血壓、血糖、體溫與飲水（只讀取，不寫入）

【服藥提醒】
・設定藥物與服用時間，時間到以通知提醒
・在通知上直接按「已服用」
・查看每天的服藥狀況

【檢驗報告】
・拍下健檢或抽血報告，自動辨識數值（在手機上辨識，照片不會上傳）
・對照參考值，標示偏高或偏低的項目
・點一下項目即可查看臨床意義

【每月健康回顧】
・依你的紀錄整理飲食、睡眠、運動方面的一般性建議
・建議內容參考台灣國民健康署與美國公開健康指引，並附上來源

【多人使用】
・可建立多位家庭成員，分開記錄

【隱私】
・不需要註冊帳號，沒有廣告與追蹤
・資料只保存在你的手機上
・可匯出備份檔，換手機時還原

【重要聲明】
本 App 是個人健康紀錄工具，不是醫療器材。數值判讀、檢驗項目說明與健康建議皆為一般性衛教資訊，僅供參考，不能用來診斷或治療疾病，也不能取代醫師的專業意見。在做任何醫療決定之前，請先諮詢醫師。
```

## 關鍵字（最多 100 字元，以半形逗號分隔）

```
血壓,血糖,體重,服藥提醒,吃藥,檢驗報告,健檢,健康日記,睡眠,運動,飲水,家人,慢性病,紀錄
```

## App 隱私（App Privacy 問卷）

- 「你或第三方合作夥伴是否從這個 App 收集資料？」→ **否，我們不會從這個 App 收集資料**
  （資料只存在使用者的裝置；App 沒有開發者的伺服器、分析或廣告工具。）

## 出口合規

- 「App 是否使用加密？」→ App 只使用 Apple 系統內建的標準加密，屬於豁免範圍。`Info.plist` 已設定 `ITSAppUsesNonExemptEncryption = false`，上傳後不會再詢問。

## 給審核人員的備註（App Review Information → Notes）

```
Health Tracker (健康紀錄) is a personal health journal. No account or login is required; all features are available immediately after launch.

HealthKit usage:
- The app only READS HealthKit data (steps, sleep, exercise time, resting heart rate, body mass, blood pressure, blood glucose, body temperature, dietary water). It never writes to HealthKit.
- To test: tap the gear icon (top right) → section "匯入 Apple 與 Google 健康資料" → button "從 Apple 健康讀取". The system permission sheet appears; after approval a preview is shown and the user confirms the import.
- Imported data is stored only on the device, is not sent to any server, is not used for advertising, and is not stored in iCloud.

Data storage: all data is stored locally on the device. The app has no backend. "匯出備份檔" creates a file and hands it to the iOS share sheet; the user chooses where to save it.

Optional sync: Settings contains an optional, off-by-default end-to-end encrypted sync that requires the user to enter the address of their own self-hosted server. No server is provided by the developer and the feature is not needed for review.

Medical disclaimer: the app is not a medical device and does not diagnose or treat. Reference ranges and lifestyle guidance are general educational information with cited sources (Taiwan Health Promotion Administration and US public guidelines), and a disclaimer is shown in Settings → 關於, on the lab screens and on the advice screen.

Notifications are local only (medication reminders scheduled on device).
The lab-report photo feature performs OCR on-device; photos are not uploaded.
```

## 自動上傳 TestFlight（GitHub Actions）

到 GitHub repo 的 **Settings → Secrets and variables → Actions** 新增下列 4 個 Secrets 後，`.github/workflows/ios.yml` 每次執行都會自動簽章並上傳到 TestFlight：

| Secret 名稱 | 內容 | 在哪裡找 |
| --- | --- | --- |
| `APPLE_TEAM_ID` | 10 碼的 Team ID | developer.apple.com → Account → Membership details |
| `ASC_ISSUER_ID` | Issuer ID | App Store Connect → 使用者與存取 → 整合 → App Store Connect API |
| `ASC_KEY_ID` | 金鑰 ID | 同上，建立金鑰後顯示 |
| `ASC_KEY_P8` | 下載的 `AuthKey_XXXX.p8` 檔案全文（含 BEGIN／END 兩行） | 建立金鑰時下載（只能下載一次） |

建立 API 金鑰時，存取權限請選 **Admin**（自動簽章需要建立憑證的權限）。金鑰請只放在 GitHub Secrets，不要貼到對話、Issue 或程式碼裡。

> 這段上傳流程需要開發者帳號才能執行，尚未實際測試過；第一次執行若失敗，把 Actions 的錯誤訊息給我就能修正。

## 送審前檢查

- [ ] 用 TestFlight 在真的 iPhone 上測試：新增紀錄、服藥通知、拍照辨識、從 Apple 健康讀取、匯出與還原備份
- [ ] App Store Connect 的 App 隱私、年齡分級、類別、價格都已填寫
- [ ] 上傳 `screenshots/` 的截圖（6.9 吋；其他尺寸 Apple 會自動縮放）
- [ ] 貼上描述、關鍵字、審核備註
- [ ] 選擇建置版本後按「提交以供審核」
