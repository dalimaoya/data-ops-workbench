"""SQL injection prevention utilities.

Provides:
- quote_identifier(): safe identifier quoting with whitelist validation
- validate_identifier(): checks identifiers against DB schema
- check_sql_injection(): detects SQL injection patterns in user input
"""

import re
from typing import Optional, Set

# SQL keywords that should not appear in user search/filter input
_SQL_KEYWORDS = re.compile(
    r"\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|"
    r"UNION|OR\s+1\s*=\s*1|AND\s+1\s*=\s*1|HAVING|ORDER\s+BY|GROUP\s+BY|"
    r"INFORMATION_SCHEMA|SYSOBJECTS|SYSCOLUMNS|SLEEP\s*\(|BENCHMARK\s*\(|"
    r"WAITFOR\s+DELAY|XP_CMDSHELL|SP_EXECUTESQL|LOAD_FILE|INTO\s+OUTFILE|"
    r"INTO\s+DUMPFILE|CHAR\s*\(|CONCAT\s*\(|0x[0-9a-fA-F]+)\b",
    re.IGNORECASE,
)

# Pattern for common injection attempts
_INJECTION_PATTERNS = re.compile(
    r"('|--|;|/\*|\*/|\\x[0-9a-fA-F]{2}|%27|%23|%2D%2D)",
    re.IGNORECASE,
)

# Valid identifier pattern: alphanumeric + underscore + Chinese characters, max 128 chars
_VALID_IDENTIFIER = re.compile(r'^[\w\u4e00-\u9fff][\w\u4e00-\u9fff]*$', re.UNICODE)


def quote_identifier(db_type: str, name: str) -> str:
    """Safely quote a table or column identifier for the given DB type.
    
    Validates the name contains only safe characters and applies
    appropriate quoting for the database dialect.
    
    Raises ValueError if the identifier contains unsafe characters.
    """
    if not name or not name.strip():
        raise ValueError(f"Empty identifier name")
    
    name = name.strip()
    
    # Reject identifiers with dangerous characters
    if not _VALID_IDENTIFIER.match(name):
        raise ValueError(f"Unsafe identifier: {name}")
    
    # Length check
    if len(name) > 128:
        raise ValueError(f"Identifier too long: {name}")

    if db_type == "sqlserver":
        return f"[{name}]"
    elif db_type in ("mysql", "sqlite"):
        return f"`{name}`"
    elif db_type in ("oracle", "dm"):
        return f'"{name.upper()}"'
    else:  # postgresql, kingbase
        return f'"{name}"'


def validate_identifier(name: str, whitelist: Optional[Set[str]] = None) -> bool:
    """Validate an identifier name is safe and optionally in a whitelist.
    
    Args:
        name: The identifier to validate
        whitelist: Optional set of allowed names (e.g., actual column names from schema)
    
    Returns:
        True if valid, False otherwise
    """
    if not name or not name.strip():
        return False
    
    name = name.strip()
    
    if not _VALID_IDENTIFIER.match(name):
        return False
    
    if len(name) > 128:
        return False
    
    if whitelist is not None:
        # Case-insensitive comparison for whitelist
        name_lower = name.lower()
        whitelist_lower = {w.lower() for w in whitelist}
        if name_lower not in whitelist_lower:
            return False
    
    return True


def check_sql_injection(value: str) -> bool:
    """Check if a user input string contains SQL injection patterns.
    
    Returns True if injection is detected (i.e., the input is suspicious).
    """
    if not value:
        return False
    
    # Check for SQL keywords
    if _SQL_KEYWORDS.search(value):
        return True
    
    # Check for injection patterns  
    if _INJECTION_PATTERNS.search(value):
        return True
    
    return False


def sanitize_search_input(value: str) -> str:
    """Sanitize user search input by removing dangerous patterns.
    
    Returns sanitized string. Raises ValueError if the input looks
    clearly malicious.
    """
    if not value:
        return value
    
    # Check for obvious injection attempts
    if check_sql_injection(value):
        raise ValueError(f"Potentially unsafe search input detected")
    
    return value
