"""v3.9 Database Migration: Add template_reserved_blank_rows to table_config.

Changes:
- Add template_reserved_blank_rows column (default 200)
"""

import sqlite3
import os

DATA_DIR = os.environ.get(
    'DATA_OPS_DATA_DIR',
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data"),
)
DB_PATH = os.path.join(DATA_DIR, "platform.db")


def migrate():
    if not os.path.exists(DB_PATH):
        print(f"[v3.9 migration] Database not found at {DB_PATH}, skipping")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("PRAGMA table_info(table_config)")
    columns = [row[1] for row in cursor.fetchall()]

    if "template_reserved_blank_rows" not in columns:
        cursor.execute("ALTER TABLE table_config ADD COLUMN template_reserved_blank_rows INTEGER NOT NULL DEFAULT 200")
        print("[v3.9 migration] Added template_reserved_blank_rows column")
    else:
        print("[v3.9 migration] template_reserved_blank_rows column already exists, skipping")

    conn.commit()
    conn.close()
    print("[v3.9 migration] Done")


if __name__ == "__main__":
    migrate()
