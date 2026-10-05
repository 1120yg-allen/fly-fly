# 健康紀錄同步伺服器

[健康紀錄 App](../health-tracker/README.md) 的選用雲端同步伺服器。單一檔案、**不需安裝任何套件**（Node.js 18 以上）。

伺服器只保存加密後的資料，不知道裡面的內容，也不知道帳號名稱：

- 每個同步帳號是一個「保險箱」，以帳號雜湊命名，存成 `data/<id>.json`
- 檔案內容：版本號、存取權杖的 SHA-256 雜湊、AES-GCM 密文
- 第一個上傳的裝置建立保險箱；之後必須使用相同的帳號與密碼才能讀寫

## 啟動

```bash
node server.js
# 健康紀錄同步伺服器已啟動：http://localhost:8787
```

伺服器同時會提供 `../health-tracker` 的 App 網頁，開啟 <http://localhost:8787> 即可使用，在設定中選「雲端同步」，伺服器網址會自動填好。

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `8787` | 監聽埠 |
| `HOST` | `0.0.0.0` | 監聽位址 |
| `DATA_DIR` | `./data` | 資料存放位置（請定期備份這個資料夾） |
| `STATIC_DIR` | `../health-tracker` | App 網頁位置；設為空字串則只提供 API |
| `MAX_BYTES` | `10485760` | 單一保險箱大小上限 |

## 部署到網路上（讓手機使用）

瀏覽器只在 **HTTPS** 或 localhost 下提供加密功能，所以對外必須使用 HTTPS。常見做法：

- **Caddy 反向代理**（自動申請憑證）：
  ```
  health.example.com {
      reverse_proxy localhost:8787
  }
  ```
- **家中電腦＋ Tailscale**：`tailscale serve --bg 8787`，家人的手機加入同一個 tailnet 即可使用
- 任何能跑 Node.js 的主機（VPS、Fly.io、Render 等），記得把 `DATA_DIR` 放在持久化的磁碟

## API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康檢查 |
| `GET` | `/api/vault/:id` | 取得 `{ version, iv, ct }`；不存在回 404 |
| `PUT` | `/api/vault/:id` | 上傳 `{ iv, ct }`，需帶 `If-Match: <目前版本>`（新建為 0）；版本不符回 409 |
| `DELETE` | `/api/vault/:id` | 刪除保險箱 |

所有保險箱操作都需要 `Authorization: Bearer <權杖>`。同一 IP 10 分鐘內驗證失敗 20 次會暫時封鎖（429）。
