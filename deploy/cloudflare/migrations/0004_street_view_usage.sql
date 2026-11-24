-- How many Google Street View images the app has requested in each calendar month (UTC), so it stops before
-- Google's free monthly allowance runs out (server/street-view.ts).
CREATE TABLE street_view_usage (
  month TEXT PRIMARY KEY,
  images INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
