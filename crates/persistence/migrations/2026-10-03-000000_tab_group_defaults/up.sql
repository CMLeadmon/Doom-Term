ALTER TABLE tab_groups ADD COLUMN default_directory TEXT;
ALTER TABLE tab_groups ADD COLUMN empty_position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tab_groups ADD COLUMN stable_id TEXT;
