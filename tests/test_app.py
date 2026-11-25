import io
import os
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from werkzeug.security import generate_password_hash

# Importing the app sets up its database straight away, so point it at a
# throwaway file first. Otherwise the tests would change the shop's real data.
_IMPORT_DIR = tempfile.TemporaryDirectory()
os.environ["PITSTOP_DATABASE"] = str(Path(_IMPORT_DIR.name) / "import.sqlite3")

import app as storefront  # noqa: E402


class StorefrontTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        storefront.DATABASE = Path(self.temp_dir.name) / "test.sqlite3"
        # The shop's own catalog starts empty, so tests seed demo listings from a fixture.
        storefront.CATALOG_FILE = Path(__file__).with_name("catalog.json")
        storefront.UPLOADS = Path(self.temp_dir.name) / "uploads"
        # Never send real email from tests, even once the shop has a mail password saved.
        self.sent_emails = []
        storefront.MAILER = self.sent_emails.append
        storefront.MAIL_PASSWORD_FILE = Path(self.temp_dir.name) / "mail_password"
        storefront.init_db()
        storefront.app.config.update(TESTING=True)
        self.client = storefront.app.test_client()
        self.csrf_token = self.client.get("/api/csrf").get_json()["token"]

    def tearDown(self):
        self.temp_dir.cleanup()

    def request_with_csrf(self, method, url, **kwargs):
        headers = kwargs.pop("headers", {})
        headers["X-CSRF-Token"] = self.csrf_token
        return self.client.open(method=method, path=url, headers=headers, **kwargs)

    def refresh_csrf(self):
        self.csrf_token = self.client.get("/api/csrf").get_json()["token"]

    def register_customer(self):
        response = self.request_with_csrf(
            "POST",
            "/api/register",
            json={"name": "Collector", "email": "collector@example.com", "password": "correct horse 7"},
        )
        self.assertEqual(response.status_code, 201)
        self.refresh_csrf()
        return response.get_json()["user"]

    def test_guest_can_browse_but_cannot_add_to_cart(self):
        self.assertEqual(self.client.get("/api/products").status_code, 200)
        response = self.request_with_csrf(
            "PUT", "/api/cart/midnight-gt", json={"quantity": 1}
        )
        self.assertEqual(response.status_code, 401)

    def test_registration_creates_customer_and_cart_is_account_scoped(self):
        user = self.register_customer()
        self.assertEqual(user["role"], "customer")
        response = self.request_with_csrf(
            "PUT", "/api/cart/midnight-gt", json={"quantity": 2}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["items"][0]["quantity"], 2)

    def test_customer_cannot_access_admin_product_api(self):
        self.register_customer()
        response = self.client.get("/api/admin/products")
        self.assertEqual(response.status_code, 403)

    def test_registration_cannot_choose_admin_role(self):
        response = self.request_with_csrf(
            "POST",
            "/api/register",
            json={
                "name": "Collector",
                "email": "collector@example.com",
                "password": "correct horse 7",
                "role": "admin",
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["user"]["role"], "customer")

    def test_admin_can_create_product(self):
        with closing(storefront.connect_db()) as db, db:
            db.execute(
                """
                INSERT INTO users (name, email, password_hash, role, created_at)
                VALUES (?, ?, ?, 'admin', '2026-01-01T00:00:00+00:00')
                """,
                ("Shop Admin", "admin@example.com", generate_password_hash("correct horse 7")),
            )
        response = self.request_with_csrf(
            "POST",
            "/api/login",
            json={"email": "admin@example.com", "password": "correct horse 7"},
        )
        self.assertEqual(response.status_code, 200)
        self.refresh_csrf()
        product = {
            "id": "test-model",
            "name": "Test Model",
            "make": "PitStop",
            "scale": "1:64 scale",
            "category": "Classic",
            "price": 10.5,
            "stock": 3,
            "bestSeller": False,
            "newArrival": True,
            "condition": "New",
            "image": "",
            "imageAlt": "",
            "description": "Test listing",
        }
        response = self.request_with_csrf("POST", "/api/admin/products", json=product)
        self.assertEqual(response.status_code, 201)
        listing = self.client.get("/api/products").get_json()["products"]
        self.assertTrue(any(item["id"] == "test-model" for item in listing))

    def sign_in_admin(self):
        with closing(storefront.connect_db()) as db, db:
            db.execute(
                """
                INSERT INTO users (name, email, password_hash, role, created_at)
                VALUES (?, ?, ?, 'admin', '2026-01-01T00:00:00+00:00')
                """,
                ("Shop Admin", "admin@example.com", generate_password_hash("correct horse 7")),
            )
        self.request_with_csrf(
            "POST", "/api/login", json={"email": "admin@example.com", "password": "correct horse 7"}
        )
        self.refresh_csrf()

    def stock_of(self, product_id):
        with closing(storefront.connect_db()) as db:
            return db.execute("SELECT stock FROM products WHERE id = ?", (product_id,)).fetchone()[0]

    def place_order(self):
        self.register_customer()
        self.request_with_csrf("PUT", "/api/cart/midnight-gt", json={"quantity": 3})
        return self.request_with_csrf(
            "POST",
            "/api/orders",
            json={"name": "Collector", "phone": "+60 12-345 6789", "address": "1 Jalan Test, KL"},
        )

    def test_order_takes_stock_and_clears_bag(self):
        response = self.place_order()
        self.assertEqual(response.status_code, 201)
        order = response.get_json()["order"]
        self.assertEqual(order["status"], "pending")
        self.assertEqual(order["subtotal"], 72)
        self.assertEqual(self.stock_of("midnight-gt"), 1)
        self.assertEqual(self.client.get("/api/cart").get_json()["items"], [])
        self.assertEqual(len(self.client.get("/api/orders").get_json()["orders"]), 1)

    def test_order_rejects_empty_bag_and_missing_address(self):
        self.register_customer()
        response = self.request_with_csrf(
            "POST", "/api/orders", json={"name": "C", "phone": "0123456789", "address": "Somewhere"}
        )
        self.assertEqual(response.status_code, 400)
        self.request_with_csrf("PUT", "/api/cart/midnight-gt", json={"quantity": 1})
        response = self.request_with_csrf(
            "POST", "/api/orders", json={"name": "C", "phone": "0123456789", "address": " "}
        )
        self.assertEqual(response.status_code, 400)

    def test_admin_moves_order_through_flow_and_cancel_restocks(self):
        order_id = self.place_order().get_json()["order"]["id"]
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()
        self.sign_in_admin()
        dashboard = self.client.get("/api/admin/dashboard").get_json()
        self.assertEqual(dashboard["statusCounts"]["pending"], 1)
        self.assertEqual(dashboard["sales"], 0)
        response = self.request_with_csrf("PATCH", f"/api/admin/orders/{order_id}", json={"status": "shipped"})
        self.assertEqual(response.status_code, 409)
        response = self.request_with_csrf("PATCH", f"/api/admin/orders/{order_id}", json={"status": "confirmed"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/admin/dashboard").get_json()["sales"], 72)
        response = self.request_with_csrf("PATCH", f"/api/admin/orders/{order_id}", json={"status": "cancelled"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.stock_of("midnight-gt"), 4)
        response = self.request_with_csrf("PATCH", f"/api/admin/orders/{order_id}", json={"status": "confirmed"})
        self.assertEqual(response.status_code, 409)

    def test_customer_can_cancel_until_shop_confirms(self):
        order_id = self.place_order().get_json()["order"]["id"]
        self.assertEqual(self.stock_of("midnight-gt"), 1)
        response = self.request_with_csrf("POST", f"/api/orders/{order_id}/cancel")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["order"]["status"], "cancelled")
        self.assertEqual(self.stock_of("midnight-gt"), 4)
        # Cancelling twice, or someone else's order, is refused.
        self.assertEqual(self.request_with_csrf("POST", f"/api/orders/{order_id}/cancel").status_code, 409)
        self.assertEqual(self.request_with_csrf("POST", "/api/orders/999/cancel").status_code, 404)

    def test_customer_cannot_cancel_confirmed_order(self):
        order_id = self.place_order().get_json()["order"]["id"]
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()
        self.sign_in_admin()
        self.request_with_csrf("PATCH", f"/api/admin/orders/{order_id}", json={"status": "confirmed"})
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()
        self.request_with_csrf(
            "POST", "/api/login", json={"email": "collector@example.com", "password": "correct horse 7"}
        )
        self.refresh_csrf()
        response = self.request_with_csrf("POST", f"/api/orders/{order_id}/cancel")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.stock_of("midnight-gt"), 1)

    def test_shop_is_emailed_about_orders_once_password_is_set(self):
        original = storefront.SHOP_EMAIL
        storefront.SHOP_EMAIL = "shop@example.com"
        try:
            # No password yet: nothing is sent, and the order still goes through.
            self.assertEqual(self.place_order().status_code, 201)
            self.assertEqual(self.sent_emails, [])
            storefront.MAIL_PASSWORD_FILE.write_text("abcd efgh ijkl mnop", encoding="utf-8")
            self.request_with_csrf("PUT", "/api/cart/midnight-gt", json={"quantity": 1})
            order = self.request_with_csrf(
                "POST", "/api/orders", json={"name": "Collector", "phone": "0123456789", "address": "1 Jalan Test"}
            ).get_json()["order"]
            [email] = self.sent_emails
            self.assertIn(f"New order #{order['id']}", email["Subject"])
            self.assertEqual(email["To"], "shop@example.com")
            self.assertEqual(email["Reply-To"], "collector@example.com")
            self.assertIn("1 Jalan Test", email.get_content())
            self.request_with_csrf("POST", f"/api/orders/{order['id']}/cancel")
            self.assertIn("cancelled", self.sent_emails[-1]["Subject"])
        finally:
            storefront.SHOP_EMAIL = original

    def test_a_failed_email_never_breaks_an_order(self):
        def broken_mailer(_message):
            raise OSError("no internet")
        storefront.MAILER = broken_mailer
        storefront.MAIL_PASSWORD_FILE.write_text("abcdefghijklmnop", encoding="utf-8")
        with self.assertLogs(storefront.app.logger, "WARNING"):
            self.assertEqual(self.place_order().status_code, 201)

    def test_admin_can_check_for_new_orders(self):
        self.place_order()
        self.assertEqual(self.client.get("/api/admin/orders/latest").status_code, 403)
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()
        self.sign_in_admin()
        latest = self.client.get("/api/admin/orders/latest").get_json()
        self.assertEqual((latest["latestName"], latest["pending"]), ("Collector", 1))
        self.assertGreater(latest["latestId"], 0)

    def test_missing_page_is_friendly(self):
        response = self.client.get("/no-such-page")
        self.assertEqual(response.status_code, 404)
        self.assertIn("Wrong turn at the pit lane.", response.get_data(as_text=True))
        self.assertEqual(self.client.get("/secret.html").status_code, 404)
        api = self.client.get("/api/no-such-thing")
        self.assertEqual((api.status_code, api.get_json()), (404, {"error": "Not found."}))

    def test_customer_cannot_see_admin_orders(self):
        self.place_order()
        self.assertEqual(self.client.get("/api/admin/orders").status_code, 403)
        self.assertEqual(self.client.get("/api/admin/dashboard").status_code, 403)

    def test_listed_admin_email_registers_as_admin(self):
        original = storefront.ADMIN_EMAILS
        storefront.ADMIN_EMAILS = {"owner@example.com"}
        try:
            response = self.request_with_csrf(
                "POST",
                "/api/register",
                json={"name": "Owner", "email": "Owner@Example.com", "password": "correct horse 7"},
            )
        finally:
            storefront.ADMIN_EMAILS = original
        self.assertEqual(response.get_json()["user"]["role"], "admin")

    def test_wishlist_is_per_account(self):
        self.assertEqual(self.request_with_csrf("PUT", "/api/wishlist/midnight-gt").status_code, 401)
        self.register_customer()
        response = self.request_with_csrf("PUT", "/api/wishlist/midnight-gt")
        self.assertEqual([item["id"] for item in response.get_json()["items"]], ["midnight-gt"])
        self.request_with_csrf("PUT", "/api/wishlist/midnight-gt")
        self.assertEqual(len(self.client.get("/api/wishlist").get_json()["items"]), 1)
        self.assertEqual(self.request_with_csrf("PUT", "/api/wishlist/no-such-car").status_code, 404)
        response = self.request_with_csrf("DELETE", "/api/wishlist/midnight-gt")
        self.assertEqual(response.get_json()["items"], [])

    def test_product_page_is_served(self):
        self.assertEqual(self.client.get("/product.html").status_code, 200)

    def test_local_product_images_must_be_in_images_folder(self):
        product = {"name": "Test", "make": "PitStop", "scale": "1:64", "category": "Classic",
                   "price": 10, "stock": 1, "bestSeller": False, "newArrival": False,
                   "condition": "New", "imageAlt": "", "description": "Test"}
        for image in ("images/car.jpg", "/images/car.jpg", "https://example.com/car.jpg"):
            _, error = storefront.validate_product({**product, "image": image}, "test")
            self.assertIsNone(error, image)
        for image in ("photos/car.jpg", "images/../app.py", "http://example.com/car.jpg"):
            _, error = storefront.validate_product({**product, "image": image}, "test")
            self.assertIsNotNone(error, image)


    def admin_product(self, product_id, **changes):
        product = next(
            item for item in self.client.get("/api/admin/products").get_json()["products"]
            if item["id"] == product_id
        )
        product.pop("id")
        product.update(changes)
        return self.request_with_csrf("PATCH", f"/api/admin/products/{product_id}", json=product)

    def test_restock_alert_flow(self):
        self.register_customer()
        # In-stock models go in the bag, not on a waitlist.
        self.assertEqual(self.request_with_csrf("PUT", "/api/alerts/midnight-gt").status_code, 409)
        response = self.request_with_csrf("PUT", "/api/alerts/apex-track")
        self.assertEqual(response.status_code, 200)
        [alert] = response.get_json()["items"]
        self.assertEqual((alert["kind"], alert["ready"]), ("restock", False))
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()

        self.sign_in_admin()
        dashboard = self.client.get("/api/admin/dashboard").get_json()
        self.assertEqual(dashboard["waitlists"][0]["emails"], ["collector@example.com"])
        response = self.admin_product("apex-track", stock=3)
        self.assertEqual(response.get_json()["waitingNotified"], 1)
        # Saving again while already in stock is not a new restock.
        self.assertEqual(self.admin_product("apex-track", stock=4).get_json()["waitingNotified"], 0)
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()

        self.request_with_csrf("POST", "/api/login", json={"email": "collector@example.com", "password": "correct horse 7"})
        self.refresh_csrf()
        self.assertTrue(self.client.get("/api/alerts").get_json()["items"][0]["ready"])
        self.request_with_csrf("PUT", "/api/cart/apex-track", json={"quantity": 1})
        response = self.request_with_csrf(
            "POST", "/api/orders", json={"name": "C", "phone": "0123456789", "address": "1 Jalan Test"}
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.client.get("/api/alerts").get_json()["items"], [])

    def test_preorder_cannot_be_bought_but_can_be_listed(self):
        self.sign_in_admin()
        self.assertEqual(
            self.admin_product("coastal-roadster", preorder=True, releaseDate="2027-01-15").status_code, 200
        )
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()
        self.register_customer()
        response = self.request_with_csrf("PUT", "/api/cart/coastal-roadster", json={"quantity": 1})
        self.assertEqual(response.status_code, 409)
        [alert] = self.request_with_csrf("PUT", "/api/alerts/coastal-roadster").get_json()["items"]
        self.assertEqual((alert["kind"], alert["ready"]), ("preorder", False))
        self.assertEqual(alert["product"]["releaseDate"], "2027-01-15")

    def test_collector_details_are_saved_and_validated(self):
        self.sign_in_admin()
        response = self.admin_product(
            "midnight-gt",
            editionSize=3000,
            chase=True,
            lengthMm=190,
            gallery=[{"src": "images/wheels.jpg", "label": "Wheels"}],
        )
        self.assertEqual(response.status_code, 200)
        saved = next(p for p in self.client.get("/api/products").get_json()["products"] if p["id"] == "midnight-gt")
        self.assertEqual(saved["editionSize"], 3000)
        self.assertTrue(saved["chase"])
        self.assertEqual(saved["gallery"], [{"src": "images/wheels.jpg", "label": "Wheels"}])
        self.assertNotIn("spin", saved)
        for bad in (
            {"gallery": [{"src": "photos/x.jpg", "label": ""}]},
            {"spin": ["images/a.jpg", "images/b.jpg"]},  # the 360° spin was removed
            {"editionSize": 0},
            {"editionSize": True},
            {"lengthMm": 5},
            {"releaseDate": "15/01/2027"},
            {"chase": "yes"},
        ):
            self.assertEqual(self.admin_product("midnight-gt", **bad).status_code, 400, bad)

    def upload(self, data, filename="car.png"):
        return self.request_with_csrf(
            "POST", "/api/admin/uploads",
            data={"photo": (io.BytesIO(data), filename)},
            content_type="multipart/form-data",
        )

    def test_admin_uploads_photo(self):
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200_000  # bigger than the 64 KB JSON limit
        self.register_customer()
        self.assertEqual(self.upload(png).status_code, 403)
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()
        self.sign_in_admin()
        response = self.upload(png, "../../evil.png")
        self.assertEqual(response.status_code, 201)
        path = response.get_json()["path"]
        self.assertRegex(path, r"^images/uploads/\d{8}-[0-9a-f]{16}\.png$")
        self.assertTrue((storefront.UPLOADS / path.rsplit("/", 1)[1]).exists())
        _, error = storefront.validate_product({
            "name": "T", "make": "M", "scale": "1:64", "category": "C", "price": 1, "stock": 1,
            "bestSeller": False, "newArrival": False, "condition": "New", "image": path,
            "imageAlt": "", "description": "D",
        }, "t")
        self.assertIsNone(error)
        # Content decides, not the name: a script renamed to .jpg is refused.
        self.assertEqual(self.upload(b"<svg onload=alert(1)>", "car.jpg").status_code, 400)
        self.assertEqual(self.upload(b"\xff\xd8\xff" + b"\x00" * (11 * 1024 * 1024)).status_code, 413)

    def test_brand_spelling_matches_existing(self):
        self.sign_in_admin()
        product = {
            "id": "skyline", "name": "Skyline", "make": "minigt", "scale": "1:64",
            "category": "sport", "price": 30, "stock": 1, "bestSeller": False,
            "newArrival": False, "condition": "new", "image": "", "imageAlt": "", "description": "D",
        }
        response = self.request_with_csrf("POST", "/api/admin/products", json=product)
        saved = response.get_json()["product"]
        self.assertEqual(
            (saved["make"], saved["category"], saved["scale"], saved["condition"]),
            ("Mini GT", "Sport", "1:64", "New"),
        )
        # A brand nobody has used yet is kept as typed.
        product.update(id="other", make="Tarmac Works")
        saved = self.request_with_csrf("POST", "/api/admin/products", json=product).get_json()["product"]
        self.assertEqual(saved["make"], "Tarmac Works")

    def test_product_videos_and_links(self):
        self.sign_in_admin()
        links = [
            {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Unboxing"},
            {"url": "https://minigt.tsm-models.com/index.php?action=product-detail&id=1218", "title": ""},
        ]
        self.assertEqual(self.admin_product("midnight-gt", links=links).status_code, 200)
        saved = next(p for p in self.client.get("/api/products").get_json()["products"] if p["id"] == "midnight-gt")
        self.assertEqual(saved["links"], links)
        for bad in (
            [{"url": "javascript:alert(1)", "title": ""}],
            [{"url": "http://example.com", "title": ""}],
            [{"url": "https://localhost", "title": ""}],
            [{"url": "https://example.com/a b", "title": ""}],
            [{"url": "https://example.com", "title": "x" * 101}],
            [{"url": "https://example.com"}] * 11,
        ):
            self.assertEqual(self.admin_product("midnight-gt", links=bad).status_code, 400, bad[0])
        policy = self.client.get("/product.html").headers["Content-Security-Policy"]
        self.assertIn("frame-src https://www.youtube-nocookie.com https://player.vimeo.com", policy)
        self.assertIn("frame-ancestors 'none'", policy)

    def test_quick_status_update(self):
        quick = lambda body: self.request_with_csrf("PATCH", "/api/admin/products/apex-track/quick", json=body)
        self.register_customer()
        self.request_with_csrf("PUT", "/api/alerts/apex-track")
        self.assertEqual(quick({"stock": 5}).status_code, 403)
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()
        self.sign_in_admin()
        response = quick({"stock": 5, "bestSeller": True})
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual((body["product"]["stock"], body["product"]["bestSeller"]), (5, True))
        self.assertEqual(body["waitingNotified"], 1)
        # Everything else is left alone.
        self.assertEqual(body["product"]["name"], "Example racing car")
        self.assertEqual(quick({"preorder": True}).get_json()["product"]["preorder"], True)
        self.assertEqual(quick({"stock": -1}).status_code, 400)
        self.assertEqual(quick({"name": "Renamed"}).status_code, 400)
        self.assertEqual(quick({}).status_code, 400)
        self.assertEqual(
            self.request_with_csrf("PATCH", "/api/admin/products/no-such/quick", json={"stock": 1}).status_code, 404
        )

    def test_old_stock_number_never_undoes_a_sale(self):
        self.sign_in_admin()
        quick = lambda body: self.request_with_csrf("PATCH", "/api/admin/products/apex-track/quick", json=body)
        self.assertEqual(quick({"stock": 5}).status_code, 200)
        # The admin opens the edit form at 5, then a customer buys 2 elsewhere.
        with closing(storefront.connect_db()) as db:
            db.execute("UPDATE products SET stock = 3 WHERE id = 'apex-track'")
            db.commit()
        product = self.client.get("/api/admin/products").get_json()["products"]
        product = next(entry for entry in product if entry["id"] == "apex-track")
        product.pop("id")
        # Saving the form without touching stock keeps the live 3, not the stale 5.
        response = self.request_with_csrf(
            "PATCH", "/api/admin/products/apex-track", json={**product, "stock": 5, "stockWas": 5, "name": "Renamed"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["product"]["stock"], 3)
        # Changing stock from a stale number is refused, and the live number comes back.
        response = quick({"stock": 6, "stockWas": 5})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["currentStock"], 3)
        self.assertEqual(quick({"stock": 6, "stockWas": 3}).get_json()["product"]["stock"], 6)

    def test_dashboard_does_not_call_preorders_sold_out(self):
        self.sign_in_admin()
        quick = lambda product_id, body: self.request_with_csrf(
            "PATCH", f"/api/admin/products/{product_id}/quick", json=body
        )
        products = self.client.get("/api/admin/products").get_json()["products"]
        for product in products:
            quick(product["id"], {"stock": 10, "preorder": False})
        quick("apex-track", {"stock": 0, "preorder": True})
        dashboard = self.client.get("/api/admin/dashboard").get_json()
        self.assertEqual(dashboard["soldOut"], 0)
        self.assertEqual(dashboard["stockAlerts"], [])
        quick("apex-track", {"preorder": False})
        dashboard = self.client.get("/api/admin/dashboard").get_json()
        self.assertEqual((dashboard["soldOut"], len(dashboard["stockAlerts"])), (1, 1))

    def test_favicon(self):
        response = self.client.get("/favicon.ico")
        self.assertEqual((response.status_code, response.mimetype), (200, "image/png"))
        response.close()

    def test_unavailable_product_is_hidden_from_shop(self):
        self.register_customer()
        self.request_with_csrf("PUT", "/api/cart/midnight-gt", json={"quantity": 1})
        self.request_with_csrf("PUT", "/api/wishlist/midnight-gt")
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()

        self.sign_in_admin()
        quick = lambda body: self.request_with_csrf("PATCH", "/api/admin/products/midnight-gt/quick", json=body)
        self.assertFalse(quick({"available": False}).get_json()["product"]["available"])
        ids = [p["id"] for p in self.client.get("/api/products").get_json()["products"]]
        self.assertNotIn("midnight-gt", ids)
        # The admin still sees it, so it can be switched back on.
        admin_ids = [p["id"] for p in self.client.get("/api/admin/products").get_json()["products"]]
        self.assertIn("midnight-gt", admin_ids)
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()

        self.request_with_csrf("POST", "/api/login", json={"email": "collector@example.com", "password": "correct horse 7"})
        self.refresh_csrf()
        self.assertEqual(self.client.get("/api/cart").get_json()["items"], [])
        self.assertEqual(self.client.get("/api/wishlist").get_json()["items"], [])
        self.assertEqual(self.request_with_csrf("PUT", "/api/cart/midnight-gt", json={"quantity": 1}).status_code, 404)
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()

        self.request_with_csrf("POST", "/api/login", json={"email": "admin@example.com", "password": "correct horse 7"})
        self.refresh_csrf()
        quick({"available": True})
        ids = [p["id"] for p in self.client.get("/api/products").get_json()["products"]]
        self.assertIn("midnight-gt", ids)

    def test_product_page_has_link_preview(self):
        page = self.client.get("/product.html?id=midnight-gt").get_data(as_text=True)
        self.assertIn('<meta property="og:type" content="product">', page)
        self.assertIn('property="og:title" content="Example model name | PitStop.co"', page)
        self.assertIn('property="og:url" content="http://localhost/product.html?id=midnight-gt"', page)
        self.assertIn("RM", page.split('property="og:description"')[1].split(">")[0])
        missing = self.client.get("/product.html?id=nope").get_data(as_text=True)
        self.assertIn('<meta property="og:type" content="website">', missing)
        self.assertIn('content="http://localhost/images/logo/pitstop-logo.png"', missing)

    def test_link_preview_escapes_product_text(self):
        with closing(storefront.connect_db()) as db:
            db.execute("UPDATE products SET name = ? WHERE id = 'midnight-gt'", ('Bad "car" <script>',))
            db.commit()
        page = self.client.get("/product.html?id=midnight-gt").get_data(as_text=True)
        self.assertNotIn("<script>", page.split("</head>")[0].split("<script src")[0])
        self.assertIn("Bad &#34;car&#34; &lt;script&gt;", page)

    def test_facebook_link_only_shows_when_set(self):
        original = storefront.SHOP_FACEBOOK
        try:
            storefront.SHOP_FACEBOOK = ""
            self.assertNotIn("footer-facebook", self.client.get("/").get_data(as_text=True))
            storefront.SHOP_FACEBOOK = "https://www.facebook.com/pitstop.co.my"
            page = self.client.get("/contact.html").get_data(as_text=True)
        finally:
            storefront.SHOP_FACEBOOK = original
        self.assertIn('class="footer-facebook" href="https://www.facebook.com/pitstop.co.my"', page)

    def test_shop_settings_validate_whatsapp_and_facebook(self):
        original = storefront.SETTINGS_FILE
        settings_file = Path(self.temp_dir.name) / "settings.json"
        storefront.SETTINGS_FILE = settings_file
        try:
            settings_file.write_text(
                '{"whatsappNumber": "+60 12-345 6789", "facebookUrl": "https://www.facebook.com/pitstop"}',
                encoding="utf-8",
            )
            self.assertEqual(storefront.load_settings()[2:], ("60123456789", "https://www.facebook.com/pitstop"))
            for bad in ('{"whatsappNumber": "call me"}', '{"facebookUrl": "http://evil.example/"}'):
                settings_file.write_text(bad, encoding="utf-8")
                with self.assertRaises(RuntimeError):
                    storefront.load_settings()
        finally:
            storefront.SETTINGS_FILE = original

    def test_reset_password_command(self):
        self.register_customer()
        from unittest import mock
        with mock.patch("builtins.input", return_value="Collector@Example.com"), \
                mock.patch.object(storefront, "getpass", return_value="brand new pass 9"), \
                mock.patch("builtins.print"):
            storefront.reset_password()
        self.request_with_csrf("POST", "/api/logout", json={})
        self.refresh_csrf()
        old = self.request_with_csrf("POST", "/api/login", json={"email": "collector@example.com", "password": "correct horse 7"})
        self.assertEqual(old.status_code, 401)
        new = self.request_with_csrf("POST", "/api/login", json={"email": "collector@example.com", "password": "brand new pass 9"})
        self.assertEqual(new.status_code, 200)

    def test_older_database_gains_collector_columns(self):
        with closing(storefront.connect_db()) as db, db:
            db.executescript(
                """
                DROP TABLE products;
                CREATE TABLE products (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, make TEXT NOT NULL, scale TEXT NOT NULL,
                    category TEXT NOT NULL, price REAL NOT NULL, stock INTEGER NOT NULL,
                    best_seller INTEGER NOT NULL DEFAULT 0, new_arrival INTEGER NOT NULL DEFAULT 0,
                    condition TEXT NOT NULL, image TEXT NOT NULL DEFAULT '',
                    image_alt TEXT NOT NULL DEFAULT '', description TEXT NOT NULL
                );
                INSERT INTO products (id, name, make, scale, category, price, stock, condition, description)
                VALUES ('old-car', 'Old car', 'Brand', '1:64', 'Classic', 10, 1, 'New', 'Old listing');
                """
            )
        storefront.init_db()
        [product] = self.client.get("/api/products").get_json()["products"]
        self.assertEqual((product["gallery"], product["preorder"]), ([], False))


if __name__ == "__main__":
    unittest.main()
