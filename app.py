import argparse
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
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash


ROOT = Path(__file__).resolve().parent
INSTANCE = ROOT / "instance"
DATABASE = INSTANCE / "pitstop.sqlite3"
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
    return admin_emails, shop_email


ADMIN_EMAILS, SHOP_EMAIL = load_settings()

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
        "default-src 'self'; img-src 'self' https:; style-src 'self'; "
        "script-src 'self'; form-action 'self'; base-uri 'self'; "
        "object-src 'none'; frame-ancestors 'none'"
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
            CREATE INDEX IF NOT EXISTS orders_by_user ON orders (user_id, created_at);
            CREATE INDEX IF NOT EXISTS order_items_by_order ON order_items (order_id);
            """
        )
        if ADMIN_EMAILS:
            placeholders = ", ".join("?" for _ in ADMIN_EMAILS)
            db.execute(
                f"UPDATE users SET role = 'admin' WHERE lower(email) IN ({placeholders})",
                tuple(ADMIN_EMAILS),
            )
        if db.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
            db.executemany(
                """
                INSERT INTO products (
                    id, name, make, scale, category, price, stock, best_seller,
                    new_arrival, condition, image, image_alt, description
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        product["id"], product["name"], product["make"],
                        product["scale"], product["category"], product["price"],
                        product["stock"], int(product["bestSeller"]),
                        int(product["newArrival"]), product["condition"],
                        product["image"], product["imageAlt"], product["description"],
                    )
                    for product in catalog["products"]
                ],
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
    }


def validate_product(data, product_id=None):
    if not isinstance(data, dict):
        return None, "Enter product details."
    if product_id is None:
        product_id = data.get("id")
        if not isinstance(product_id, str) or not PRODUCT_ID_PATTERN.fullmatch(product_id):
            return None, "Use a product ID with lowercase letters, numbers, and hyphens."
    if set(data) - PRODUCT_FIELDS - ({"id"} if "id" in data else set()):
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
    try:
        image_url = urlsplit(values["image"])
    except ValueError:
        return None, "Enter a valid image URL."
    if values["image"] and (
        image_url.scheme not in {"", "https"}
        or image_url.scheme == "https" and not image_url.netloc
        or image_url.netloc and image_url.scheme != "https"
        or not image_url.scheme and not image_url.path.lstrip("/").startswith("images/")
        or values["image"].startswith("//")
        or ".." in Path(image_url.path).parts
        or any(ord(character) < 32 for character in values["image"])
    ):
        return None, "Use a secure HTTPS photo URL or a path in the images folder, like images/car.jpg."
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
    return send_from_directory(ROOT, "index.html")


@app.get("/<page>.html")
def html_page(page):
    allowed = {"index", "diecast", "product", "about", "contact", "login", "register", "profile", "admin"}
    if page not in allowed:
        abort(404)
    return send_from_directory(ROOT, f"{page}.html")


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
        for row in db.execute("SELECT * FROM products ORDER BY name COLLATE NOCASE")
    ]
    catalog = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    brands = list(dict.fromkeys(catalog["brands"] + [product["make"] for product in products]))
    categories = list(dict.fromkeys(catalog["categories"] + [product["category"] for product in products]))
    return jsonify(products=products, brands=brands, categories=categories, shopEmail=SHOP_EMAIL)


@app.get("/api/cart")
@require_user
def get_cart():
    rows = get_db().execute(
        """
        SELECT ci.quantity, p.*
        FROM cart_items ci
        JOIN products p ON p.id = ci.product_id
        WHERE ci.user_id = ?
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
    product = db.execute("SELECT stock FROM products WHERE id = ?", (product_id,)).fetchone()
    if product is None:
        return jsonify(error="That model is no longer available."), 404
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
        WHERE w.user_id = ? ORDER BY w.created_at DESC
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
    if db.execute("SELECT 1 FROM products WHERE id = ?", (product_id,)).fetchone() is None:
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
            SELECT ci.quantity, p.id, p.name, p.price, p.stock
            FROM cart_items ci JOIN products p ON p.id = ci.product_id
            WHERE ci.user_id = ? ORDER BY p.name COLLATE NOCASE
            """,
            (user_id,),
        ).fetchall()
        if not items:
            db.rollback()
            return jsonify(error="Your bag is empty."), 400
        for item in items:
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


@app.post("/api/admin/products")
@require_admin
def admin_create_product():
    data = request.get_json(silent=True) or {}
    product, error = validate_product(data)
    if error:
        return jsonify(error=error), 400
    try:
        get_db().execute(
            """
            INSERT INTO products (
                id, name, make, scale, category, price, stock, best_seller,
                new_arrival, condition, image, image_alt, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                product["id"], product["name"], product["make"], product["scale"],
                product["category"], product["price"], product["stock"],
                int(product["bestSeller"]), int(product["newArrival"]),
                product["condition"], product["image"], product["imageAlt"],
                product["description"],
            ),
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
    db = get_db()
    cursor = db.execute(
        """
        UPDATE products SET name = ?, make = ?, scale = ?, category = ?, price = ?,
            stock = ?, best_seller = ?, new_arrival = ?, condition = ?, image = ?,
            image_alt = ?, description = ?
        WHERE id = ?
        """,
        (
            product["name"], product["make"], product["scale"], product["category"],
            product["price"], product["stock"], int(product["bestSeller"]),
            int(product["newArrival"]), product["condition"], product["image"],
            product["imageAlt"], product["description"], product_id,
        ),
    )
    if cursor.rowcount == 0:
        return jsonify(error="That product was not found."), 404
    db.execute(
        "DELETE FROM cart_items WHERE product_id = ? AND quantity > ?",
        (product_id, product["stock"]),
    )
    db.commit()
    return jsonify(product=product)


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


def main():
    parser = argparse.ArgumentParser(description="Run or administer the PitStop.co storefront.")
    parser.add_argument("command", nargs="?", choices=("run", "create-admin"), default="run")
    arguments = parser.parse_args()
    init_db()
    if arguments.command == "create-admin":
        create_admin()
        return
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False)


init_db()


if __name__ == "__main__":
    main()
