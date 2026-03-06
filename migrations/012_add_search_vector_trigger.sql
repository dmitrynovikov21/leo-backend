-- Auto-populate search_vector on INSERT/UPDATE
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_search_vector ON document_chunks;

CREATE TRIGGER trg_update_search_vector
BEFORE INSERT OR UPDATE OF content ON document_chunks
FOR EACH ROW EXECUTE FUNCTION update_search_vector();

-- Backfill existing chunks that have NULL search_vector
UPDATE document_chunks
SET search_vector = to_tsvector('simple', COALESCE(content, ''))
WHERE search_vector IS NULL;
