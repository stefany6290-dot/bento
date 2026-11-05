// 只填公開的 Project URL 和 anon / publishable key。禁止填 service_role 或 secret key。
window.BENTO_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
  // 沒有設定資料庫時，使用同一瀏覽器的本機展示資料，不能當作跨裝置接單。
  demoWhenUnconfigured: true
};
