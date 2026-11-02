-- Run after the migration in a transaction, then ROLLBACK. No persisted test rows.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare p jsonb; r jsonb; first_sid uuid='11111111-1111-4111-8111-111111111111'; second_sid uuid='22222222-2222-4222-8222-222222222222'; visitor uuid='33333333-3333-4333-8333-333333333333';
begin
 p=jsonb_build_object('visitor_id',visitor,'session_id',first_sid,'device','Phone','referrer','Direct','language','en','events',jsonb_build_array(
  jsonb_build_object('id',gen_random_uuid(),'kind','page_view','page','Home'),
  jsonb_build_object('id',gen_random_uuid(),'kind','product_view','page','Product'),
  jsonb_build_object('id',gen_random_uuid(),'kind','cart_add','page','Product'),
  jsonb_build_object('id',gen_random_uuid(),'kind','checkout_open','page','Checkout'),
  jsonb_build_object('id',gen_random_uuid(),'kind','pay_click','page','Checkout'),
  jsonb_build_object('id',gen_random_uuid(),'kind','active','page','Checkout','seconds',15)));
 perform web_collect(p);perform web_collect(p);
 if(select count(*) from web_events where session_id=first_sid)<>6 then raise exception 'duplicate retry counted twice';end if;
 if(select array_agg(kind order by sequence) from web_events where session_id=first_sid)<>array['page_view','product_view','cart_add','checkout_open','pay_click','active'] then raise exception 'journey order corrupted';end if;
 p=jsonb_set(p,'{session_id}',to_jsonb(second_sid));p=jsonb_set(p,'{events}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'kind','page_view','page','Home')));perform web_collect(p);
 r=web_report(current_date,current_date);
 if(r->'totals'->>'visits')::int<>2 or (r->'totals'->>'repeat_visits')::int<>1 or (r->'totals'->>'checkout')::int<>1 or (r->'totals'->>'one_page')::int<>1 then raise exception 'conversion denominator or repeat visits incorrect';end if;
 update web_sessions set started_at=now()-interval '31 days' where visitor_id=visitor;
 perform web_aggregate_old();perform web_aggregate_old();
 if exists(select 1 from web_sessions where visitor_id=visitor) then raise exception 'old identity retained';end if;
 if exists(select 1 from web_events where session_id in(first_sid,second_sid)) then raise exception 'old journey retained';end if;
 if(select sum(visits) from web_daily where dimension='total')<>2 then raise exception 'aggregation duplicated visits';end if;
 r=web_report(current_date-40,current_date);
 if(r->'totals'->>'visits')::int<>2 or (r->'totals'->>'checkout')::int<>1 then raise exception 'summary lost conversions';end if;
end $$;
