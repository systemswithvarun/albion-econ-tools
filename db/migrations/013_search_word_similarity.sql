-- 013: fix fuzzy search — score word extents, not the whole string.
--
-- 005/010 matched on `similarity(display_name, q) > 0.2`. similarity() scores the
-- WHOLE target string, so a long name dilutes the score: the only satchel item is
-- 'Adept's Satchel of Insight', whose large trigram set drops a 7-char query far below
-- 0.2. Measured against live data, the old predicate was both too strict and too loose:
--
--   query 'satchel' -> 5 rows   (substring hit, never fuzzy)
--   query 'satchle' -> 0 rows   (real typo, MISSED)
--   query 'stachel' -> 'Steel Bar'  (noise, MATCHED)
--
-- word_similarity(q, display_name) scores the best-matching extent within the target
-- instead, which is what a typo in one word of a multi-word name needs.
--
-- Threshold 0.30, measured against live data after applying this migration:
--   'satchle' -> Adept's Satchel of Insight   (was 0 rows)
--   'knigt'   -> Adept's Knight Armor         (was 0 rows)
--   'clamore' -> Adept's Claymore             (was 0 rows)
--   'stachel' -> Steel Bar no longer returned (noise rejected)
--
-- KNOWN LIMIT: transposing two ADJACENT letters ('satchel' -> 'stachel') destroys ~3 of
-- 8 trigrams, scoring below this floor and below unrelated words ('Staff'). Lowering the
-- threshold does not rescue it, it only admits noise — Satchel still would not outrank
-- Staff. That typo class needs an edit-distance pass (levenshtein), not a trigram tweak.
-- lib/__tests__/prices.test.ts asserts this limit so it stays visible.
--
-- Substring (ilike) matching is retained unchanged — it is what exact/prefix queries
-- rely on. Ordering keeps the migration-010 family grouping, now ranked by the same
-- word_similarity so the rank agrees with the filter.
--
-- Note: word_similarity() called as a function does not use the trigram GIN index (the
-- `<%` operator would, but it reads a threshold GUC rather than an explicit bound). At
-- ~11.8k items a seq scan is a few ms, and an explicit threshold is worth more here
-- than index usage.

create or replace function search_items(q text, lim int default 50, off int default 0)
returns setof items
language sql stable
as $$
  select i.*
  from items i
  where i.display_name ilike '%' || q || '%'
     or word_similarity(q, i.display_name) >= 0.30
  order by
    max(word_similarity(q, i.display_name)) over (partition by i.base_key) desc nulls last,
    i.base_key asc,
    i.tier asc,
    i.enchant asc
  limit lim offset off
$$;
