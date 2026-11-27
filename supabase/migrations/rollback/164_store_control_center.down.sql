-- These Store structures may already contain retained production data from
-- the legacy release. Roll the application back independently. A schema
-- rollback requires a recorded pre-migration baseline and a separate review.
DO $$
BEGIN
  RAISE EXCEPTION 'Store schema rollback requires the verified pre-migration baseline'
    USING ERRCODE = '55000';
END $$;
