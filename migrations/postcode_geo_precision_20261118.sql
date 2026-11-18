-- District centroids and non-UK skips live beside full postcodes. Existing rows stay full.
alter table public.postcode_geo_cache add column if not exists precision text;
