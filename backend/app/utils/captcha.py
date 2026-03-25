"""Simple captcha generator using Pillow (no external captcha lib needed)."""

import io
import random
import string
import time
import uuid
import base64
import threading

from PIL import Image, ImageDraw, ImageFont

# In-memory store: {captcha_id: (code, expire_time)}
_captcha_store = {}  # type: dict
_lock = threading.Lock()

CAPTCHA_EXPIRE_SECONDS = 300  # 5 minutes
CAPTCHA_LENGTH = 4
# Characters excluding confusing ones (0/O, 1/l/I)
CAPTCHA_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def _cleanup_expired():
    """Remove expired captcha entries."""
    now = time.time()
    expired = [k for k, (_, exp) in _captcha_store.items() if now > exp]
    for k in expired:
        _captcha_store.pop(k, None)


def generate_captcha():
    """Generate a captcha image.

    Returns:
        (captcha_id, code, base64_png)
    """
    code = "".join(random.choices(CAPTCHA_CHARS, k=CAPTCHA_LENGTH))
    captcha_id = uuid.uuid4().hex

    with _lock:
        _cleanup_expired()
        _captcha_store[captcha_id] = (code.upper(), time.time() + CAPTCHA_EXPIRE_SECONDS)

    # Generate image with Pillow
    width, height = 130, 46
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Draw background noise lines
    for _ in range(5):
        x1 = random.randint(0, width)
        y1 = random.randint(0, height)
        x2 = random.randint(0, width)
        y2 = random.randint(0, height)
        color = (random.randint(150, 220), random.randint(150, 220), random.randint(150, 220))
        draw.line([(x1, y1), (x2, y2)], fill=color, width=1)

    # Draw noise dots
    for _ in range(100):
        x = random.randint(0, width - 1)
        y = random.randint(0, height - 1)
        color = (random.randint(100, 200), random.randint(100, 200), random.randint(100, 200))
        draw.point((x, y), fill=color)

    # Try to use a monospaced font; fall back to default
    font = None
    font_size = 30
    try:
        # Try common system fonts
        for font_path in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
            "/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf",
            "/usr/share/fonts/dejavu/DejaVuSansMono-Bold.ttf",
        ]:
            try:
                font = ImageFont.truetype(font_path, font_size)
                break
            except (IOError, OSError):
                continue
    except Exception:
        pass

    if font is None:
        try:
            font = ImageFont.load_default()
        except Exception:
            font = None

    # Draw each character with slight randomization
    x_start = 10
    for i, ch in enumerate(code):
        x = x_start + i * 28
        y = random.randint(4, 10)
        color = (random.randint(20, 100), random.randint(20, 100), random.randint(20, 100))
        if font:
            draw.text((x, y), ch, font=font, fill=color)
        else:
            draw.text((x, y), ch, fill=color)

    # Convert to base64 PNG
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return captcha_id, code, b64


def verify_captcha(captcha_id, captcha_code):
    """Verify and consume a captcha.

    Returns True if valid, False otherwise.
    Captcha is deleted after verification (one-time use).
    """
    if not captcha_id or not captcha_code:
        return False

    with _lock:
        _cleanup_expired()
        entry = _captcha_store.pop(captcha_id, None)

    if entry is None:
        return False

    stored_code, expire_time = entry
    if time.time() > expire_time:
        return False

    return stored_code.upper() == captcha_code.strip().upper()
