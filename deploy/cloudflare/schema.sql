CREATE TABLE IF NOT EXISTS apartment_objects (
  key TEXT PRIMARY KEY,
  etag TEXT NOT NULL,
  metadata TEXT NOT NULL CHECK(json_valid(metadata)),
  part_count INTEGER NOT NULL CHECK(part_count > 0)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS apartment_object_parts (
  key TEXT NOT NULL,
  etag TEXT NOT NULL,
  part INTEGER NOT NULL CHECK(part >= 0),
  body TEXT NOT NULL,
  PRIMARY KEY (key, part)
) WITHOUT ROWID;
