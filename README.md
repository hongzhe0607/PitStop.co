# PitStop.co storefront

PitStop.co is a Python-powered storefront with public product browsing, customer accounts, an account-only shopping bag, and an administrator product editor. Product and account data are stored in SQLite in `instance/pitstop.sqlite3`.

## Run locally on Windows

1. Install Python 3.11 or newer.
2. In PowerShell, from this folder, create and activate an environment:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   ```

3. Start the shop:

   ```powershell
   python app.py
   ```

4. Open `http://127.0.0.1:5000`. Visitors can browse without signing in. Customers must register or sign in before adding products to their account-specific bag.
5. Admin accounts: list admin emails in `data/settings.json` under `adminEmails`. Registering with a listed email creates an admin account, and existing accounts with a listed email become admins the next time the app starts. Removing an email from the list does not remove admin access from an existing account. Email addresses are not verified, so register each listed address yourself before the site is public; otherwise whoever registers it first gets admin access. You can also create an admin from the command line: open another PowerShell window, activate the same environment, and run:

   ```powershell
   python app.py create-admin
   ```

   Follow the prompts to create the admin login. Admins can add, edit, and remove product listings and adjust stock. Other registrations always receive the customer role, whatever the sign-up form sends.

When `PITSTOP_SECRET_KEY` is not set, the app generates a session key once and stores it in `instance/secret_key`, so sign-ins survive restarts. To supply your own key instead, set `PITSTOP_SECRET_KEY` before starting the app. Generate a key with `python -c "import secrets; print(secrets.token_hex(32))"` and keep it private. For a hosted deployment, also set `PITSTOP_ENV=production`, use a strong private `PITSTOP_SECRET_KEY`, and serve the app over HTTPS. If the host puts the app behind a reverse proxy or load balancer, also set `PITSTOP_TRUST_PROXY=1` so sign-in rate limits apply per visitor instead of to the proxy's address; leave it unset when visitors connect directly. Do not use Flask's built-in development server as a public production server.

## Project files

- `app.py` — Flask routes, account authentication, role checks, SQLite data access, and the admin command.
- `data/settings.json` — admin emails (`adminEmails`) and the shop's contact email (`shopEmail`). Restart the app after editing it.
- `data/catalog.json` — initial product listings and filter categories. Imported into SQLite the first time the app starts with an empty product table.
- `index.html`, `diecast.html`, `about.html`, `contact.html` — storefront and information pages.
- `login.html`, `register.html`, `profile.html`, `admin.html` — sign-in, account creation, profile, and product administration pages.
- `images/` — product photos. In the admin editor, enter a photo as `images/your-file.jpg`, or use an HTTPS URL.
- `scripts/` — browser-side account, catalog, cart, and admin interactions.
- `styles/main.css` — shared responsive presentation.

Replace the demo listings in `data/catalog.json` before first launch. After the database has been initialized, use the admin page to maintain products; edits are saved in SQLite. Set `shopEmail` in `data/settings.json` (or the `PITSTOP_SHOP_EMAIL` environment variable, which takes priority) to show the shop's address on the contact page; until then the page says the address is coming soon.

## Orders and the dashboard

Signed-in customers check out from their bag with a name, phone number, shipping address, and optional note. Placing an order takes the items out of stock and empties the bag. Customers can follow their orders on the Profile page. The site does not take payment; the shop arranges payment and shipping with the customer.

Admins open **Admin** in the header to reach the shop dashboard, which has three tabs:

- **Dashboard** — sales (confirmed, shipped, and completed orders), orders waiting for confirmation, customers, stock, the order flow, recent orders, stock alerts (2 or fewer left), and best sellers.
- **Orders** — every order with the customer's contact details. Move an order Pending → Confirmed → Shipped → Completed, or cancel a pending or confirmed order to return its items to stock.
- **Products** — add, edit, and delete listings and stock.

This project now needs a Python host and cannot be deployed as a standalone GitHub Pages site.
