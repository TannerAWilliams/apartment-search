-- Market history now also refreshes from StreetEasy's own download links (cdn-charts.streeteasy.com), one file
-- per series. market_imports.archive_sha256 is the SHA-256 of that series' zip file, whichever way it came;
-- these columns say where it came from and the last month it reports.
ALTER TABLE market_imports ADD COLUMN source TEXT NOT NULL DEFAULT 'archive';
ALTER TABLE market_imports ADD COLUMN last_month TEXT;
