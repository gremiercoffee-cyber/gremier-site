-- Rollback-only: verify exclusion when a guest signs in as the owner.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare owner_id uuid; v uuid=gen_random_uuid(); s uuid=gen_random_uuid(); p jsonb; r jsonb;
begin
 select id into owner_id from auth.users where lower(email)='gremiercoffee@gmail.com';
 if owner_id is null then raise exception 'owner test account missing';end if;
 p=jsonb_build_object('visitor_id',v,'session_id',s,'device','Phone','referrer','Direct','language','en','events',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'kind','page_view','page','Home')));
 perform web_collect(p);
 if not exists(select 1 from web_sessions where id=s and not is_test) then raise exception 'guest not tracked';end if;
 r=web_collect(p,owner_id);
 if not (r->>'internal')::boolean then raise exception 'owner not excluded';end if;
 if not exists(select 1 from web_sessions where id=s and is_test) then raise exception 'pre-login visit still counted';end if;
 if not exists(select 1 from web_visitors where id=v and is_internal) then raise exception 'owner browser not remembered';end if;
 p=jsonb_set(p,'{session_id}',to_jsonb(gen_random_uuid()));
 r=web_collect(p,null);
 if not (r->>'internal')::boolean then raise exception 'signed-out owner browser counted';end if;
 if exists(select 1 from web_sessions where visitor_id=v and not is_test) then raise exception 'internal traffic leaked into reports';end if;
end $$;
