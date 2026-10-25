ALTER TABLE items ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'unspecified'
  CHECK(execution_mode IN ('unspecified','call','voice','desk','physical'));
ALTER TABLE situations ADD COLUMN activity_mode TEXT NOT NULL DEFAULT 'auto'
  CHECK(activity_mode IN ('auto','standard','driving'));
