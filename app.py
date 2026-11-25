import argparse
import html
import json
import math
import os
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from functools import wraps
from getpass import getpass
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, abort, g, jsonify, request, send_from_directory, session
from markupsafe import escape
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash


ROOT = Path(__file__).resolve().parent
INSTANCE = ROOT / "instance"
# Tests point this somewhere temporary so they never touch the shop's real data.
DATABASE = Path(os.environ.get("PITSTOP_DATABASE") or INSTANCE / "pitstop.sqlite3")
SECRET_KEY_FILE = INSTANCE / "secret_key"
CATALOG_FILE = ROOT / "data" / "catalog.json"
SETTINGS_FILE = ROOT / "data" / "settings.json"
IMAGES = ROOT / "images"
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PRODUCT_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PRODUCT_FIELDS = {
    "name", "make", "scale", "category", "price", "stock", "bestSeller",
    "newArrival", "condition", "image", "imageAlt", "description",
}
# Collector details. All optional so older clients and catalog files keep working.
PRODUCT_EXTRA_DEFAULTS = {
    "gallery": [],
    "editionSize": None,
    "chase": False,
    "releaseDate": "",
    "preorder": False,
    "lengthMm": None,
    "links": [],
    "available": True,
}
PRODUCT_EXTRA_COLUMNS = {
    "gallery": "TEXT NOT NULL DEFAULT '[]'",
    "edition_size": "INTEGER",
    "chase": "INTEGER NOT NULL DEFAULT 0",
    "release_date": "TEXT NOT NULL DEFAULT ''",
    "preorder": "INTEGER NOT NULL DEFAULT 0",
    "length_mm": "INTEGER",
    "links": "TEXT NOT NULL DEFAULT '[]'",
    # 0 hides the product from the shop without deleting it.
    "available": "INTEGER NOT NULL DEFAULT 1",
}
MAX_GALLERY_PHOTOS = 12
MAX_LINKS = 10
ORDER_STATUSES = ("pending", "confirmed", "shipped", "completed", "cancelled")
ORDER_TRANSITIONS = {
    "pending": {"confirmed", "cancelled"},
    "confirmed": {"shipped", "cancelled"},
    "shipped": {"completed"},
    "completed": set(),
    "cancelled": set(),
}
SALES_STATUSES = ("confirmed", "shipped", "completed")


def load_settings():
    settings = json.loads(SETTINGS_FILE.read_text(encoding="utf-8")) if SETTINGS_FILE.exists() else {}
    admin_emails = {
        email.strip().lower()
        for email in settings.get("adminEmails", []) + os.environ.get("PITSTOP_ADMIN_EMAILS", "").split(",")
        if email.strip()
    }
    shop_email = os.environ.get("PITSTOP_SHOP_EMAIL", settings.get("shopEmail", "")).strip()
    for email in admin_emails | ({shop_email} if shop_email else set()):
        if not EMAIL_PATTERN.fullmatch(email):
            raise RuntimeError(f"{email!r} in the shop settings is not a valid email address.")
    whatsapp = re.sub(r"[\s()+-]", "", str(settings.get("whatsappNumber", "")))
    if whatsapp and not re.fullmatch(r"\d{8,15}", whatsapp):
        raise RuntimeError(
            "whatsappNumber in the shop settings must be a phone number with the country code, like 60123456789."
        )
    facebook = str(settings.get("facebookUrl", "")).strip()
    if facebook:
        url = urlsplit(facebook)
        host = url.netloc.lower().removeprefix("www.").removeprefix("m.")
        if url.scheme != "https" or host not in {"facebook.com", "fb.com"} or '"' in facebook:
            raise RuntimeError("facebookUrl in the shop settings must be a https://www.facebook.com/... link.")
    return admin_emails, shop_email, whatsapp, facebook


ADMIN_EMAILS, SHOP_EMAIL, SHOP_WHATSAPP, SHOP_FACEBOOK = load_settings()

def load_secret_key():
    """Keep local sessions valid across restarts and between worker processes."""
    INSTANCE.mkdir(exist_ok=True)
    try:
        with SECRET_KEY_FILE.open("x", encoding="utf-8") as key_file:
            key_file.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    return SECRET_KEY_FILE.read_text(encoding="utf-8").strip()


app = Flask(__name__)
is_production = os.environ.get("PITSTOP_ENV", "").lower() == "production"
secret_key = os.environ.get("PITSTOP_SECRET_KEY")
if is_production and not secret_key:
    raise RuntimeError("PITSTOP_SECRET_KEY must be set in production.")
app.secret_key = secret_key or load_secret_key()
if os.environ.get("PITSTOP_TRUST_PROXY") == "1":
    # Only enable behind a reverse proxy that sets X-Forwarded-For, so
    # sign-in rate limits apply to each visitor rather than the proxy.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=is_production,
    MAX_CONTENT_LENGTH=64 * 1024,
)


@app.after_request
def set_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        # blob: lets the admin page preview a photo on this computer before it uploads.
        "default-src 'self'; img-src 'self' https: blob:; style-src 'self'; "
        "script-src 'self'; form-action 'self'; base-uri 'self'; "
        "object-src 'none'; frame-ancestors 'none'; "
        # Product pages can play videos from these two sites only.
        "frame-src https://www.youtube-nocookie.com https://player.vimeo.com"
    )
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


def connect_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db():
    INSTANCE.mkdir(exist_ok=True)
    catalog = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    with closing(connect_db()) as db, db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                make TEXT NOT NULL,
                scale TEXT NOT NULL,
                category TEXT NOT NULL,
                price REAL NOT NULL CHECK (price > 0),
                stock INTEGER NOT NULL CHECK (stock >= 0),
                best_seller INTEGER NOT NULL DEFAULT 0,
                new_arrival INTEGER NOT NULL DEFAULT 0,
                condition TEXT NOT NULL,
                image TEXT NOT NULL DEFAULT '',
                image_alt TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cart_items (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                PRIMARY KEY (user_id, product_id)
            );
            CREATE TABLE IF NOT EXISTS login_attempts (
                ip_address TEXT NOT NULL,
                attempted_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS login_attempts_by_ip
                ON login_attempts (ip_address, attempted_at);
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'shipped', 'completed', 'cancelled')),
                customer_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                address TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                subtotal REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS order_items (
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id TEXT NOT NULL,
                product_name TEXT NOT NULL,
                price REAL NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0)
            );
            CREATE TABLE IF NOT EXISTS wishlist_items (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, product_id)
            );
            CREATE TABLE IF NOT EXISTS product_alerts (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, product_id)
            );
            CREATE INDEX IF NOT EXISTS product_alerts_by_product ON product_alerts (product_id);
            CREATE INDEX IF NOT EXISTS orders_by_user ON orders (user_id, created_at);
            CREATE INDEX IF NOT EXISTS order_items_by_order ON order_items (order_id);
            """
        )
        existing_columns = {row["name"] for row in db.execute("PRAGMA table_info(products)")}
        for column, definition in PRODUCT_EXTRA_COLUMNS.items():
            if column not in existing_columns:
                db.execute(f"ALTER TABLE products ADD COLUMN {column} {definition}")
        if "spin_frames" in existing_columns:
            # The 360° photo spin was removed.
            db.execute("ALTER TABLE products DROP COLUMN spin_frames")
        if ADMIN_EMAILS:
            placeholders = ", ".join("?" for _ in ADMIN_EMAILS)
            db.execute(
                f"UPDATE users SET role = 'admin' WHERE lower(email) IN ({placeholders})",
                tuple(ADMIN_EMAILS),
            )
        if db.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
            db.executemany(
                f"INSERT INTO products ({', '.join(PRODUCT_COLUMNS)}) "
                f"VALUES ({', '.join('?' for _ in PRODUCT_COLUMNS)})",
                [product_row({**PRODUCT_EXTRA_DEFAULTS, **product}) for product in catalog["products"]],
            )


PRODUCT_COLUMNS = (
    "id", "name", "make", "scale", "category", "price", "stock", "best_seller",
    "new_arrival", "condition", "image", "image_alt", "description",
    "gallery", "edition_size", "chase", "release_date", "preorder", "length_mm", "links", "available",
)


def product_row(product):
    """Database values for PRODUCT_COLUMNS, in order, from a product payload."""
    return (
        product["id"], product["name"], product["make"], product["scale"],
        product["category"], product["price"], product["stock"],
        int(product["bestSeller"]), int(product["newArrival"]), product["condition"],
        product["image"], product["imageAlt"], product["description"],
        json.dumps(product["gallery"]),
        product["editionSize"], int(product["chase"]), product["releaseDate"],
        int(product["preorder"]), product["lengthMm"], json.dumps(product["links"]),
        int(product["available"]),
    )


def current_user():
    user_id = session.get("user_id")
    if user_id is None:
        return None
    return get_db().execute(
        "SELECT id, name, email, role FROM users WHERE id = ?", (user_id,)
    ).fetchone()


def require_user(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            return jsonify(error="Sign in to continue.", code="authentication_required"), 401
        return view(*args, **kwargs)
    return wrapped


def require_admin(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify(error="Sign in to continue.", code="authentication_required"), 401
        if user["role"] != "admin":
            return jsonify(error="Administrator access is required."), 403
        return view(*args, **kwargs)
    return wrapped


def user_payload(user):
    return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]}


def product_payload(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "make": row["make"],
        "scale": row["scale"],
        "category": row["category"],
        "price": row["price"],
        "stock": row["stock"],
        "bestSeller": bool(row["best_seller"]),
        "newArrival": bool(row["new_arrival"]),
        "condition": row["condition"],
        "image": row["image"],
        "imageAlt": row["image_alt"],
        "description": row["description"],
        "gallery": json.loads(row["gallery"]),
        "editionSize": row["edition_size"],
        "chase": bool(row["chase"]),
        "releaseDate": row["release_date"],
        "preorder": bool(row["preorder"]),
        "lengthMm": row["length_mm"],
        "links": json.loads(row["links"]),
        "available": bool(row["available"]),
    }


def is_valid_image_path(value):
    """An HTTPS URL or a path inside the images folder."""
    try:
        url = urlsplit(value)
    except ValueError:
        return False
    return not (
        url.scheme not in {"", "https"}
        or url.scheme == "https" and not url.netloc
        or url.netloc and url.scheme != "https"
        or not url.scheme and not url.path.lstrip("/").startswith("images/")
        or value.startswith("//")
        or ".." in Path(url.path).parts
        or any(ord(character) < 32 for character in value)
    )


def optional_whole_number(value, low, high):
    """Returns (number_or_None, ok)."""
    if value is None or value == "":
        return None, True
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        return None, False
    return value, True


def validate_collector_details(data, values):
    gallery = data.get("gallery", [])
    if not isinstance(gallery, list) or len(gallery) > MAX_GALLERY_PHOTOS:
        return f"Add up to {MAX_GALLERY_PHOTOS} gallery photos."
    values["gallery"] = []
    for photo in gallery:
        if (
            not isinstance(photo, dict)
            or set(photo) - {"src", "label"}
            or not isinstance(photo.get("src"), str)
            or not isinstance(photo.get("label", ""), str)
            or len(photo["src"]) > 500
            or len(photo.get("label", "")) > 60
        ):
            return "Each gallery photo needs a path and a short label (up to 60 characters)."
        src = photo["src"].strip()
        if not src or not is_valid_image_path(src):
            return "Gallery photos must be HTTPS URLs or paths in the images folder."
        values["gallery"].append({"src": src, "label": photo.get("label", "").strip()})

    values["editionSize"], ok = optional_whole_number(data.get("editionSize"), 1, 1_000_000)
    if not ok:
        return "Edition size must be a whole number between 1 and 1,000,000, or empty."
    values["lengthMm"], ok = optional_whole_number(data.get("lengthMm"), 10, 2000)
    if not ok:
        return "Model length must be between 10 and 2000 mm, or empty."

    values["available"] = data.get("available", True)
    if not isinstance(values["available"], bool):
        return "Set available to true or false."
    for field in ("chase", "preorder"):
        value = data.get(field, False)
        if not isinstance(value, bool):
            return f"Set {field} to true or false."
        values[field] = value

    release_date = data.get("releaseDate", "") or ""
    if not isinstance(release_date, str):
        return "Enter the release date as YYYY-MM-DD."
    release_date = release_date.strip()
    if release_date:
        try:
            release_date = datetime.strptime(release_date, "%Y-%m-%d").date().isoformat()
        except ValueError:
            return "Enter the release date as YYYY-MM-DD."
    values["releaseDate"] = release_date

    links = data.get("links", [])
    if not isinstance(links, list) or len(links) > MAX_LINKS:
        return f"Add up to {MAX_LINKS} videos and links."
    values["links"] = []
    for link in links:
        if (
            not isinstance(link, dict)
            or set(link) - {"url", "title"}
            or not isinstance(link.get("url"), str)
            or not isinstance(link.get("title", ""), str)
            or len(link["url"]) > 500
            or len(link.get("title", "")) > 100
        ):
            return "Each link needs a web address and a short title (up to 100 characters)."
        url = link["url"].strip()
        if not is_safe_web_link(url):
            return "Links must be full web addresses starting with https://"
        values["links"].append({"url": url, "title": link.get("title", "").strip()})
    return None


def is_safe_web_link(value):
    """An https:// address with a real host; nothing a browser would run as code."""
    try:
        url = urlsplit(value)
    except ValueError:
        return False
    return (
        url.scheme == "https"
        and bool(url.hostname)
        and "." in url.hostname
        and not any(ord(character) < 33 for character in value)
    )


def validate_product(data, product_id=None):
    if not isinstance(data, dict):
        return None, "Enter product details."
    if product_id is None:
        product_id = data.get("id")
        if not isinstance(product_id, str) or not PRODUCT_ID_PATTERN.fullmatch(product_id):
            return None, "Use a product ID with lowercase letters, numbers, and hyphens."
    allowed = PRODUCT_FIELDS | set(PRODUCT_EXTRA_DEFAULTS) | ({"id"} if "id" in data else set())
    if set(data) - allowed:
        return None, "The product contains unsupported fields."
    values = {field: data.get(field) for field in PRODUCT_FIELDS}
    for field, max_length in (
        ("name", 120), ("make", 80), ("scale", 40), ("category", 40),
        ("condition", 80), ("description", 500),
    ):
        value = values[field]
        if not isinstance(value, str) or not value.strip() or len(value.strip()) > max_length:
            return None, f"Enter a valid {field.replace('_', ' ')}."
        values[field] = value.strip()
    price = values["price"]
    stock = values["stock"]
    if (
        isinstance(price, bool)
        or not isinstance(price, (int, float))
        or isinstance(stock, bool)
        or not isinstance(stock, int)
    ):
        return None, "Enter a valid price and stock count."
    values["price"] = float(price)
    values["stock"] = stock
    if (
        not math.isfinite(values["price"])
        or values["price"] <= 0
        or values["price"] > 1_000_000
        or values["stock"] < 0
        or values["stock"] > 1_000_000
    ):
        return None, "Price must be positive and stock cannot be negative."
    for field in ("bestSeller", "newArrival"):
        if not isinstance(values[field], bool):
            return None, f"Set {field} to true or false."
    for field, max_length in (("image", 2000), ("imageAlt", 200)):
        value = values[field]
        if not isinstance(value, str) or len(value) > max_length:
            return None, f"Enter a valid {field}."
        values[field] = value.strip()
    if values["image"] and not is_valid_image_path(values["image"]):
        return None, "Use a secure HTTPS photo URL or a path in the images folder, like images/car.jpg."
    error = validate_collector_details(data, values)
    if error:
        return None, error
    values["id"] = product_id
    return values, None


@app.before_request
def check_csrf():
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.path.startswith("/api/"):
        expected = session.get("csrf_token", "")
        supplied = request.headers.get("X-CSRF-Token", "")
        if not expected or not secrets.compare_digest(expected, supplied):
            return jsonify(error="Your session expired. Refresh the page and try again."), 400
    return None


@app.teardown_appcontext
def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def get_db():
    if "db" not in g:
        g.db = connect_db()
    return g.db


@app.get("/")
def home_page():
    return html_page("index")


FACEBOOK_ICON = (
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    '<path d="M14 8.5h2.5V5H14a3.5 3.5 0 0 0-3.5 3.5V11H8v3.5h2.5V21H14v-6.5h2.5L17 11h-3V9a.5.5 0 0 1 .5-.5Z"></path></svg>'
)
DEFAULT_SHARE_IMAGE = "images/logo/pitstop-logo.png"


def absolute_url(path):
    return path if path.startswith("https://") else request.url_root + path.lstrip("/")


def share_meta(page_html, page):
    """Link-preview tags so Facebook, WhatsApp and Instagram show a proper card."""
    title = re.search(r"<title>(.*?)</title>", page_html, re.S)
    description = re.search(r'<meta name="description" content="([^"]*)"', page_html)
    meta = {
        "og:site_name": "PitStop.co",
        "og:type": "website",
        "og:title": html.unescape(title.group(1)) if title else "PitStop.co",
        "og:description": html.unescape(description.group(1)) if description else "",
        "og:url": request.url,
        "og:image": absolute_url(DEFAULT_SHARE_IMAGE),
    }
    if page == "product":
        row = get_db().execute(
            "SELECT * FROM products WHERE id = ? AND available = 1", (request.args.get("id", ""),)
        ).fetchone()
        if row is not None:
            product = product_payload(row)
            if product["preorder"]:
                status = "Pre-order"
            elif product["stock"] > 0:
                status = "In stock"
            else:
                status = "Sold out"
            summary = f"RM{product['price']:.2f} · {status} · {product['make']} {product['scale']}"
            details = product["description"].strip()
            meta.update({
                "og:type": "product",
                "og:title": f"{product['name']} | PitStop.co",
                "og:description": f"{summary}. {details}"[:300] if details else summary,
            })
            if product["image"]:
                meta["og:image"] = absolute_url(product["image"])
            page_html = page_html.replace(title.group(0), f"<title>{escape(meta['og:title'])}</title>", 1) if title else page_html
    meta["twitter:card"] = "summary_large_image"
    tags = "".join(
        f'    <meta {"name" if key.startswith("twitter:") else "property"}="{key}" content="{escape(value)}">\n'
        for key, value in meta.items()
    )
    return page_html.replace("  </head>", tags + "  </head>", 1)


def social_links(page_html):
    if not SHOP_FACEBOOK:
        return page_html
    link = (
        f'<a class="footer-facebook" href="{escape(SHOP_FACEBOOK)}" target="_blank" rel="noopener noreferrer">'
        f"{FACEBOOK_ICON}Facebook</a>"
    )
    return page_html.replace("<!-- facebook-link -->", link)


@app.get("/<page>.html")
def html_page(page):
    allowed = {"index", "diecast", "product", "about", "contact", "login", "register", "profile", "admin"}
    if page not in allowed:
        abort(404)
    page_html = (ROOT / f"{page}.html").read_text(encoding="utf-8")
    page_html = social_links(share_meta(page_html, page))
    response = app.response_class(page_html, mimetype="text/html")
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/scripts/<path:filename>")
def script_file(filename):
    return send_from_directory(ROOT / "scripts", filename)


@app.get("/styles/<path:filename>")
def stylesheet_file(filename):
    return send_from_directory(ROOT / "styles", filename)


@app.get("/images/<path:filename>")
def image_file(filename):
    return send_from_directory(IMAGES, filename)


@app.get("/api/csrf")
def get_csrf():
    token = session.setdefault("csrf_token", secrets.token_urlsafe(32))
    return jsonify(token=token)


@app.get("/api/me")
def get_me():
    user = current_user()
    return jsonify(user=user_payload(user) if user is not None else None)


@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    name = data.get("name", "")
    email = data.get("email", "")
    password = data.get("password", "")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        return jsonify(error="Enter your name (up to 80 characters)."), 400
    if not isinstance(email, str) or len(email) > 254 or not EMAIL_PATTERN.fullmatch(email.strip()):
        return jsonify(error="Enter a valid email address."), 400
    if not isinstance(password, str) or len(password) < 10 or len(password) > 128:
        return jsonify(error="Use a password between 10 and 128 characters."), 400
    db = get_db()
    normalized_email = email.strip().lower()
    try:
        cursor = db.execute(
            "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                name.strip(),
                normalized_email,
                generate_password_hash(password),
                "admin" if normalized_email in ADMIN_EMAILS else "customer",
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify(error="An account with that email already exists."), 409
    session.clear()
    session["user_id"] = cursor.lastrowid
    session["csrf_token"] = secrets.token_urlsafe(32)
    user = db.execute(
        "SELECT id, name, email, role FROM users WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return jsonify(user=user_payload(user)), 201


@app.post("/api/login")
def login():
    ip_address = request.remote_addr or "unknown"
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    db.execute("DELETE FROM login_attempts WHERE attempted_at < ?", (cutoff,))
    attempts = db.execute(
        "SELECT COUNT(*) FROM login_attempts WHERE ip_address = ? AND attempted_at >= ?",
        (ip_address, cutoff),
    ).fetchone()[0]
    if attempts >= 8:
        return jsonify(error="Too many sign-in attempts. Wait 15 minutes and try again."), 429

    data = request.get_json(silent=True) or {}
    email = data.get("email", "")
    password = data.get("password", "")
    user = None
    if isinstance(email, str) and isinstance(password, str):
        user = db.execute(
            "SELECT id, name, email, role, password_hash FROM users WHERE email = ? COLLATE NOCASE",
            (email.strip(),),
        ).fetchone()
    if user is None or not check_password_hash(user["password_hash"], password):
        db.execute(
            "INSERT INTO login_attempts (ip_address, attempted_at) VALUES (?, ?)",
            (ip_address, datetime.now(timezone.utc).isoformat()),
        )
        db.commit()
        return jsonify(error="Email or password is incorrect."), 401
    db.execute("DELETE FROM login_attempts WHERE ip_address = ?", (ip_address,))
    db.commit()
    session.clear()
    session["user_id"] = user["id"]
    session["csrf_token"] = secrets.token_urlsafe(32)
    return jsonify(user=user_payload(user))


@app.post("/api/logout")
@require_user
def logout():
    session.clear()
    return jsonify(ok=True)


@app.patch("/api/profile")
@require_user
def update_profile():
    data = request.get_json(silent=True) or {}
    name = data.get("name", "")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        return jsonify(error="Enter your name (up to 80 characters)."), 400
    user_id = session["user_id"]
    get_db().execute("UPDATE users SET name = ? WHERE id = ?", (name.strip(), user_id))
    get_db().commit()
    return jsonify(user=user_payload(current_user()))


@app.get("/api/products")
def list_products():
    db = get_db()
    products = [
        product_payload(row)
        for row in db.execute("SELECT * FROM products WHERE available = 1 ORDER BY name COLLATE NOCASE")
    ]
    catalog = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    brands = list(dict.fromkeys(catalog["brands"] + [product["make"] for product in products]))
    categories = list(dict.fromkeys(catalog["categories"] + [product["category"] for product in products]))
    return jsonify(
        products=products, brands=brands, categories=categories,
        shopEmail=SHOP_EMAIL, whatsapp=SHOP_WHATSAPP, facebook=SHOP_FACEBOOK,
    )


@app.get("/api/cart")
@require_user
def get_cart():
    rows = get_db().execute(
        """
        SELECT ci.quantity, p.*
        FROM cart_items ci
        JOIN products p ON p.id = ci.product_id
        WHERE ci.user_id = ? AND p.available = 1
        ORDER BY p.name COLLATE NOCASE
        """,
        (session["user_id"],),
    )
    return jsonify(items=[
        {"quantity": row["quantity"], "product": product_payload(row)}
        for row in rows
    ])


@app.put("/api/cart/<product_id>")
@require_user
def update_cart_item(product_id):
    data = request.get_json(silent=True) or {}
    quantity = data.get("quantity")
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 0:
        return jsonify(error="Choose a valid quantity."), 400
    db = get_db()
    product = db.execute(
        "SELECT stock, preorder FROM products WHERE id = ? AND available = 1", (product_id,)
    ).fetchone()
    if product is None:
        return jsonify(error="That model is no longer available."), 404
    if quantity > 0 and product["preorder"]:
        return jsonify(error="This model isn't released yet. Join the pre-order list instead."), 409
    if quantity > product["stock"]:
        return jsonify(error="There is not enough stock for that quantity."), 409
    if quantity == 0:
        db.execute(
            "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?",
            (session["user_id"], product_id),
        )
    else:
        db.execute(
            """
            INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)
            ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = excluded.quantity
            """,
            (session["user_id"], product_id, quantity),
        )
    db.commit()
    return get_cart()


def wishlist_response(user_id):
    rows = get_db().execute(
        """
        SELECT p.* FROM wishlist_items w JOIN products p ON p.id = w.product_id
        WHERE w.user_id = ? AND p.available = 1 ORDER BY w.created_at DESC
        """,
        (user_id,),
    )
    return jsonify(items=[product_payload(row) for row in rows])


@app.get("/api/wishlist")
@require_user
def get_wishlist():
    return wishlist_response(session["user_id"])


@app.put("/api/wishlist/<product_id>")
@require_user
def add_to_wishlist(product_id):
    db = get_db()
    if db.execute("SELECT 1 FROM products WHERE id = ? AND available = 1", (product_id,)).fetchone() is None:
        return jsonify(error="That model is no longer available."), 404
    db.execute(
        "INSERT OR IGNORE INTO wishlist_items (user_id, product_id, created_at) VALUES (?, ?, ?)",
        (session["user_id"], product_id, datetime.now(timezone.utc).isoformat()),
    )
    db.commit()
    return wishlist_response(session["user_id"])


@app.delete("/api/wishlist/<product_id>")
@require_user
def remove_from_wishlist(product_id):
    db = get_db()
    db.execute(
        "DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?",
        (session["user_id"], product_id),
    )
    db.commit()
    return wishlist_response(session["user_id"])


def alerts_response(user_id):
    rows = get_db().execute(
        """
        SELECT a.created_at AS alert_created_at, p.* FROM product_alerts a
        JOIN products p ON p.id = a.product_id
        WHERE a.user_id = ? AND p.available = 1 ORDER BY a.created_at DESC
        """,
        (user_id,),
    )
    items = []
    for row in rows:
        product = product_payload(row)
        items.append({
            "product": product,
            "kind": "preorder" if product["preorder"] else "restock",
            # Ready once the model can be bought: released and back on the shelf.
            "ready": product["stock"] > 0 and not product["preorder"],
            "createdAt": row["alert_created_at"],
        })
    return jsonify(items=items)


@app.get("/api/alerts")
@require_user
def get_alerts():
    return alerts_response(session["user_id"])


@app.put("/api/alerts/<product_id>")
@require_user
def add_alert(product_id):
    db = get_db()
    product = db.execute(
        "SELECT stock, preorder FROM products WHERE id = ? AND available = 1", (product_id,)
    ).fetchone()
    if product is None:
        return jsonify(error="That model is no longer available."), 404
    if product["stock"] > 0 and not product["preorder"]:
        return jsonify(error="This model is in stock now. Add it to your bag instead."), 409
    db.execute(
        "INSERT OR IGNORE INTO product_alerts (user_id, product_id, created_at) VALUES (?, ?, ?)",
        (session["user_id"], product_id, datetime.now(timezone.utc).isoformat()),
    )
    db.commit()
    return alerts_response(session["user_id"])


@app.delete("/api/alerts/<product_id>")
@require_user
def remove_alert(product_id):
    db = get_db()
    db.execute(
        "DELETE FROM product_alerts WHERE user_id = ? AND product_id = ?",
        (session["user_id"], product_id),
    )
    db.commit()
    return alerts_response(session["user_id"])


def order_payloads(db, rows, include_customer=False):
    orders = [dict(row) for row in rows]
    items_by_order = {order["id"]: [] for order in orders}
    if orders:
        placeholders = ", ".join("?" for _ in orders)
        for item in db.execute(
            f"SELECT * FROM order_items WHERE order_id IN ({placeholders}) ORDER BY rowid",
            tuple(items_by_order),
        ):
            items_by_order[item["order_id"]].append({
                "productId": item["product_id"],
                "name": item["product_name"],
                "price": item["price"],
                "quantity": item["quantity"],
            })
    payloads = []
    for order in orders:
        payload = {
            "id": order["id"],
            "status": order["status"],
            "name": order["customer_name"],
            "phone": order["phone"],
            "address": order["address"],
            "note": order["note"],
            "subtotal": order["subtotal"],
            "createdAt": order["created_at"],
            "updatedAt": order["updated_at"],
            "items": items_by_order[order["id"]],
        }
        if include_customer:
            payload["email"] = order["email"]
            payload["nextStatuses"] = sorted(
                ORDER_TRANSITIONS[order["status"]], key=ORDER_STATUSES.index
            )
        payloads.append(payload)
    return payloads


@app.get("/api/orders")
@require_user
def list_my_orders():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", (session["user_id"],)
    ).fetchall()
    return jsonify(orders=order_payloads(db, rows))


@app.post("/api/orders")
@require_user
def place_order():
    data = request.get_json(silent=True) or {}
    details = {}
    for field, max_length, required in (
        ("name", 80, True), ("phone", 30, True), ("address", 500, True), ("note", 500, False),
    ):
        value = data.get(field, "")
        if not isinstance(value, str) or len(value.strip()) > max_length or (required and not value.strip()):
            label = {"name": "your name", "phone": "a phone number", "address": "a shipping address",
                     "note": "a shorter note"}[field]
            return jsonify(error=f"Enter {label}."), 400
        details[field] = value.strip()
    if not re.fullmatch(r"[0-9+()\-\s]{6,30}", details["phone"]):
        return jsonify(error="Enter a valid phone number."), 400

    db = get_db()
    user_id = session["user_id"]
    db.execute("BEGIN IMMEDIATE")
    try:
        items = db.execute(
            """
            SELECT ci.quantity, p.id, p.name, p.price, p.stock, p.preorder
            FROM cart_items ci JOIN products p ON p.id = ci.product_id
            WHERE ci.user_id = ? AND p.available = 1 ORDER BY p.name COLLATE NOCASE
            """,
            (user_id,),
        ).fetchall()
        if not items:
            db.rollback()
            return jsonify(error="Your bag is empty."), 400
        for item in items:
            if item["preorder"]:
                db.rollback()
                return jsonify(
                    error=f"{item['name']} isn't released yet. Remove it from your bag and try again."
                ), 409
            if item["quantity"] > item["stock"]:
                db.rollback()
                return jsonify(
                    error=f"Only {item['stock']} of {item['name']} left. Update your bag and try again."
                ), 409
        now = datetime.now(timezone.utc).isoformat()
        subtotal = round(sum(item["price"] * item["quantity"] for item in items), 2)
        cursor = db.execute(
            """
            INSERT INTO orders (user_id, customer_name, phone, address, note, subtotal, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, details["name"], details["phone"], details["address"], details["note"],
             subtotal, now, now),
        )
        order_id = cursor.lastrowid
        for item in items:
            db.execute("UPDATE products SET stock = stock - ? WHERE id = ?", (item["quantity"], item["id"]))
            db.execute(
                "INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, ?, ?, ?, ?)",
                (order_id, item["id"], item["name"], item["price"], item["quantity"]),
            )
        db.execute("DELETE FROM cart_items WHERE user_id = ?", (user_id,))
        # The customer got what they were waiting for.
        db.executemany(
            "DELETE FROM product_alerts WHERE user_id = ? AND product_id = ?",
            [(user_id, item["id"]) for item in items],
        )
        # Bags of other customers may now ask for more than is left.
        db.execute(
            """
            DELETE FROM cart_items
            WHERE quantity > (SELECT stock FROM products WHERE products.id = cart_items.product_id)
            """
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    order = db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchall()
    return jsonify(order=order_payloads(db, order)[0]), 201


@app.get("/api/admin/dashboard")
@require_admin
def admin_dashboard():
    db = get_db()
    status_counts = dict.fromkeys(ORDER_STATUSES, 0)
    for row in db.execute("SELECT status, COUNT(*) AS total FROM orders GROUP BY status"):
        status_counts[row["status"]] = row["total"]
    sales_placeholders = ", ".join("?" for _ in SALES_STATUSES)
    month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    sales = db.execute(
        f"SELECT COALESCE(SUM(subtotal), 0) FROM orders WHERE status IN ({sales_placeholders})",
        SALES_STATUSES,
    ).fetchone()[0]
    sales_30_days = db.execute(
        f"""
        SELECT COALESCE(SUM(subtotal), 0) FROM orders
        WHERE status IN ({sales_placeholders}) AND created_at >= ?
        """,
        (*SALES_STATUSES, month_ago),
    ).fetchone()[0]
    orders_30_days = db.execute(
        "SELECT COUNT(*) FROM orders WHERE status != 'cancelled' AND created_at >= ?", (month_ago,)
    ).fetchone()[0]
    stock = db.execute(
        """
        SELECT COUNT(*) AS products, COALESCE(SUM(stock), 0) AS units,
            COALESCE(SUM(price * stock), 0) AS value, COALESCE(SUM(stock = 0), 0) AS sold_out
        FROM products
        """
    ).fetchone()
    stock_alerts = db.execute(
        "SELECT * FROM products WHERE stock <= 2 ORDER BY stock, name COLLATE NOCASE LIMIT 8"
    ).fetchall()
    top_products = db.execute(
        """
        SELECT oi.product_name AS name, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.price) AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status != 'cancelled'
        GROUP BY oi.product_id ORDER BY units DESC, revenue DESC LIMIT 5
        """
    ).fetchall()
    recent = db.execute(
        "SELECT o.*, u.email FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 5"
    ).fetchall()
    waitlists = []
    for row in db.execute(
        """
        SELECT p.*, COUNT(*) AS waiting FROM product_alerts a JOIN products p ON p.id = a.product_id
        GROUP BY p.id ORDER BY waiting DESC, p.name COLLATE NOCASE LIMIT 8
        """
    ).fetchall():
        emails = [
            entry["email"] for entry in db.execute(
                """
                SELECT u.email FROM product_alerts a JOIN users u ON u.id = a.user_id
                WHERE a.product_id = ? ORDER BY a.created_at
                """,
                (row["id"],),
            )
        ]
        waitlists.append({"product": product_payload(row), "waiting": row["waiting"], "emails": emails})
    return jsonify(
        sales=round(sales, 2),
        sales30Days=round(sales_30_days, 2),
        orders30Days=orders_30_days,
        statusCounts=status_counts,
        customers=db.execute("SELECT COUNT(*) FROM users WHERE role = 'customer'").fetchone()[0],
        unitsInBags=db.execute("SELECT COALESCE(SUM(quantity), 0) FROM cart_items").fetchone()[0],
        products=stock["products"],
        unitsInStock=stock["units"],
        stockValue=round(stock["value"], 2),
        soldOut=stock["sold_out"],
        stockAlerts=[product_payload(row) for row in stock_alerts],
        topProducts=[dict(row) for row in top_products],
        recentOrders=order_payloads(db, recent, include_customer=True),
        waitlists=waitlists,
    )


@app.get("/api/admin/orders")
@require_admin
def admin_list_orders():
    status = request.args.get("status", "all")
    db = get_db()
    query = "SELECT o.*, u.email FROM orders o LEFT JOIN users u ON u.id = o.user_id"
    parameters = ()
    if status in ORDER_STATUSES:
        query += " WHERE o.status = ?"
        parameters = (status,)
    rows = db.execute(f"{query} ORDER BY o.created_at DESC LIMIT 200", parameters).fetchall()
    return jsonify(orders=order_payloads(db, rows, include_customer=True))


@app.patch("/api/admin/orders/<int:order_id>")
@require_admin
def admin_update_order(order_id):
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        order = db.execute("SELECT status FROM orders WHERE id = ?", (order_id,)).fetchone()
        if order is None:
            db.rollback()
            return jsonify(error="That order was not found."), 404
        if status not in ORDER_TRANSITIONS[order["status"]]:
            db.rollback()
            return jsonify(error=f"A {order['status']} order cannot be marked {status}."), 409
        if status == "cancelled":
            # Return the units to the shelf; skipped for products deleted since.
            db.execute(
                """
                UPDATE products SET stock = stock + (
                    SELECT SUM(quantity) FROM order_items
                    WHERE order_id = ? AND product_id = products.id
                )
                WHERE id IN (SELECT product_id FROM order_items WHERE order_id = ?)
                """,
                (order_id, order_id),
            )
        db.execute(
            "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
            (status, datetime.now(timezone.utc).isoformat(), order_id),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    rows = db.execute(
        "SELECT o.*, u.email FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?",
        (order_id,),
    ).fetchall()
    return jsonify(order=order_payloads(db, rows, include_customer=True)[0])


@app.get("/api/admin/products")
@require_admin
def admin_list_products():
    rows = get_db().execute("SELECT * FROM products ORDER BY name COLLATE NOCASE")
    return jsonify(products=[product_payload(row) for row in rows])


def choice_key(value):
    """'minigt', 'Mini-GT' and 'MINI GT' share a key; so do '1:64' and '1:64 scale'."""
    return re.sub(r"[^a-z0-9:]", "", value.lower().replace("scale", ""))


def use_existing_spellings(product, exclude_id=None):
    """Reuse the shop's existing spelling for brand, category, scale, and condition."""
    catalog = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    known = {
        "make": list(catalog.get("brands", [])),
        "category": list(catalog.get("categories", [])),
        "scale": [],
        "condition": [],
    }
    for row in get_db().execute(
        "SELECT make, category, scale, condition FROM products WHERE id IS NOT ?", (exclude_id,)
    ):
        for field in known:
            known[field].append(row[field])
    for field, values in known.items():
        key = choice_key(product[field])
        if not key:
            continue
        match = next((value for value in values if choice_key(value) == key), None)
        if match:
            product[field] = match


@app.post("/api/admin/products")
@require_admin
def admin_create_product():
    data = request.get_json(silent=True) or {}
    product, error = validate_product(data)
    if error:
        return jsonify(error=error), 400
    use_existing_spellings(product)
    try:
        get_db().execute(
            f"INSERT INTO products ({', '.join(PRODUCT_COLUMNS)}) "
            f"VALUES ({', '.join('?' for _ in PRODUCT_COLUMNS)})",
            product_row(product),
        )
        get_db().commit()
    except sqlite3.IntegrityError:
        return jsonify(error="A product with that ID already exists."), 409
    return jsonify(product=product), 201


@app.patch("/api/admin/products/<product_id>")
@require_admin
def admin_update_product(product_id):
    data = request.get_json(silent=True) or {}
    product, error = validate_product(data, product_id)
    if error:
        return jsonify(error=error), 400
    # Leave this product out, so its own old spelling can still be corrected.
    use_existing_spellings(product, exclude_id=product_id)
    return save_product(product_id, product)


# Fields the product list can change in one click, without the full form.
QUICK_FIELDS = {"stock", "preorder", "bestSeller", "newArrival", "chase", "available"}


@app.patch("/api/admin/products/<product_id>/quick")
@require_admin
def admin_quick_update_product(product_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data or set(data) - QUICK_FIELDS:
        return jsonify(error="Only stock and status can be changed here."), 400
    row = get_db().execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    if row is None:
        return jsonify(error="That product was not found."), 404
    current = product_payload(row)
    current.pop("id")
    product, error = validate_product({**current, **data}, product_id)
    if error:
        return jsonify(error=error), 400
    return save_product(product_id, product)


def save_product(product_id, product):
    db = get_db()
    before = db.execute(
        "SELECT stock, preorder, available FROM products WHERE id = ?", (product_id,)
    ).fetchone()
    if before is None:
        return jsonify(error="That product was not found."), 404
    was_ready = before["stock"] > 0 and not before["preorder"] and before["available"]
    columns = PRODUCT_COLUMNS[1:]
    cursor = db.execute(
        f"UPDATE products SET {', '.join(f'{column} = ?' for column in columns)} WHERE id = ?",
        (*product_row(product)[1:], product_id),
    )
    if cursor.rowcount == 0:
        return jsonify(error="That product was not found."), 404
    db.execute(
        "DELETE FROM cart_items WHERE product_id = ? AND (quantity > ? OR ? OR ?)",
        (product_id, product["stock"], int(product["preorder"]), int(not product["available"])),
    )
    waiting = db.execute(
        "SELECT COUNT(*) FROM product_alerts WHERE product_id = ?", (product_id,)
    ).fetchone()[0]
    db.commit()
    ready = product["stock"] > 0 and not product["preorder"] and product["available"]
    # Customers on the list now see "Back in stock" or "Out now" in their alerts.
    return jsonify(product=product, waitingNotified=waiting if ready and not was_ready else 0)


UPLOADS = IMAGES / "uploads"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Recognised by their first bytes, never by the file name the browser sends.
# SVG is left out on purpose: it can carry scripts.
IMAGE_SIGNATURES = (
    (b"\xff\xd8\xff", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
)


def detect_image_type(head):
    for signature, extension in IMAGE_SIGNATURES:
        if head.startswith(signature):
            return extension
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


@app.post("/api/admin/uploads")
@require_admin
def admin_upload_image():
    # Photos are much larger than the JSON limit that guards every other endpoint.
    request.max_content_length = MAX_UPLOAD_BYTES + 64 * 1024
    upload = request.files.get("photo")
    if upload is None or not upload.filename:
        return jsonify(error="Choose a photo to upload."), 400
    data = upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return jsonify(error="That photo is over 10 MB. Use a smaller one."), 413
    extension = detect_image_type(data[:16])
    if extension is None:
        return jsonify(error="Upload a JPG, PNG, WebP, or GIF photo."), 400
    UPLOADS.mkdir(parents=True, exist_ok=True)
    filename = f"{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(8)}.{extension}"
    (UPLOADS / filename).write_bytes(data)
    return jsonify(path=f"images/uploads/{filename}"), 201


@app.errorhandler(413)
def too_large(_error):
    return jsonify(error="That file is too large."), 413


@app.delete("/api/admin/products/<product_id>")
@require_admin
def admin_delete_product(product_id):
    db = get_db()
    cursor = db.execute("DELETE FROM products WHERE id = ?", (product_id,))
    if cursor.rowcount == 0:
        return jsonify(error="That product was not found."), 404
    db.commit()
    return jsonify(ok=True)


def create_admin():
    init_db()
    email = input("Administrator email: ").strip().lower()
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        raise SystemExit("Enter a valid email address.")
    password = getpass("Administrator password (10+ characters): ")
    confirmation = getpass("Confirm password: ")
    if len(password) < 10 or len(password) > 128:
        raise SystemExit("The password must be between 10 and 128 characters.")
    if password != confirmation:
        raise SystemExit("Passwords did not match.")
    with closing(connect_db()) as db, db:
        try:
            db.execute(
                "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
                (
                    email.split("@", 1)[0],
                    email,
                    generate_password_hash(password),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            db.commit()
        except sqlite3.IntegrityError as error:
            raise SystemExit("An account with that email already exists.") from error
    print("Administrator account created.")


def reset_password():
    """Set a new password for an existing account from the command line."""
    init_db()
    email = input("Account email: ").strip().lower()
    with closing(connect_db()) as db, db:
        user = db.execute("SELECT id FROM users WHERE email = ? COLLATE NOCASE", (email,)).fetchone()
        if user is None:
            raise SystemExit("No account uses that email address.")
        password = getpass("New password (10+ characters): ")
        confirmation = getpass("Confirm new password: ")
        if len(password) < 10 or len(password) > 128:
            raise SystemExit("The password must be between 10 and 128 characters.")
        if password != confirmation:
            raise SystemExit("Passwords did not match.")
        db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (generate_password_hash(password), user["id"]),
        )
        # A reset also lifts any sign-in lockout from earlier wrong guesses.
        db.execute("DELETE FROM login_attempts")
    print("Password updated. You can sign in with the new password now.")


def main():
    parser = argparse.ArgumentParser(description="Run or administer the PitStop.co storefront.")
    parser.add_argument(
        "command", nargs="?", choices=("run", "create-admin", "reset-password"), default="run"
    )
    arguments = parser.parse_args()
    init_db()
    if arguments.command == "create-admin":
        create_admin()
        return
    if arguments.command == "reset-password":
        reset_password()
        return
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)


init_db()


if __name__ == "__main__":
    main()
