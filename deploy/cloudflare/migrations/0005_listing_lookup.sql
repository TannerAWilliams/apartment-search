-- One listing by its ID, for an apartment's own page (its price history), without reading every listing.
-- The ID is inside each listing's JSON, so the index is on that expression; a query must use the same one.
CREATE INDEX IF NOT EXISTS listings_by_id ON listings (json_extract(data, '$.id'));
