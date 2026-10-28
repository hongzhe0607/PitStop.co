import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from werkzeug.security import generate_password_hash

import app as storefront


class StorefrontTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        storefront.DATABASE = Path(self.temp_dir.name) / "test.sqlite3"
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


if __name__ == "__main__":
    unittest.main()
