/* 資料層：Supabase 連線與本機展示分開處理。顧客不需登入，店員使用 Auth。 */
(() => {
  const config = window.BENTO_CONFIG || {};
  const base = (config.supabaseUrl || '').replace(/\/$/, '');
  const key = config.supabaseKey || '';
  const configured = !!base && !!key;
  const demo = !configured && config.demoWhenUnconfigured === true;
  const defaults = {capacity:15,minutes:3,soldOut:[],lunchStart:'11:00',lunchEnd:'13:00',dinnerStart:'17:00',dinnerEnd:'19:00'};
  const dateKey = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const localTime = () => new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  const sessionKey='donburi-vanilla-session';
  const storeKey='donburi-vanilla-demo-v1';
  let refreshing;
  function session(){try{return JSON.parse(sessionStorage.getItem(sessionKey)||'null')}catch{return null}}
  function saveSession(value){sessionStorage.setItem(sessionKey,JSON.stringify(value))}
  async function auth(path,body){const r=await fetch(base+'/auth/v1/'+path,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.msg||d.error_description||d.message||'登入失敗');saveSession({...d,expires_at:Date.now()/1000+d.expires_in});return session()}
  function demoStore(){try{return JSON.parse(localStorage.getItem(storeKey))||{config:{...defaults},paused:false,orders:[]}}catch{throw Error('瀏覽器無法保存展示資料，請允許本機儲存或改用一般瀏覽模式。')}}
  function peakAt(time,c){return time>=c.lunchStart&&time<c.lunchEnd||time>=c.dinnerStart&&time<c.dinnerEnd}
  function slotsFor(s){const slots=[];const day=dateKey();if(!peakAt(localTime(),s.config))slots.push({time:'asap',remaining:null});for(let n=0;n<96;n++){const hh=String(Math.floor(n/4)).padStart(2,'0'),mm=String(n%4*15).padStart(2,'0');const time=`${day}T${hh}:${mm}:00+08:00`;if(Date.parse(time)<=Date.now())continue;const used=s.orders.filter(o=>o.day===day&&o.status!=='cancelled'&&o.source==='online'&&o.slot===time).reduce((a,o)=>a+o.items.reduce((b,i)=>b+i.qty,0),0);slots.push({time,remaining:peakAt(`${hh}:${mm}`,s.config)?Math.max(0,s.config.capacity-used):null})}return slots}
  function demoCall(b){const s=demoStore();let response={ok:true};const staff=!!session()?.demo;
    if(b.action==='read'){
      const queue=s.orders.filter(o=>o.day===dateKey()&&['pending','preparing'].includes(o.status)&&(!o.slot||Date.parse(o.slot)<=Date.now())).reduce((a,o)=>a+o.items.reduce((n,i)=>n+i.qty,0),0);
      const data={config:s.config,paused:s.paused,slots:slotsFor(s),wait:Math.max(5,queue*s.config.minutes)};
      if(b.track){const o=s.orders.find(o=>o.id===b.track);data.order=o?{...o,phone:undefined}:null}
      if(b.staff){if(!staff)throw Error('請先登入店家工作台');data.orders=s.orders}
      return data;
    }
    if(['service','pause','update'].includes(b.action)&&!staff)throw Error('需要店家權限');
    if(b.action==='service'){
      if(!Number.isInteger(b.capacity)||b.capacity<1||b.capacity>100||!Number.isInteger(b.minutes)||b.minutes<1||b.minutes>30)throw Error('份數需 1–100，每份分鐘需 1–30');
      if(![b.lunchStart,b.lunchEnd,b.dinnerStart,b.dinnerEnd].every(t=>/^([01]\d|2[0-3]):(00|15|30|45)$/.test(t))||!(b.lunchStart<b.lunchEnd&&b.lunchEnd<=b.dinnerStart&&b.dinnerStart<b.dinnerEnd))throw Error('午晚尖峰時間需依序排列，並使用15分鐘間隔');
      s.config={capacity:b.capacity,minutes:b.minutes,soldOut:b.soldOut,lunchStart:b.lunchStart,lunchEnd:b.lunchEnd,dinnerStart:b.dinnerStart,dinnerEnd:b.dinnerEnd};
    }else if(b.action==='pause')s.paused=!!b.value;
    else if(b.action==='update'){
      const o=s.orders.find(o=>o.id===b.id);if(!o)throw Error('找不到訂單');const next=b.status||o.status;
      const allowed={pending:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['completed','cancelled'],completed:[],cancelled:[]};
      if(['completed','cancelled'].includes(o.status)||next!==o.status&&!allowed[o.status].includes(next))throw Error('狀態已變更，請重新整理');
      if(next==='cancelled'){if(o.paid||b.paid)throw Error('已付款訂單暫不支援退款');if(!b.reason?.trim())throw Error('請填寫取消原因');o.cancelReason=b.reason.trim().slice(0,200)}
      if(next==='completed'&&!o.paid&&!b.paid)throw Error('請先確認收款');o.status=next;if(b.paid)o.paid=1;
    }else if(b.action==='create'){
      if(s.orders.some(o=>o.id===b.requestId))return {id:b.requestId};
      const onsite=b.source==='onsite';if(onsite&&!staff)throw Error('現場點餐需要店家登入');if(!onsite&&s.paused)throw Error('目前暫停線上接單');
      const phone=String(b.phone||'').replace(/[\s()-]/g,'');if(!onsite&&!/^0\d{8,9}$/.test(phone))throw Error('請輸入有效的聯絡電話');
      if(!Array.isArray(b.items)||!b.items.length||b.items.length>20)throw Error('請選擇 1–20 筆餐點');
      const items=b.items.map(i=>{const m=BentoMenu.menu.find(m=>m.id===i.id);if(!m||s.config.soldOut.includes(i.id))throw Error('有餐點已售完，請調整購物車');if(!Number.isInteger(i.qty)||i.qty<1||i.qty>99)throw Error('餐點數量錯誤');const noSides=!!i.noSides&&m.category==='定食';const needed=m.category==='單點'||noSides?0:[11,19].includes(m.id)?2:3;const sides=noSides?[]:i.sides;if(!Array.isArray(sides)||sides.length!==needed||new Set(sides).size!==needed||!sides.every(v=>BentoMenu.sides.includes(v)))throw Error('配菜數量錯誤');return {...m,price:m.price-(noSides?20:0),qty:i.qty,sides,noSides}});
      const amount=items.reduce((n,i)=>n+i.qty,0);if(amount>99)throw Error('單筆最多99份');
      if(!onsite){const slot=slotsFor(s).find(x=>x.time===b.slot);if(!slot)throw Error('請重新選擇有效取餐時間');if(slot.remaining!==null&&slot.remaining<amount)throw Error('此尖峰時段名額不足，請選其他時段')}
      const o={id:b.requestId,day:dateKey(),created:new Date().toISOString(),seq:s.orders.length+1,pickup:Math.max(0,...s.orders.filter(o=>o.day===dateKey()).map(o=>o.pickup))+1,status:onsite?'preparing':'pending',paid:onsite?1:0,source:onsite?'onsite':'online',items,total:items.reduce((n,i)=>n+i.price*i.qty,0),slot:onsite||b.slot==='asap'?null:b.slot,phone,note:String(b.note||'').slice(0,300)};s.orders.push(o);response={id:o.id};
    }else throw Error('無效操作');
    localStorage.setItem(storeKey,JSON.stringify(s));return response;
  }
  async function rpc(b){if(demo)return demoCall(b);if(!configured)throw Error('尚未設定 Supabase，請參考 README');let s=session();if(s?.expires_at<Date.now()/1000+60){refreshing ||= auth('token?grant_type=refresh_token',{refresh_token:s.refresh_token}).finally(()=>refreshing=null);try{s=await refreshing}catch{sessionStorage.removeItem(sessionKey);throw Error('登入已到期，請重新登入')}}const headers={apikey:key,'Content-Type':'application/json'};if(s?.access_token)headers.Authorization='Bearer '+s.access_token;else if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;const r=await fetch(base+'/rest/v1/rpc/shop_api',{method:'POST',headers,body:JSON.stringify({b})});const d=await r.json();if(!r.ok)throw Error(d.message||'暫時無法連線');return d}
  async function login(email,password){if(demo){saveSession({demo:true});return}await auth('token?grant_type=password',{email,password});try{await rpc({action:'read',staff:true})}catch(e){sessionStorage.removeItem(sessionKey);throw e}}
  async function logout(){const s=session();sessionStorage.removeItem(sessionKey);if(configured&&s?.access_token){try{await fetch(base+'/auth/v1/logout',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+s.access_token}})}catch{ /* 本機登入資訊已清除。 */ }}}
  window.BentoAPI={rpc,login,logout,session,demo,configured,defaults,dateKey,peakAt,slotsFor};
})();
