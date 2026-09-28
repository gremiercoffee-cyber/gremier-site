-- One PayMe subscription charge can only ever produce ONE renewal order. PayMe sends
-- each charge notice more than once; the webhook's check-then-insert guard can lose a
-- race between two simultaneous notices, so enforce it in the database.
create unique index if not exists orders_subscription_iteration_key_unique
  on orders ((delivery_info->>'subscription_iteration_key'))
  where delivery_info->>'subscription_iteration_key' is not null;
