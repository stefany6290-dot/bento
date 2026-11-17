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
  // 單一製作隊列：先從取餐期限往前預留預約區間，再把即時單放入空檔。
  function schedule(orders,minutes,at=Date.now()){
    const jobs=orders.filter(o=>o.day===dateKey()&&['pending','preparing'].includes(o.status));
    const amount=o=>Math.max(1,(o.items||[]).reduce((n,i)=>n+Number(i.qty||0),0));
    const duration=o=>amount(o)*minutes*60000;
    const byCreated=(a,b)=>Date.parse(a.created)-Date.parse(b.created)||Number(a.pickup||2147483647)-Number(b.pickup||2147483647)||String(a.id).localeCompare(String(b.id));
    let busyUntil=at, boundary=Infinity, feasible=true;const rows=[],windows=[];
    for(const o of jobs.filter(o=>o.status==='preparing').sort(byCreated)){
      const remaining=Math.max(60000,(Date.parse(o.productionStartedAt)||at)+(Number(o.productionMinutes)||amount(o)*minutes)*60000-at);
      rows.push({id:o.id,start:new Date(busyUntil).toISOString(),end:new Date(busyUntil+remaining).toISOString(),kind:'preparing',status:'preparing'});busyUntil+=remaining;
    }
    for(const o of jobs.filter(o=>o.status==='pending'&&o.slot&&o.slot!=='asap').sort((a,b)=>Date.parse(b.slot)-Date.parse(a.slot)||Date.parse(b.created)-Date.parse(a.created)||String(b.id).localeCompare(String(a.id)))){
      const end=Math.min(Date.parse(o.slot),boundary),start=end-duration(o);boundary=start;
      if(start<busyUntil)feasible=false;
      const row={id:o.id,start:new Date(start).toISOString(),end:new Date(end).toISOString(),kind:'reservation',status:'pending',atRisk:start<busyUntil};windows.push(row);rows.push(row);
    }
    windows.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));let cursor=busyUntil;
    for(const o of jobs.filter(o=>o.status==='pending'&&(!o.slot||o.slot==='asap')).sort(byCreated)){
      for(const w of windows){if(Date.parse(w.end)<=cursor)continue;if(cursor+duration(o)<=Date.parse(w.start))break;cursor=Math.max(cursor,Date.parse(w.end))}
      rows.push({id:o.id,start:new Date(cursor).toISOString(),end:new Date(cursor+duration(o)).toISOString(),kind:'immediate',status:'pending'});cursor+=duration(o);
    }
    rows.sort((a,b)=>Number(a.status!=='preparing')-Number(b.status!=='preparing')||Date.parse(a.start)-Date.parse(b.start)||String(a.id).localeCompare(String(b.id)));
    return {rows,busyUntil:new Date(busyUntil).toISOString(),feasible,asOf:new Date(at).toISOString()};
  }
  function slotCapacity(orders,minutes,slot,at=Date.now()){
    const plan=schedule(orders,minutes,at);if(!plan.feasible)return 0;
    const reserved=orders.filter(o=>o.day===dateKey()&&o.status==='pending'&&o.slot&&o.slot!=='asap');
    const boundaries=[Date.parse(slot),...reserved.map(o=>Date.parse(o.slot))].filter(t=>t>=Date.parse(slot));
    return Math.max(0,Math.min(99,...boundaries.map(t=>Math.floor((t-Date.parse(plan.busyUntil))/(minutes*60000))-reserved.filter(o=>Date.parse(o.slot)<=t).reduce((n,o)=>n+o.items.reduce((m,i)=>m+i.qty,0),0))));
  }
  function slotsFor(s){const slots=[];const day=dateKey();if(!peakAt(localTime(),s.config))slots.push({time:'asap',remaining:null});for(let n=0;n<96;n++){const hh=String(Math.floor(n/4)).padStart(2,'0'),mm=String(n%4*15).padStart(2,'0');const time=`${day}T${hh}:${mm}:00+08:00`;if(Date.parse(time)<=Date.now())continue;const used=s.orders.filter(o=>o.day===day&&o.status!=='cancelled'&&o.source==='online'&&o.slot===time).reduce((a,o)=>a+o.items.reduce((b,i)=>b+i.qty,0),0);slots.push({time,remaining:Math.min(peakAt(`${hh}:${mm}`,s.config)?Math.max(0,s.config.capacity-used):99,slotCapacity(s.orders,s.config.minutes,time))})}return slots}
  function demoCall(b){const s=demoStore();let response={ok:true};const staff=!!session()?.demo;
    if(b.action==='read'){
      const queue=s.orders.filter(o=>o.day===dateKey()&&['pending','preparing'].includes(o.status)&&(!o.slot||Date.parse(o.slot)<=Date.now())).reduce((a,o)=>a+o.items.reduce((n,i)=>n+i.qty,0),0);
      const plan=schedule(s.orders,s.config.minutes);const probe={id:'__estimate__',day:dateKey(),status:'pending',created:new Date().toISOString(),items:[{qty:1}],pickup:2147483647};const estimate=schedule([...s.orders,probe],s.config.minutes).rows.find(o=>o.id===probe.id);const data={config:s.config,paused:s.paused,slots:slotsFor(s),wait:Math.max(1,Math.ceil((Date.parse(estimate.end)-Date.now())/60000)),queueVersion:2};
      if(b.track){const o=s.orders.find(o=>o.id===b.track);data.order=o?{...o,phone:undefined}:null}
      if(b.staff){if(!staff)throw Error('請先登入店家工作台');data.orders=s.orders;data.queuePlan=plan}
      return data;
    }
    if(['service','pause','update'].includes(b.action)&&!staff)throw Error('需要店家權限');
    if(b.action==='service'){
      if(!Number.isInteger(b.capacity)||b.capacity<1||b.capacity>100||!Number.isInteger(b.minutes)||b.minutes<1||b.minutes>30)throw Error('份數需 1–100，每份分鐘需 1–30');
      if(![b.lunchStart,b.lunchEnd,b.dinnerStart,b.dinnerEnd].every(t=>/^([01]\d|2[0-3]):(00|15|30|45)$/.test(t))||!(b.lunchStart<b.lunchEnd&&b.lunchEnd<=b.dinnerStart&&b.dinnerStart<b.dinnerEnd))throw Error('午晚尖峰時間需依序排列，並使用15分鐘間隔');
      if(!schedule(s.orders,b.minutes).feasible)throw Error('新的製作時間會影響既有預約，請先處理衝突訂單');
      s.config={capacity:b.capacity,minutes:b.minutes,soldOut:b.soldOut,lunchStart:b.lunchStart,lunchEnd:b.lunchEnd,dinnerStart:b.dinnerStart,dinnerEnd:b.dinnerEnd};
    }else if(b.action==='pause')s.paused=!!b.value;
    else if(b.action==='update'){
      const o=s.orders.find(o=>o.id===b.id);if(!o)throw Error('找不到訂單');const next=b.status||o.status;
      const allowed={pending:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['completed','cancelled'],completed:[],cancelled:[]};
      if(['completed','cancelled'].includes(o.status)||next!==o.status&&!allowed[o.status].includes(next))throw Error('狀態已變更，請重新整理');
      if(next==='cancelled'){if(o.paid||b.paid)throw Error('已付款訂單暫不支援退款');if(!b.reason?.trim())throw Error('請填寫取消原因');o.cancelReason=b.reason.trim().slice(0,200)}
      if(next==='completed'&&!o.paid&&!b.paid)throw Error('請先確認收款');
      if(o.status==='pending'&&next==='preparing'){
        const plan=schedule(s.orders,s.config.minutes),first=plan.rows.find(r=>r.status==='pending');
        if(s.orders.some(r=>r.day===dateKey()&&r.status==='preparing'))throw Error('目前仍有製作中訂單，請先標記待取餐');
        if(first?.id!==o.id)throw Error('請先處理排在前面的訂單，避免影響預約取餐');
        if(Date.parse(first.start)>Date.now()+1000)throw Error('尚未到建議製作時間');
        o.productionStartedAt=new Date().toISOString();o.productionMinutes=o.items.reduce((n,i)=>n+i.qty,0)*s.config.minutes;
      }
      o.status=next;if(b.paid)o.paid=1;
    }else if(b.action==='create'){
      if(s.orders.some(o=>o.id===b.requestId))return {id:b.requestId};
      const onsite=b.source==='onsite';if(onsite&&!staff)throw Error('現場點餐需要店家登入');if(!onsite&&s.paused)throw Error('目前暫停線上接單');
      const phone=String(b.phone||'').replace(/[\s()-]/g,'');if(!onsite&&!/^0\d{8,9}$/.test(phone))throw Error('請輸入有效的聯絡電話');
      if(!Array.isArray(b.items)||!b.items.length||b.items.length>20)throw Error('請選擇 1–20 筆餐點');
      const items=b.items.map(i=>{const m=BentoMenu.menu.find(m=>m.id===i.id);if(!m||s.config.soldOut.includes(i.id))throw Error('有餐點已售完，請調整購物車');if(!Number.isInteger(i.qty)||i.qty<1||i.qty>99)throw Error('餐點數量錯誤');const noSides=!!i.noSides&&m.category==='定食';const needed=m.category==='單點'||noSides?0:[11,19].includes(m.id)?2:3;const sides=noSides?[]:i.sides;if(!Array.isArray(sides)||sides.length!==needed||new Set(sides).size!==needed||!sides.every(v=>BentoMenu.sides.includes(v)))throw Error('配菜數量錯誤');return {...m,price:m.price-(noSides?20:0),qty:i.qty,sides,noSides}});
      const amount=items.reduce((n,i)=>n+i.qty,0);if(amount>99)throw Error('單筆最多99份');
      if(!onsite){const slot=slotsFor(s).find(x=>x.time===b.slot);if(!slot)throw Error('請重新選擇有效取餐時間');if(slot.remaining!==null&&slot.remaining<amount)throw Error('此尖峰時段名額不足，請選其他時段')}
      const o={id:b.requestId,day:dateKey(),created:new Date().toISOString(),seq:s.orders.length+1,pickup:Math.max(0,...s.orders.filter(o=>o.day===dateKey()).map(o=>o.pickup))+1,status:'pending',paid:onsite?1:0,source:onsite?'onsite':'online',items,total:items.reduce((n,i)=>n+i.price*i.qty,0),slot:onsite||b.slot==='asap'?null:b.slot,phone,note:String(b.note||'').slice(0,300)};s.orders.push(o);const plan=schedule(s.orders,s.config.minutes);const estimate=plan.rows.find(r=>r.id===o.id);
      if(o.slot&&!plan.feasible)throw Error('此時段製作產能不足，請選較晚的預約時間');
      if(estimate&&dateOf(estimate.end)>dateKey())throw Error('今日製作隊列已滿');
      response={id:o.id,queueEstimate:estimate};
    }else throw Error('無效操作');
    localStorage.setItem(storeKey,JSON.stringify(s));return response;
  }
  const dateOf=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
  let queueReady=demo;
  async function rpc(b){if(demo)return demoCall(b);if(!configured)throw Error('尚未設定 Supabase，請參考 README');if((b.action==='create'||b.action==='update'&&b.status==='preparing')&&!queueReady)throw Error('資料庫排單保護尚未啟用，請先執行 Supabase SQL 更新');let s=session();if(s?.expires_at<Date.now()/1000+60){refreshing ||= auth('token?grant_type=refresh_token',{refresh_token:s.refresh_token}).finally(()=>refreshing=null);try{s=await refreshing}catch{sessionStorage.removeItem(sessionKey);throw Error('登入已到期，請重新登入')}}const headers={apikey:key,'Content-Type':'application/json'};if(s?.access_token)headers.Authorization='Bearer '+s.access_token;else if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;const r=await fetch(base+'/rest/v1/rpc/shop_api',{method:'POST',headers,body:JSON.stringify({b})});const d=await r.json();if(!r.ok)throw Error(d.message||'暫時無法連線');if(b.action==='read')queueReady=d.queueVersion===2;return d}
  async function login(email,password){if(demo){saveSession({demo:true});return}await auth('token?grant_type=password',{email,password});try{await rpc({action:'read',staff:true})}catch(e){sessionStorage.removeItem(sessionKey);throw e}}
  async function logout(){const s=session();sessionStorage.removeItem(sessionKey);if(configured&&s?.access_token){try{await fetch(base+'/auth/v1/logout',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+s.access_token}})}catch{ /* 本機登入資訊已清除。 */ }}}
  window.BentoAPI={rpc,login,logout,session,demo,configured,defaults,dateKey,peakAt,slotsFor,schedule,slotCapacity};
})();

