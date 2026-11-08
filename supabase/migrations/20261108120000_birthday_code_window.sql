-- Birthday codes are made as soon as a birthday is saved and only work in the birthday month:
-- coupons get an optional start date, and birthdays remember when this year's reminder went out.
begin;
alter table public.coupons add column if not exists starts_at timestamptz;
alter table public.customer_birthdays add column if not exists reminded_year int;
-- Codes already sent this year were sent in the birthday month itself: nothing to remind.
update public.customer_birthdays set reminded_year = last_sent_year where last_sent_year is not null and reminded_year is null;
-- Rani (ronnisuna@gmail.com) already got her December 2026 birthday discount by hand (refund):
-- no December 2026 code for her. Next year's comes as normal.
update public.customer_birthdays set last_sent_year = 2026, last_code = null, reminded_year = 2026
  where email = 'ronnisuna@gmail.com' and month = 12;
update public.coupons set is_active = false where code like 'BDAY-%' and lower(customer_email) = 'ronnisuna@gmail.com' and coalesce(uses_count,0) = 0;
commit;
