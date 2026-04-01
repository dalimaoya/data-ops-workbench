"""Security hardening tests covering all 10 security items."""

import os
import sys
import time
import pytest

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ─────────────────────────────────────────────
# 1. SQL Injection Prevention Tests
# ─────────────────────────────────────────────

class TestSQLInjection:
    """Test SQL injection prevention utilities."""
    
    def test_quote_identifier_mysql(self):
        from app.utils.sql_security import quote_identifier
        assert quote_identifier("mysql", "users") == "`users`"
    
    def test_quote_identifier_postgresql(self):
        from app.utils.sql_security import quote_identifier
        assert quote_identifier("postgresql", "users") == '"users"'
    
    def test_quote_identifier_sqlserver(self):
        from app.utils.sql_security import quote_identifier
        assert quote_identifier("sqlserver", "users") == "[users]"
    
    def test_quote_identifier_oracle(self):
        from app.utils.sql_security import quote_identifier
        assert quote_identifier("oracle", "users") == '"USERS"'
    
    def test_quote_identifier_rejects_injection(self):
        from app.utils.sql_security import quote_identifier
        with pytest.raises(ValueError):
            quote_identifier("mysql", "users; DROP TABLE users")
    
    def test_quote_identifier_rejects_semicolon(self):
        from app.utils.sql_security import quote_identifier
        with pytest.raises(ValueError):
            quote_identifier("mysql", "table;name")
    
    def test_quote_identifier_rejects_quotes(self):
        from app.utils.sql_security import quote_identifier
        with pytest.raises(ValueError):
            quote_identifier("mysql", "table'name")
    
    def test_quote_identifier_rejects_dash_dash(self):
        from app.utils.sql_security import quote_identifier
        with pytest.raises(ValueError):
            quote_identifier("mysql", "table--name")
    
    def test_quote_identifier_accepts_chinese(self):
        from app.utils.sql_security import quote_identifier
        result = quote_identifier("mysql", "用户表")
        assert result == "`用户表`"
    
    def test_quote_identifier_rejects_empty(self):
        from app.utils.sql_security import quote_identifier
        with pytest.raises(ValueError):
            quote_identifier("mysql", "")
    
    def test_validate_identifier_basic(self):
        from app.utils.sql_security import validate_identifier
        assert validate_identifier("users") is True
        assert validate_identifier("user_name") is True
        assert validate_identifier("table123") is True
    
    def test_validate_identifier_with_whitelist(self):
        from app.utils.sql_security import validate_identifier
        whitelist = {"id", "name", "email"}
        assert validate_identifier("name", whitelist) is True
        assert validate_identifier("hacked", whitelist) is False
    
    def test_check_sql_injection_or_1_eq_1(self):
        from app.utils.sql_security import check_sql_injection
        assert check_sql_injection("' OR 1=1 --") is True
    
    def test_check_sql_injection_union_select(self):
        from app.utils.sql_security import check_sql_injection
        assert check_sql_injection("1 UNION SELECT * FROM users") is True
    
    def test_check_sql_injection_drop_table(self):
        from app.utils.sql_security import check_sql_injection
        assert check_sql_injection("'; DROP TABLE users --") is True
    
    def test_check_sql_injection_sleep(self):
        from app.utils.sql_security import check_sql_injection
        assert check_sql_injection("1; SLEEP(5)") is True
    
    def test_check_sql_injection_normal_input(self):
        from app.utils.sql_security import check_sql_injection
        assert check_sql_injection("John") is False
        assert check_sql_injection("test@example.com") is False
        assert check_sql_injection("北京市朝阳区") is False
    
    def test_sanitize_search_input_safe(self):
        from app.utils.sql_security import sanitize_search_input
        assert sanitize_search_input("hello") == "hello"
        assert sanitize_search_input("测试搜索") == "测试搜索"
    
    def test_sanitize_search_input_injection(self):
        from app.utils.sql_security import sanitize_search_input
        with pytest.raises(ValueError):
            sanitize_search_input("' OR 1=1 --")


# ─────────────────────────────────────────────
# 2. Password Storage (bcrypt) Tests
# ─────────────────────────────────────────────

class TestPasswordStorage:
    """Test bcrypt password hashing and legacy migration."""
    
    def test_hash_password_produces_bcrypt(self):
        from app.utils.auth import hash_password
        hashed = hash_password("testpassword")
        assert hashed.startswith("$2b$")
        assert len(hashed) >= 60
    
    def test_verify_bcrypt_password(self):
        from app.utils.auth import hash_password, verify_password
        hashed = hash_password("mypassword")
        assert verify_password("mypassword", hashed) is True
        assert verify_password("wrongpassword", hashed) is False
    
    def test_verify_legacy_sha256_password(self):
        from app.utils.auth import verify_password, _legacy_hash
        legacy_hash = _legacy_hash("oldpassword")
        assert verify_password("oldpassword", legacy_hash) is True
        assert verify_password("wrongpassword", legacy_hash) is False
    
    def test_needs_password_migration(self):
        from app.utils.auth import needs_password_migration, hash_password, _legacy_hash
        # bcrypt hash should NOT need migration
        bcrypt_hash = hash_password("test")
        assert needs_password_migration(bcrypt_hash) is False
        
        # SHA256 hash SHOULD need migration
        sha_hash = _legacy_hash("test")
        assert needs_password_migration(sha_hash) is True
    
    def test_hash_uniqueness(self):
        """Each hash should be unique (random salt)."""
        from app.utils.auth import hash_password
        h1 = hash_password("same_password")
        h2 = hash_password("same_password")
        assert h1 != h2  # bcrypt uses random salt


# ─────────────────────────────────────────────
# 3. JWT Key Management Tests
# ─────────────────────────────────────────────

class TestJWTKeyManagement:
    """Test JWT secret key management."""
    
    def test_secret_key_not_default(self):
        from app.utils.auth import SECRET_KEY, _DEFAULT_SECRET
        # If file/env is used, key should differ from default
        # (In test env, the file should have been auto-generated)
        assert SECRET_KEY != _DEFAULT_SECRET or os.environ.get("JWT_SECRET") == _DEFAULT_SECRET
    
    def test_create_and_decode_token(self):
        from app.utils.auth import create_access_token, decode_token
        token = create_access_token({"sub": "testuser", "role": "admin"})
        payload = decode_token(token)
        assert payload["sub"] == "testuser"
        assert payload["role"] == "admin"
    
    def test_invalid_token_raises(self):
        from app.utils.auth import decode_token
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            decode_token("invalid.token.here")


# ─────────────────────────────────────────────
# 4. CORS Configuration Tests
# ─────────────────────────────────────────────

class TestCORSConfig:
    """Test CORS is properly configured."""
    
    def test_cors_not_wildcard(self):
        """CORS should not use wildcard origins."""
        from app.main import _allowed_origins
        assert "*" not in _allowed_origins


# ─────────────────────────────────────────────
# 5. Security Headers Tests
# ─────────────────────────────────────────────

class TestSecurityHeaders:
    """Test security response headers."""
    
    def test_headers_middleware(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        response = client.get("/api/health")
        assert response.headers.get("X-Frame-Options") == "DENY"
        assert response.headers.get("X-Content-Type-Options") == "nosniff"
        assert response.headers.get("X-XSS-Protection") == "1; mode=block"
        assert "Content-Security-Policy" in response.headers
        assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
        assert "Permissions-Policy" in response.headers


# ─────────────────────────────────────────────
# 6. Rate Limiting Tests
# ─────────────────────────────────────────────

class TestRateLimiting:
    """Test API rate limiting."""
    
    def test_rate_limiter_allows_within_limit(self):
        from app.utils.security_middleware import RateLimiter
        limiter = RateLimiter()
        for i in range(5):
            assert limiter.is_allowed("test_key", 60, 5) is True
    
    def test_rate_limiter_blocks_over_limit(self):
        from app.utils.security_middleware import RateLimiter
        limiter = RateLimiter()
        key = "test_block_key"
        for i in range(10):
            limiter.is_allowed(key, 60, 10)
        assert limiter.is_allowed(key, 60, 10) is False
    
    def test_localhost_bypasses_rate_limit(self):
        from app.utils.security_middleware import check_rate_limit
        # Localhost should always pass
        for i in range(100):
            assert check_rate_limit("login", "127.0.0.1") is True


# ─────────────────────────────────────────────
# 7. Login Lockout Tests
# ─────────────────────────────────────────────

class TestLoginLockout:
    """Test login failure lockout mechanism."""
    
    def test_lockout_after_5_failures(self):
        from app.utils.security_middleware import LoginLockout
        lockout = LoginLockout(max_attempts=5, lockout_minutes=1)
        
        for i in range(4):
            remaining = lockout.record_failure("testuser_lock")
            assert remaining > 0
        
        remaining = lockout.record_failure("testuser_lock")
        assert remaining == 0
        assert lockout.is_locked("testuser_lock") is True
    
    def test_lockout_not_before_threshold(self):
        from app.utils.security_middleware import LoginLockout
        lockout = LoginLockout(max_attempts=5, lockout_minutes=1)
        
        for i in range(3):
            lockout.record_failure("testuser_partial")
        
        assert lockout.is_locked("testuser_partial") is False
    
    def test_reset_clears_lockout(self):
        from app.utils.security_middleware import LoginLockout
        lockout = LoginLockout(max_attempts=5, lockout_minutes=1)
        
        for i in range(5):
            lockout.record_failure("testuser_reset")
        
        assert lockout.is_locked("testuser_reset") is True
        lockout.reset("testuser_reset")
        assert lockout.is_locked("testuser_reset") is False
    
    def test_admin_unlock(self):
        from app.utils.security_middleware import LoginLockout
        lockout = LoginLockout(max_attempts=5, lockout_minutes=1)
        
        for i in range(5):
            lockout.record_failure("testuser_unlock")
        
        assert lockout.is_locked("testuser_unlock") is True
        lockout.unlock("testuser_unlock")
        assert lockout.is_locked("testuser_unlock") is False
    
    def test_lock_info(self):
        from app.utils.security_middleware import LoginLockout
        lockout = LoginLockout(max_attempts=5, lockout_minutes=1)
        
        info = lockout.get_lock_info("new_user")
        assert info["locked"] is False
        assert info["recent_failures"] == 0


# ─────────────────────────────────────────────
# 8. File Upload Security Tests
# ─────────────────────────────────────────────

class TestFileUploadSecurity:
    """Test file upload validation."""
    
    def test_valid_xlsx(self):
        from app.utils.security_middleware import validate_upload_file
        assert validate_upload_file("data.xlsx") is None
    
    def test_valid_xls(self):
        from app.utils.security_middleware import validate_upload_file
        assert validate_upload_file("data.xls") is None
    
    def test_reject_exe(self):
        from app.utils.security_middleware import validate_upload_file
        error = validate_upload_file("malware.exe")
        assert error is not None
        assert "不支持" in error
    
    def test_reject_php(self):
        from app.utils.security_middleware import validate_upload_file
        error = validate_upload_file("shell.php")
        assert error is not None
    
    def test_reject_path_traversal(self):
        from app.utils.security_middleware import validate_upload_file
        error = validate_upload_file("../../etc/passwd")
        assert error is not None
        assert "非法字符" in error
    
    def test_reject_oversized_file(self):
        from app.utils.security_middleware import validate_upload_file
        # 60MB content
        big_content = b"x" * (60 * 1024 * 1024)
        error = validate_upload_file("data.xlsx", content=big_content)
        assert error is not None
        assert "超过" in error
    
    def test_empty_filename_rejected(self):
        from app.utils.security_middleware import validate_upload_file
        error = validate_upload_file("")
        assert error is not None


# ─────────────────────────────────────────────
# 9. Data Source Password Encryption Tests
# ─────────────────────────────────────────────

class TestDataSourcePasswordEncryption:
    """Test data source password encryption/decryption."""
    
    def test_encrypt_decrypt_roundtrip(self):
        from app.utils.crypto import encrypt_password, decrypt_password
        original = "my_secret_password_123"
        encrypted = encrypt_password(original)
        assert encrypted != original  # Should be different
        decrypted = decrypt_password(encrypted)
        assert decrypted == original
    
    def test_encrypted_is_not_plaintext(self):
        from app.utils.crypto import encrypt_password
        encrypted = encrypt_password("simple_password")
        assert "simple_password" not in encrypted


# ─────────────────────────────────────────────
# 10. XSS Prevention Tests
# ─────────────────────────────────────────────

class TestXSSPrevention:
    """Test XSS sanitization."""
    
    def test_sanitize_script_tag(self):
        from app.utils.security_middleware import sanitize_html
        result = sanitize_html('<script>alert("xss")</script>')
        assert "<script>" not in result
        assert "&lt;script&gt;" in result
    
    def test_sanitize_img_onerror(self):
        from app.utils.security_middleware import sanitize_html
        result = sanitize_html('<img src=x onerror="alert(1)">')
        assert "<img" not in result
    
    def test_sanitize_dict_recursive(self):
        from app.utils.security_middleware import sanitize_dict
        data = {
            "name": "<script>alert(1)</script>",
            "nested": {
                "value": '<img src=x onerror="hack">',
            },
            "list": ["<b>bold</b>", "normal"],
            "number": 42,
        }
        result = sanitize_dict(data)
        assert "<script>" not in result["name"]
        assert "<img" not in result["nested"]["value"]
        assert "&lt;b&gt;" in result["list"][0]
        assert result["list"][1] == "normal"
        assert result["number"] == 42
    
    def test_sanitize_normal_text(self):
        from app.utils.security_middleware import sanitize_html
        assert sanitize_html("Hello World") == "Hello World"
        assert sanitize_html("数据运维") == "数据运维"
    
    def test_sanitize_none(self):
        from app.utils.security_middleware import sanitize_html
        assert sanitize_html(None) is None


# ─────────────────────────────────────────────
# Integration: Health endpoint with security headers
# ─────────────────────────────────────────────

class TestIntegration:
    """Integration tests."""
    
    def test_health_endpoint_returns_ok(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
    
    def test_health_has_security_headers(self):
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        response = client.get("/api/health")
        assert "X-Frame-Options" in response.headers
        assert "X-Content-Type-Options" in response.headers


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
