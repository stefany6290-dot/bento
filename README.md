# 分開平台版使用方式

- **顧客：開啟 index.html**，只有線上點餐、推薦、小飯糰、購物車及訂單追蹤，不顯示店家入口。
- **商家：開啟 pos.html**，登入後使用現場點餐、今日訂單、接單收款、設定及營業分析，不顯示顧客導覽。
- 兩個檔案放在同一個網站資料夾，共用 config.js 與 Supabase 資料庫。顧客頁即使加上 #staff 也不會切成商家介面。真正的資料保護仍由 SQL 的店員權限檢查負責。
- 預設仍為本機展示。用 VS Code Live Server 或部署後，同一瀏覽器、同一網站來源的兩頁可共用展示訂單。file:// 本機開啟時，瀏覽器可能把兩個檔案的 localStorage 分開，展示時建議 Live Server。
- 跨裝置共用訂單，需要依下方步驟設定 Supabase。未替你上傳 GitHub，也未改動先前的展示網址。
- GitHub AI 使用步驟與可貼上的中文指令見 **GitHub_AI使用說明.md**。

---

# 丼物園：HTML＋CSS＋JavaScript＋Supabase

本版依確認的顧客端預覽製作，使用原生 HTML、CSS、JavaScript，不需要 React、TypeScript、npm 安裝或前端編譯。

## 先開起來看看

下載 ZIP 並解壓縮後，直接用 Chrome／Edge 開啟 `index.html`。若瀏覽器限制 file:// 的本機儲存，請用 VS Code 的 Live Server 開啟。

預設沒有 Supabase 連線，頁面頂端會顯示「本機展示模式」。展示訂單只保存在同一瀏覽器、同一網址來源，不會跨手機與電腦同步。**展示登入不是安全登入，只用於試操作。** 示範請用測試電話，不要填真實個資。

開啟獨立的 `pos.html`，點「進入本機展示工作台」即可試接單。真正雲端模式會改用 Email／密碼登入，不提供展示入口。程式不會在雲端連線失敗時偷偷改存本機。

## 包含功能

- 顧客端：餐點分類、搜尋、配菜選擇、定食不附配菜折價、購物車、電話與備註、到店付款。
- 幫你選餐：從未售完的主餐隨機推薦，盡量避開上一次的結果。可再選一次，或選定後開啟配菜視窗。售完商品與單點不列入推薦。
- 小飯糰：原創 SVG 角色、輕微擺動、定時切換預寫對話。也可點角色換句話，不使用付費 AI。尊重系統減少動態效果設定。
- 預約規則：一般時段可立即取餐或預約今日稍後時間。午餐預設 11:00–13:00、晚餐 17:00–19:00，每 15 分鐘預設最多 15 份，店家可調整。兩餐共用份數上限。
- 依「取餐時間」判斷尖峰。尖峰當下仍能線上下單，但須選可預約時段，無法用立即取餐繞過名額。13:00、19:00 不算尖峰。
- 未付款取消會釋出名額。已付款訂單暫不支援取消／退款。
- 預約僅今日，尚未設定營業起訖與休息日。店家可手動暫停線上接單。
- 店家端：現場點餐、今日全部訂單、狀態分頁、電話／取餐碼搜尋、來源篩選、接單、收款、取消原因、明細列印。
- 狀態：未接單、製作中、待取餐、已完成、已取消。線上單待店家接單才開始製作，現場單確認收款後直接進製作中。
- 顧客追蹤每 4 秒查詢。今日清單依台灣日期切換，歷史保留供分析，每日取餐號碼由 001 開始。
- 分析：今日／近七天／本月實收、平均客單、營業額走勢、餐點與配菜份數、主食材份數、最近 28 天同星期備餐平均、CSV 匯出。

這次依你指定的「隨機推薦＋小飯糰對話」版本完成，尚未加入另行討論的心理小測驗。

## 程式在哪裡？

下載 ZIP 的結構如下，線上展示的原始專案則把前端放在 `dist/`：

| 檔案 | 內容 |
| --- | --- |
| index.html | 網頁骨架與檔案引用 |
| style.css | 配色、玻璃質感、桌機與手機版排版 |
| config.js | 你的公開 Supabase 連線設定 |
| js/menu.js | 42 道菜單與配菜資料 |
| js/app.js | 畫面更新、購物車、角色與推薦、店家管理 |
| js/api.js | Supabase Auth／RPC 連線，及分開的本機展示資料邏輯 |
| assets/fonts | 可愛的粉圓字體 Huninn 及 OFL 授權 |
| supabase/setup.sql | PostgreSQL 資料表、菜單、權限與訂單函式 |

在 `js/app.js` 搜尋 `chats` 可以修改小飯糰的隨機句子。搜尋 `mascot` 可以看到 SVG 角色。菜單名稱、價格若改動，**也要同步修改資料庫 menu_items**，實際價格以資料庫驗證結果為準。

## 接上真正的 Supabase 資料庫

1. 在 https://supabase.com 建立自己的 Free 專案。
2. 在 SQL Editor 執行 `supabase/setup.sql` 全部內容，建議用新專案。它建立 `shop_orders`、`shop_settings`、`menu_items`、`staff_users` 與 `shop_api` 函式。
3. 在 Authentication 的 Users 建立已驗證 Email 的測試店員帳號。可透過管理介面的 auto-confirm 選項確認 Email。
4. 在 SQL Editor 執行以下 SQL，把 Email 換成剛建立的店員 Email：

```sql
insert into public.staff_users(user_id)
select id from auth.users where email='YOUR_STAFF_EMAIL'
on conflict do nothing;
```

5. 在專案 API 設定取得 Project URL 與 anon public key 或新的 publishable key，修改 `config.js`：

```javascript
window.BENTO_CONFIG = {
  supabaseUrl: "https://你的專案.supabase.co",
  supabaseKey: "你的公開anon或publishable金鑰",
  demoWhenUnconfigured: false
};
```

**絕對不要放 service_role、sb_secret_ 金鑰、資料庫密碼或店員密碼。** 上面兩個值會出現在瀏覽器，必須是公開連線資訊。

6. 以 HTTPS 網址開啟網站，用顧客手機送測試單，再以另一台裝置登入店家查看。雲端與展示資料不會互相搬移。先前 D1／React 版的訂單也不會自動匯入。
7. 可以在 Supabase 關閉公開註冊，顧客不需註冊，店員由管理員建立。

### SQL 函式如何保護資料

所有資料表啟用 RLS 並撤銷 anon/authenticated 直接表格存取。前端只呼叫 `shop_api`，函式檢查登入者是否在 `staff_users`。只有店員能列出全部訂單、處理訂單、開關接單與修改設定。

金額以資料庫菜單重算，不能信任瀏覽器送來的價格。建立訂單時鎖定設定列，讓同時送單依序檢查名額。requestId 防止同一請求重送產生重複訂單。匿名顧客憑隨機 UUID 追蹤連結看單筆狀態，回應不含電話。追蹤連結仍含餐點與備註，請勿公開。

## 放到 GitHub Pages

本版無需 GitHub Actions 編譯，也不用 npm。

1. 備份原儲存庫，將 ZIP 解壓縮後的「檔案內容」放進公開儲存庫根目錄，根目錄直接有 `index.html`。不要再包一層資料夾。
2. 若要跨裝置接單，先完成上面的 Supabase 設定。若維持空白 config，部署後仍只會是本機展示模式。
3. GitHub Settings → Pages → Build and deployment → Source 選 **Deploy from a branch**。
4. Branch 選 `main`，資料夾選 `/ (root)`，按 Save。
5. 如果儲存庫先前使用 React 版的 `.github/workflows/deploy.yml`，先停用或移除舊部署 workflow，避免覆蓋這份靜態版本。
6. 使用 Pages 顯示的網址。顧客入口是首頁，店家入口是同一資料夾下的 `pos.html`。

此方案適合課程展示。GitHub Pages 本身只能託管前端，Supabase 負責資料庫。免費方案有配額，Supabase 低活動專案可能暫停，不代表永久無限免費。GitHub Pages 不允許經營以商業交易為主的網站，未來正式營業請改用允許該用途的主機。

官方說明：https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits 、https://supabase.com/pricing

## 如何驗收

1. 顧客點「幫我選一份」與「再選一次」，小飯糰會回應新推薦。
2. 點「選這個」，挑選配菜並加入購物車；沒有選足配菜不能加入。
3. 選取餐時間，填測試電話，送出後顯示追蹤頁。
4. 店家看到今日未接單，依序操作接單、待取餐、收款、已領取。顧客追蹤應更新。
5. 測試尖峰上限：改每格 2 份，送出 2 份後不能再送同一時段。取消未付款訂單後恢復名額。一般時段仍可送超過 2 份。
6. 勾選一個主餐售完，顧客不得再選購或隨機推薦該餐點。
7. 用手機檢查頂端購物車抽屜。跨日後今日列表換日，歷史仍保留於分析。

已檢查 JavaScript 語法；實際操作過展示推薦、配菜、送單、接單、追蹤、收款、完成與分析，以及 390px 手機購物車。SQL 已在相容 PostgreSQL 引擎 PGlite 驗證權限、尖峰拒單、取消釋出與一般時段不受限。另以固定時間檢查展示模式的 13:00 邊界、跨日取餐號碼及歷史保留。

尚未連接你的實際 Supabase，尚未完成真實雲端跨裝置驗收，也未替你上傳到個人 GitHub。此 ZIP 是分開入口的新版本，尚未更新既有線上展示網址。

## 後續改善

目前線上預約限量未納入現場訂單的完整產能模型。等待時間只是待製作份數的粗估。備料參考尚未計入營業日、售完影響與食材重量。正式營運前還需要防濫用、送單頻率限制、電話驗證、退款與完整稽核。此版請用於課程測試。
