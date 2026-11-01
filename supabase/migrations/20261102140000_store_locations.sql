-- Where to buy: each store's public listing (the name customers know, address, map pin).
begin;
alter table public.stores add column if not exists public_name text,
  add column if not exists public_address text,
  add column if not exists public_city text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists show_on_map boolean not null default false;
-- Only what's meant to be public, readable by anyone (the website's map).
create or replace view public.store_locations as
  select id, coalesce(public_name, name) as name, public_address as address, public_city as city, lat, lng
  from public.stores where show_on_map and is_active is not false and lat is not null and lng is not null;
grant select on public.store_locations to anon, authenticated;
update public.stores s set public_name=v.pn, public_address=v.addr, public_city=v.city, lat=v.lat, lng=v.lng, show_on_map=true
from (values
  ('Good Store','Good Store','פארן 15','ירושלים',31.8006623,35.226533),
  ('Arzei Market','סופר ארזי הבירה','ארזי הבירה 48','ירושלים',31.792303,35.2248039),
  ('Birkat Sanhedriya','ברכת סנהדריה','אחינועם 12, סנהדריה','ירושלים',31.7985191,35.2209778),
  ('French Hill','מינימרקט הגבעה','ההגנה 6, הגבעה הצרפתית','ירושלים',31.8033129,35.2364526),
  ('Shevach Fruit Store','Shevach Fruit Store · שבח','מעבר המיתלה 5','ירושלים',31.802842,35.223004),
  ('Mini Machane Yehuda RBS','מיני מחניודה','נחל זוהר 12','רמת בית שמש',31.7141372,34.9881065),
  ('Cheaperkol','צ''יפר-כל','כנפי נשרים 31','ירושלים',31.7871437,35.1825599)
) v(name,pn,addr,city,lat,lng)
where s.name=v.name;
commit;
-- Added after confirmation: Nemirovs. Rova Market stays off the map until it has stock again.
update public.stores set public_name='Nemirovs · נמירוב', public_address='שערי חסד 15', public_city='ירושלים', lat=31.7778026, lng=35.2116681, show_on_map=true where name='Nemirovs';
update public.stores set show_on_map=false where name='Rova Market';
