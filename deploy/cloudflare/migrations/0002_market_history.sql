-- StreetEasy's monthly market data (the Data Dashboard's Master Report), one row per area, series and month.
-- Filled from the verified archive the Worker serves (server/storage/market-history.ts), one series at a time
-- the first time it is asked for; market_imports records which archive each series came from.

-- The city, its boroughs and StreetEasy's neighborhoods. Ids come from server/data/dashboard-catalog.ts.
CREATE TABLE IF NOT EXISTS market_areas (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  borough TEXT NOT NULL,
  area_type TEXT NOT NULL CHECK (area_type IN ('city', 'borough', 'neighborhood')),
  UNIQUE (name, borough, area_type)
);

-- One measure for one segment, such as median asking rent for one-bedrooms (medianAskingRent, OneBd).
CREATE TABLE IF NOT EXISTS market_series (
  id INTEGER PRIMARY KEY,
  metric TEXT NOT NULL,
  segment TEXT NOT NULL,
  UNIQUE (metric, segment)
);

-- A reported monthly value. Months StreetEasy left blank have no row: unknown, never zero.
CREATE TABLE IF NOT EXISTS market_values (
  series_id INTEGER NOT NULL REFERENCES market_series (id),
  area_id INTEGER NOT NULL REFERENCES market_areas (id),
  month TEXT NOT NULL CHECK (month GLOB '[12][0-9][0-9][0-9]-[01][0-9]'),
  value REAL NOT NULL,
  PRIMARY KEY (series_id, area_id, month)
) WITHOUT ROWID;

-- Every area's value in one month, for rankings and comparisons.
CREATE INDEX IF NOT EXISTS market_values_by_month ON market_values (series_id, month);

-- Which archive each series was loaded from; a series is reloaded when the archive changes.
CREATE TABLE IF NOT EXISTS market_imports (
  series_id INTEGER PRIMARY KEY REFERENCES market_series (id),
  archive_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  value_count INTEGER NOT NULL
);
