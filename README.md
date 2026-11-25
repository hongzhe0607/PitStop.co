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

   Follow the prompts to create the admin login. If you forget a password, run `python app.py reset-password` the same way, enter the account's email, and choose a new password. Admins can add, edit, and remove product listings and adjust stock. Other registrations always receive the customer role, whatever the sign-up form sends.

### Testing on your phone

Connect the phone to the same Wi-Fi as the computer, then start the app with `python app.py --lan`. It prints an address such as `http://192.168.100.19:5000`; open that in the phone's browser. If Windows asks about the firewall, allow **Private networks**. Use this on your home Wi-Fi only (not public Wi-Fi), and go back to plain `python app.py` when you're done. Over this plain `http://` address, phones may hide the share menu and copy the link instead; that works normally once the site is online with HTTPS.

When `PITSTOP_SECRET_KEY` is not set, the app generates a session key once and stores it in `instance/secret_key`, so sign-ins survive restarts. To supply your own key instead, set `PITSTOP_SECRET_KEY` before starting the app. Generate a key with `python -c "import secrets; print(secrets.token_hex(32))"` and keep it private. For a hosted deployment, also set `PITSTOP_ENV=production`, use a strong private `PITSTOP_SECRET_KEY`, and serve the app over HTTPS. If the host puts the app behind a reverse proxy or load balancer, also set `PITSTOP_TRUST_PROXY=1` so sign-in rate limits apply per visitor instead of to the proxy's address; leave it unset when visitors connect directly. Do not use Flask's built-in development server as a public production server.

## Project files

- `app.py` — Flask routes, account authentication, role checks, SQLite data access, and the admin command.
- `data/settings.json` — admin emails (`adminEmails`), the shop's contact email (`shopEmail`), the shop's WhatsApp number with country code (`whatsappNumber`, e.g. `60123456789`) and Facebook Page link (`facebookUrl`). The WhatsApp buttons and the Facebook footer link stay hidden while those are empty. Restart the app after editing it.
- Link previews: every page carries Open Graph tags, and product pages use the model's name, price, stock and main photo, so links shared on Facebook, WhatsApp or Instagram show a proper card. Previews only work once the site is online at a public address; a `localhost` link can't be read by Facebook or WhatsApp.
- `data/catalog.json` — initial product listings and filter categories. Imported into SQLite the first time the app starts with an empty product table.
- `index.html`, `diecast.html`, `product.html`, `about.html`, `contact.html` — storefront, product detail, and information pages.
- `login.html`, `register.html`, `profile.html`, `admin.html` — sign-in, account creation, profile, and product administration pages.
- `images/` — site photos. Photos uploaded in the admin editor are saved in `images/uploads/` (JPG, PNG, WebP, or GIF, up to 10 MB; large photos are shrunk in the browser first). Back this folder up along with `instance/`.
- `scripts/` — browser-side account, catalog, cart, and admin interactions.
- `styles/main.css` — shared responsive presentation.

Replace the demo listings in `data/catalog.json` before first launch. After the database has been initialized, use the admin page to maintain products; edits are saved in SQLite. Set `shopEmail` in `data/settings.json` (or the `PITSTOP_SHOP_EMAIL` environment variable, which takes priority) to show the shop's address on the contact page; until then the page says the address is coming soon.

## Shopping features

- **Homepage**: hero banner, shop-by-category tiles, a featured model (the first in-stock best seller), best sellers, new arrivals, and shop-by-brand links.
- **Product pages**: every model opens at `product.html?id=<product-id>` with details, a quantity picker, and related models.
- **Saved models**: signed-in customers tap the heart on any model to save it to their account. The heart in the header, or **Saved only** on the Diecast page, shows them.
- **Badges and sorting**: cards show New, Best seller, Only N left!, and Sold out. The Diecast page sorts by featured, newest, price, or name, and its filters are kept in the link so a filtered view can be shared.
- Animations are switched off for visitors whose device is set to reduce motion.

## Collector features

Set these in the admin product editor under **Collector details** and **Close-up photos**. All are optional.

- **Restock alerts**: on a sold-out model, signed-in customers tap **Notify me when it's back**. When you give it stock again, their alert on the Profile page (**My alerts**) turns green and they see a "back in stock" message on their next visit. The site cannot send email itself. The **Waitlists** card on the dashboard lists who is waiting, with an **Email list** link that opens your mail app with them in BCC.
- **Pre-orders**: tick **Pre-order** and set a **Release date**. The model can't go in a bag, and customers join the pre-order list instead. On release day, untick Pre-order and set the stock.
- **Rarity**: **Edition size** shows "1 of 3,000". **Chase variant** adds a gold Chase badge. The Diecast page's Availability filter has **Pre-order** and **Limited & chase** options.
- **Close-up gallery**: click **Add photos** (or drop them in) and give each a label such as Wheels or Box condition. Customers tap a photo to zoom in.
- **Size check**: each product page draws the model next to a phone, a coin, and other common scales. The size comes from the scale (for example `1:24`) and a typical 4.5 m car. Enter **Model length (mm)** for an exact figure.

## Orders and the dashboard

Signed-in customers check out from their bag with a name, phone number, shipping address, and optional note. Placing an order takes the items out of stock and empties the bag. Customers can follow their orders on the Profile page. The site does not take payment; the shop arranges payment and shipping with the customer.

Admins open **Admin** in the header to reach the shop dashboard, which has three tabs:

- **Dashboard** — sales (confirmed, shipped, and completed orders), orders waiting for confirmation, customers, stock, the order flow, recent orders, stock alerts (2 or fewer left), and best sellers.
- **Orders** — every order with the customer's contact details. Move an order Pending → Confirmed → Shipped → Completed, or cancel a pending or confirmed order to return its items to stock.
- **Products** — add, edit, and delete listings and stock.

Customers can cancel their own order from the Profile page while it is still **Pending**; the items go back into stock. Once the shop confirms it, only the shop can cancel.

### Hearing about new orders

- **On the admin page:** click **Order alerts** at the top once. While the admin page is open (a background tab is fine), each new order plays a chime, shows a banner, and pops up a notification. The page checks every 30 seconds.
- **By email:** the shop email (`shopEmail`) gets an email for every new or cancelled order. Gmail needs an *App Password* for this, not the normal password:
  1. Turn on 2-Step Verification for the shop's Google account, then create an App Password at <https://myaccount.google.com/apppasswords>.
  2. Stop the app and run `python app.py set-mail-password`. Paste the 16-letter code when asked (it stays hidden). A test email is sent straight away.
  3. Start the app again.

  The code is saved in `instance/mail_password`, which is never committed to git. Run `python app.py test-email` at any time to check that sending still works. To stop the emails, delete that file. If an email fails, the order still goes through and the problem is written to the app's log.

This project now needs a Python host and cannot be deployed as a standalone GitHub Pages site.
