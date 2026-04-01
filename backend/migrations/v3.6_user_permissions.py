"""v3.6 Database Migration: User Permissions Management.

Changes:
- Add last_login_at to user_account
- Rename role 'readonly' → 'viewer' for consistency with v3.6 spec
- Ensure existing admin user has role='admin'
"""

import sqlite3
import os
import sys

DATA_DIR = os.environ.get(
    'DATA_OPS_DATA_DIR',
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data"),
)
DB_PATH = os.path.join(DATA_DIR, "platform.db")


def migrate():
    if not os.path.exists(DB_PATH):
        print(f"[v3.6 migration] Database not found at {DB_PATH}, skipping (will be created on startup)")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Add last_login_at column if not exists
    cursor.execute("PRAGMA table_info(user_account)")
    columns = [row[1] for row in cursor.fetchall()]

    if "last_login_at" not in columns:
        cursor.execute("ALTER TABLE user_account ADD COLUMN last_login_at DATETIME")
        print("[v3.6 migration] Added last_login_at column to user_account")
    else:
        print("[v3.6 migration] last_login_at column already exists")

    # 2. Rename role 'readonly' → 'viewer'
    cursor.execute("UPDATE user_account SET role = 'viewer' WHERE role = 'readonly'")
    affected = cursor.rowcount
    if affected > 0:
        print(f"[v3.6 migration] Renamed {affected} user(s) from role 'readonly' to 'viewer'")
    else:
        print("[v3.6 migration] No users with role 'readonly' found (already migrated or none exist)")

    # 3. Ensure admin user has role='admin'
    cursor.execute("UPDATE user_account SET role = 'admin' WHERE username = 'admin' AND role != 'admin'")
    if cursor.rowcount > 0:
        print("[v3.6 migration] Set admin user role to 'admin'")

    conn.commit()
    conn.close()
    print("[v3.6 migration] Complete!")


if __name__ == "__main__":
    migrate()
