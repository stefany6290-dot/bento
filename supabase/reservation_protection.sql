-- 在既有丼物園 Supabase 專案執行一次；保留既有資料。
-- 以單一製作隊列、每份粗估分鐘數安排產能，不保證實際準時出餐。
begin;
create or replace function public._shop_schedule(jobs jsonb, minutes int, at_time timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare
 j jsonb; w jsonb; rows jsonb:='[]'; windows jsonb:='[]';
 busy_until timestamptz:=at_time; cursor_time timestamptz; boundary timestamptz:='infinity';
 start_time timestamptz; end_time timestamptz; started timestamptz;
 qty int; seconds_needed double precision; feasible boolean:=true;
begin
 for j in select value from jsonb_array_elements(jobs) where value->>'status'='preparing' order by value->>'created',value->>'id' loop
  select coalesce(sum((value->>'qty')::int),1) into qty from jsonb_array_elements(j->'items');
  seconds_needed:=coalesce((j->>'productionMinutes')::numeric,qty*minutes)*60;
  started:=coalesce((j->>'productionStartedAt')::timestamptz,at_time);
  seconds_needed:=greatest(60,extract(epoch from started+seconds_needed*interval '1 second'-at_time));
  start_time:=busy_until;busy_until:=busy_until+seconds_needed*interval '1 second';
  rows:=rows||jsonb_build_array(jsonb_build_object('id',j->>'id','start',start_time,'end',busy_until,'kind','preparing','status','preparing'));
 end loop;
 for j in select value from jsonb_array_elements(jobs)
  where value->>'status'='pending' and nullif(value->>'slot','') is not null and value->>'slot'<>'asap'
  order by (value->>'slot')::timestamptz desc,value->>'created' desc,value->>'id' desc loop
  select coalesce(sum((value->>'qty')::int),1) into qty from jsonb_array_elements(j->'items');
  end_time:=least((j->>'slot')::timestamptz,boundary);
  start_time:=end_time-(greatest(1,qty)*minutes)*interval '1 minute';boundary:=start_time;
  if start_time<busy_until then feasible:=false;end if;
  w:=jsonb_build_object('id',j->>'id','start',start_time,'end',end_time,'kind','reservation','status','pending','atRisk',start_time<busy_until);
  windows:=windows||jsonb_build_array(w);rows:=rows||jsonb_build_array(w);
 end loop;
 cursor_time:=busy_until;
 for j in select value from jsonb_array_elements(jobs)
  where value->>'status'='pending' and (nullif(value->>'slot','') is null or value->>'slot'='asap')
  order by value->>'created',coalesce((value->>'pickup')::int,2147483647),value->>'id' loop
  select coalesce(sum((value->>'qty')::int),1) into qty from jsonb_array_elements(j->'items');
  seconds_needed:=greatest(1,qty)*minutes*60;
  for w in select value from jsonb_array_elements(windows) order by (value->>'start')::timestamptz loop
   if (w->>'end')::timestamptz<=cursor_time then continue;end if;
   if cursor_time+seconds_needed*interval '1 second'<=(w->>'start')::timestamptz then exit;end if;
   cursor_time:=greatest(cursor_time,(w->>'end')::timestamptz);
  end loop;
  end_time:=cursor_time+seconds_needed*interval '1 second';
  rows:=rows||jsonb_build_array(jsonb_build_object('id',j->>'id','start',cursor_time,'end',end_time,'kind','immediate','status','pending'));
  cursor_time:=end_time;
 end loop;
 select coalesce(jsonb_agg(value order by case when value->>'status'='preparing' then 0 else 1 end,(value->>'start')::timestamptz,value->>'id'),'[]') into rows from jsonb_array_elements(rows);
 return jsonb_build_object('rows',rows,'busyUntil',busy_until,'feasible',feasible,'asOf',at_time);
end;$$;

create or replace function public._shop_slot_capacity(jobs jsonb, minutes int, at_time timestamptz, slot_time timestamptz)
returns int language plpgsql set search_path='' as $$
declare plan jsonb; busy timestamptz; boundary timestamptz; used int; available int:=99; spare int;
begin
 plan:=public._shop_schedule(jobs,minutes,at_time);
 if not (plan->>'feasible')::boolean then return 0;end if;
 busy:=(plan->>'busyUntil')::timestamptz;
 for boundary in select t from (
  select slot_time as t union
  select (value->>'slot')::timestamptz from jsonb_array_elements(jobs)
  where value->>'status'='pending' and nullif(value->>'slot','') is not null and value->>'slot'<>'asap'
 ) q where t>=slot_time order by t loop
  select coalesce(sum((i->>'qty')::int),0) into used from jsonb_array_elements(jobs) j
   cross join lateral jsonb_array_elements(j->'items') i
   where j->>'status'='pending' and nullif(j->>'slot','') is not null and j->>'slot'<>'asap' and (j->>'slot')::timestamptz<=boundary;
  spare:=floor(extract(epoch from boundary-busy)/(60*minutes))::int-used;
  available:=least(available,spare);
 end loop;
 return greatest(0,available);
end;$$;

-- 保留現行 shop_api 的菜單驗證、付款規則、Auth 與權限檢查。
do $$begin
 if to_regprocedure('public.shop_api_core_v1(jsonb)') is null then
  alter function public.shop_api(jsonb) rename to shop_api_core_v1;
 end if;
end;$$;
revoke all on function public.shop_api_core_v1(jsonb) from public,anon,authenticated;
revoke all on function public._shop_schedule(jsonb,int,timestamptz) from public,anon,authenticated;
revoke all on function public._shop_slot_capacity(jsonb,int,timestamptz,timestamptz) from public,anon,authenticated;

-- 舊版已在製作中的餐點，從本次更新起保守估算剩餘製作時間。
update public.shop_orders o set payload=o.payload||jsonb_build_object(
 'productionStartedAt',now(),
 'productionMinutes',(select sum((value->>'qty')::int) from jsonb_array_elements(o.payload->'items'))*(select (config->>'minutes')::int from public.shop_settings where id=1))
 where o.status='preparing' and o.day=(now() at time zone 'Asia/Taipei')::date and not(o.payload?'productionStartedAt');

create or replace function public.shop_api(b jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 act text:=coalesce(b->>'action','read'); result jsonb; cfg jsonb; jobs jsonb; plan jsonb; row_plan jsonb;
 old public.shop_orders%rowtype; new_id uuid; d date:=(now() at time zone 'Asia/Taipei')::date;
 already_exists boolean:=false; duration int; qty int; slots jsonb:='[]'; slot jsonb; remaining int; next_id text; estimate jsonb;
begin
 if act<>'read' then perform 1 from public.shop_settings where id=1 for update;end if;
 select config into cfg from public.shop_settings where id=1;duration:=(cfg->>'minutes')::int;
 select coalesce(jsonb_agg((to_jsonb(o)-'payload')||o.payload),'[]') into jobs from public.shop_orders o where day=d and status in('pending','preparing');
 plan:=public._shop_schedule(jobs,duration,now());
 if act='update' and b->>'status'='preparing' then
  if not exists(select 1 from public.staff_users where user_id=auth.uid()) then raise exception '需要店家權限';end if;
  select * into old from public.shop_orders where id=(b->>'id')::uuid;
  if old.status='pending' then
   if exists(select 1 from jsonb_array_elements(jobs) j where j->>'status'='preparing') then raise exception '目前仍有製作中訂單，請先標記待取餐，再依建議順序接單';end if;
   select value->>'id' into next_id from jsonb_array_elements(plan->'rows') where value->>'status'='pending' order by (value->>'start')::timestamptz,value->>'id' limit 1;
   select value into row_plan from jsonb_array_elements(plan->'rows') where value->>'id'=b->>'id';
   if old.id::text<>next_id or row_plan is null then raise exception '請先處理排在前面的訂單，避免影響預約取餐';end if;
   if (row_plan->>'start')::timestamptz>now()+interval '1 second' then raise exception '尚未到建議製作時間，請依排單提示稍後接單';end if;
  end if;
 end if;
 if act='create' then select exists(select 1 from public.shop_orders where id=(b->>'requestId')::uuid) into already_exists;end if;
 -- 原函式驗證權限、輸入與尖峰名額，任何後續錯誤皆會回滾本次操作。
 result:=public.shop_api_core_v1(b);
 if act='create' and already_exists then return result||jsonb_build_object('queueVersion',2);end if;
 if act='create' then
  new_id:=(result->>'id')::uuid;
  -- 現場單確認收款後先排隊，不能繞過預約保護直接製作。
  update public.shop_orders set status='pending' where id=new_id and source='onsite' and status='preparing' and not(payload?'productionStartedAt');
  select * into old from public.shop_orders where id=new_id;
  select coalesce(jsonb_agg((to_jsonb(o)-'payload')||o.payload),'[]') into jobs from public.shop_orders o where day=d and status in('pending','preparing');
  plan:=public._shop_schedule(jobs,duration,now());
  if old.status='pending' and nullif(old.payload->>'slot','') is not null and not(plan->>'feasible')::boolean then
   raise exception '此時段製作產能不足，請選較晚的預約時間';
  end if;
  select value into row_plan from jsonb_array_elements(plan->'rows') where value->>'id'=new_id::text;
  if row_plan is not null and ((row_plan->>'end')::timestamptz at time zone 'Asia/Taipei')::date>d then raise exception '今日製作隊列已滿，請稍後再試';end if;
  result:=result||jsonb_build_object('queueEstimate',row_plan);
 elsif act='update' and b->>'status'='preparing' and old.status='pending' then
  select coalesce(sum((value->>'qty')::int),1) into qty from jsonb_array_elements(old.payload->'items');
  update public.shop_orders set payload=payload||jsonb_build_object('productionStartedAt',now(),'productionMinutes',qty*duration) where id=old.id;
 elsif act='service' then
  select config into cfg from public.shop_settings where id=1;
  plan:=public._shop_schedule(jobs,(cfg->>'minutes')::int,now());
  if not(plan->>'feasible')::boolean then raise exception '新的製作時間會影響既有預約，請先處理或取消衝突訂單';end if;
 elsif act='read' then
  for slot in select value from jsonb_array_elements(result->'slots') loop
   if slot->>'time'='asap' then slots:=slots||jsonb_build_array(slot);continue;end if;
   remaining:=public._shop_slot_capacity(jobs,duration,now(),(slot->>'time')::timestamptz);
   if jsonb_typeof(slot->'remaining')='number' then remaining:=least(remaining,(slot->>'remaining')::int);end if;
   slots:=slots||jsonb_build_array(slot||jsonb_build_object('remaining',remaining));
  end loop;
  estimate:=jsonb_build_object('id','__estimate__','status','pending','source','online','created',now(),'pickup',2147483647,'items',jsonb_build_array(jsonb_build_object('qty',1)));
  estimate:=public._shop_schedule(jobs||jsonb_build_array(estimate),duration,now());
  select value into row_plan from jsonb_array_elements(estimate->'rows') where value->>'id'='__estimate__';
  result:=result||jsonb_build_object('slots',slots,'wait',greatest(1,ceil(extract(epoch from (row_plan->>'end')::timestamptz-now())/60)::int));
  if coalesce((b->>'staff')::boolean,false) then result:=result||jsonb_build_object('queuePlan',plan);end if;
 end if;
 return result||jsonb_build_object('queueVersion',2);
end;$$;
revoke all on function public.shop_api(jsonb) from public;
grant execute on function public.shop_api(jsonb) to anon,authenticated;
commit;
