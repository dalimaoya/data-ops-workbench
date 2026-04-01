"""Migration: Add dual (local + cloud) independent config columns to ai_config.

Preserves existing cloud config (SiliconFlow DeepSeek-V3.2) by copying legacy
columns into cloud_* columns.

Safe to run multiple times (idempotent).
"""

import sqlite3
import sys
import os

DB_PATHS = [
    os.path.join(os.path.dirname(__file__), "data", "platform.db"),
    os.path.join(os.path.dirname(__file__), "..", "data", "platform.db"),
]

NEW_COLUMNS = [
    # (column_name, type, default)
    ("local_api_protocol", "VARCHAR(32)", "'openai'"),
    ("local_api_url", "VARCHAR(500)", "NULL"),
    ("local_api_key_encrypted", "TEXT", "NULL"),
    ("local_model_name", "VARCHAR(128)", "NULL"),
    ("local_max_tokens", "INTEGER", "4096"),
    ("local_temperature", "FLOAT", "0.3"),
    ("cloud_platform_name", "VARCHAR(64)", "NULL"),
    ("cloud_api_protocol", "VARCHAR(32)", "'openai'"),
    ("cloud_api_url", "VARCHAR(500)", "NULL"),
    ("cloud_api_key_encrypted", "TEXT", "NULL"),
    ("cloud_model_name", "VARCHAR(128)", "NULL"),
    ("cloud_max_tokens", "INTEGER", "4096"),
    ("cloud_temperature", "FLOAT", "0.3"),
]


def migrate(db_path: str):
    if not os.path.exists(db_path):
        print(f"  SKIP {db_path} (not found)")
        return

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Check table exists
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_config'")
    if not cur.fetchone():
        print(f"  SKIP {db_path} (no ai_config table)")
        conn.close()
        return

    # Get existing columns
    cur.execute("PRAGMA table_info(ai_config)")
    existing = {row[1] for row in cur.fetchall()}

    added = 0
    for col_name, col_type, default in NEW_COLUMNS:
        if col_name not in existing:
            sql = f"ALTER TABLE ai_config ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            cur.execute(sql)
            added += 1
            print(f"  + {col_name}")

    if added == 0:
        print(f"  All columns already exist in {db_path}")

    # Migrate existing data: copy legacy fields → cloud_* fields if cloud_* are empty
    cur.execute("""
        UPDATE ai_config SET
            cloud_platform_name = COALESCE(cloud_platform_name, platform_name),
            cloud_api_protocol  = COALESCE(cloud_api_protocol, api_protocol),
            cloud_api_url       = COALESCE(cloud_api_url, api_url),
            cloud_api_key_encrypted = COALESCE(cloud_api_key_encrypted, api_key_encrypted),
            cloud_model_name    = COALESCE(cloud_model_name, model_name),
            cloud_max_tokens    = COALESCE(cloud_max_tokens, max_tokens),
            cloud_temperature   = COALESCE(cloud_temperature, temperature)
        WHERE engine_mode = 'cloud'
          AND cloud_api_url IS NULL
          AND api_url IS NOT NULL
    """)
    migrated = cur.rowcount
    if migrated:
        print(f"  ✓ Migrated {migrated} row(s): legacy → cloud_* columns")

    conn.commit()

    # Verify
    cur.execute("SELECT cloud_platform_name, cloud_api_url, cloud_model_name, "
                "CASE WHEN cloud_api_key_encrypted IS NOT NULL AND cloud_api_key_encrypted != '' THEN 'HAS_KEY' ELSE 'NO_KEY' END "
                "FROM ai_config LIMIT 1")
    row = cur.fetchone()
    if row:
        print(f"  Verify: platform={row[0]}, url={row[1]}, model={row[2]}, key={row[3]}")

    conn.close()
    print(f"  ✓ Done: {db_path}")


if __name__ == "__main__":
    print("=== AI Dual Config Migration ===")
    for p in DB_PATHS:
        abs_p = os.path.abspath(p)
        print(f"\nProcessing: {abs_p}")
        migrate(abs_p)
    print("\nMigration complete.")
