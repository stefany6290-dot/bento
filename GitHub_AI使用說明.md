# 在 GitHub 用中文請 AI 修改網站

可以使用 GitHub Copilot。請分清楚兩種能力：Copilot Chat 可以討論及產生建議，Copilot cloud agent 則能讀取儲存庫、修改程式並提出 Pull Request，讓你檢查後合併。

## 用 Issue 交代修改任務

1. 先將本 ZIP 內的檔案上傳到你的 GitHub 儲存庫根目錄，讓 AI 讀得到程式。不要只把 ZIP 檔放上去。
2. 到儲存庫 Issues → New issue。
3. 用中文填寫標題與需求，下方有範例。
4. 建立 Issue 後，在右側 Assignees 選 Copilot（需帳號方案與儲存庫已開放此功能）。
5. 等它完成修改並建立 Pull Request，查看 Files changed 與檢查結果。
6. 有問題可在該 Pull Request 留言 @copilot，提出具體修改要求。
7. 確認畫面與功能正常後才 Merge。若 GitHub Pages 設定為從 main 分支根目錄發布，合併後會觸發網站更新。

若你的儲存庫出現 Agents 分頁，也可在那裡輸入需求、選擇儲存庫與分支開始任務。介面與功能會依帳號權限和 GitHub 調整而不同。

## 中文任務範例

標題：調整顧客端小飯糰對話

需求：

> 請先閱讀 README.md 和 .github/copilot-instructions.md。此網站使用原生 HTML、CSS、JavaScript，資料庫使用 Supabase PostgreSQL。
>
> 請修改顧客端 js/app.js 的小飯糰對話，增加 10 句適合大學生的溫暖短句。點角色時換一句，連續兩次不要相同。保留目前隨機餐點推薦、配菜與購物車流程。
>
> 維持顧客入口 index.html 與店家入口 pos.html 分開，保留莫蘭迪配色與玻璃質感。不要加入 React、TypeScript 或付費 AI API，也不要修改 config.js 的連線資訊及 SQL 權限。
>
> 請說明修改哪些檔案，檢查 JavaScript 語法，並測試手機排版與角色點擊互動，完成後提出 Pull Request 供我檢查。

以上是你未來可交給 AI 的任務範例，不代表這次 ZIP 已完成「新增10句且連續不重複」的改動。

## 方案與學生資格

依 2026-11-05 查閱的 GitHub 官方說明，Copilot cloud agent 提供給符合條件的 Copilot 方案，文件標示付費方案可使用；Copilot Free 的聊天功能不能直接當成 cloud agent 權限。請先檢查你的帳號是否能在 Assignees 選到 Copilot。

你是大學生，可以先申請 GitHub Education 學生驗證，通過後依帳號頁面啟用提供的 Copilot Student 福利。學生驗證與 Copilot 啟用是兩個步驟，且是否包含某項 agent 功能應以帳號當時顯示為準，不要先假設要付費或已具備權限。

學生福利申請入口：https://github.com/settings/education/benefits

官方教學與限制：
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students
- https://docs.github.com/en/copilot/get-started/plans

## 網站與資料庫更新是兩回事

AI 合併前端程式後，GitHub Pages 可以發布新版前端。但如果 AI 改了 supabase/setup.sql，GitHub Pages 不會自動替你執行 SQL。請先檢查資料庫變更與備份，再到 Supabase 執行經確認的遷移，避免覆蓋或刪除訂單。

不要把密碼、service_role 或 sb_secret_ 金鑰貼進 Issue、聊天或程式。config.js 只放公開的 Project URL 與 anon/publishable key。
