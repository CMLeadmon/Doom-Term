"""Exercise the actual additive migration against existing and empty group rows."""
import json
from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "crates/persistence/migrations/2026-10-03-000000_tab_group_defaults"


class GroupPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript("""
            PRAGMA foreign_keys=ON;
            CREATE TABLE windows (id INTEGER PRIMARY KEY);
            CREATE TABLE tabs (id INTEGER PRIMARY KEY, window_id INTEGER);
            INSERT INTO windows VALUES (1);
        """)
        self.db.executescript((ROOT / "crates/persistence/migrations/2026-06-01-000000_add_tab_groups/up.sql").read_text())
        self.db.executescript((ROOT / "crates/persistence/migrations/2026-06-12-000000_add_pinned_to_tabs_and_tab_groups/up.sql").read_text())
        self.db.execute("INSERT INTO tab_groups VALUES (1, 1, 'Existing', NULL, 0, 0)")
        self.db.execute("INSERT INTO tabs VALUES (1, 1, 1, 0)")

    def tearDown(self):
        self.db.close()

    def test_upgrade_preserves_existing_groups_and_defaults_are_absent(self):
        with self.assertRaises(sqlite3.OperationalError):
            self.db.execute("SELECT default_directory FROM tab_groups")
        self.db.executescript((MIGRATION / "up.sql").read_text())
        self.assertEqual(self.db.execute("SELECT name, default_directory, empty_position, stable_id FROM tab_groups").fetchone(), ("Existing", None, 0, None))
        self.assertEqual(self.db.execute("SELECT tab_group_id FROM tabs").fetchone(), (1,))

    def test_last_member_removal_preserves_local_and_ssh_configuration(self):
        self.db.executescript((MIGRATION / "up.sql").read_text())
        for config in [{"kind": "local", "directory": "/tmp/a b"}, {"kind": "ssh", "host": "example.com", "username": "tester", "port": 2222, "directory": "~/a'b"}]:
            self.db.execute("UPDATE tab_groups SET default_directory=?, empty_position=3, stable_id='saved-id'", (json.dumps(config),))
            self.db.execute("DELETE FROM tabs")
            saved, position, stable = self.db.execute("SELECT default_directory, empty_position, stable_id FROM tab_groups").fetchone()
            self.assertEqual(json.loads(saved), config)
            self.assertEqual((position, stable), (3, "saved-id"))

    def test_down_migration_retains_old_group_fields(self):
        self.db.executescript((MIGRATION / "up.sql").read_text())
        self.db.executescript((MIGRATION / "down.sql").read_text())
        self.assertEqual(self.db.execute("SELECT name, pinned, collapsed FROM tab_groups").fetchone(), ("Existing", 0, 0))
