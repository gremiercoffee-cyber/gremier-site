-- Terminal status when ops or admin marks an order delivered/fulfilled
COMMENT ON COLUMN pending_website_deliveries.status IS 'pending_schedule | scheduled | delivered | dismissed';
