-- One website order can only ever produce ONE scheduled job. The app-level
-- check-then-insert guard loses a race when the PayMe webhook and the browser
-- return URL confirm the same order within milliseconds; this constraint makes
-- the duplicate insert fail atomically instead, which the function catches.
create unique index if not exists jobs_website_order_id_unique
  on jobs (website_order_id)
  where website_order_id is not null;
