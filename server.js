require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("Set SESSION_SECRET to a random string at least 32 characters long");
}
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD to bootstrap the admin account");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
});

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  name: "neonkey.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false });
app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);

function cleanEmail(value) { return String(value || "").trim().toLowerCase(); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function safeUser(user) { return { id: user.id, email: user.email, role: user.role, created_at: user.created_at }; }
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in first." });
  next();
}
async function getUser(req) {
  if (!req.session.userId) return null;
  const result = await pool.query("SELECT id,email,role,created_at FROM users WHERE id=$1", [req.session.userId]);
  return result.rows[0] || null;
}
async function requireAdmin(req, res, next) {
  try {
    if (!req.session.userId) return res.status(401).json({ error: "Please sign in first." });
    const result = await pool.query("SELECT role FROM users WHERE id=$1", [req.session.userId]);
    if (!result.rows[0] || result.rows[0].role !== "admin") return res.status(403).json({ error: "Admin access required." });
    next();
  } catch (e) { next(e); }
}
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      product_id BIGINT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10),
      amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
      payment_method TEXT NOT NULL DEFAULT 'manual',
      payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','rejected')),
      order_status TEXT NOT NULL DEFAULT 'pending' CHECK (order_status IN ('pending','processing','completed','cancelled')),
      delivery_note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id);
    CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);
  `);

  const email = cleanEmail(process.env.ADMIN_EMAIL);
  const existing = await pool.query("SELECT id,role FROM users WHERE email=$1", [email]);
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  if (!existing.rows.length) {
    await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin')", [email, hash]);
    console.log("Admin account created from ADMIN_EMAIL.");
  } else if (existing.rows[0].role !== "admin") {
    await pool.query("UPDATE users SET role='admin', password_hash=$2 WHERE id=$1", [existing.rows[0].id, hash]);
    console.log("Existing ADMIN_EMAIL promoted to admin and password updated.");
  }
}

app.get("/api/config", (req, res) => res.json({ supportContact: process.env.SUPPORT_CONTACT || "" }));

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");
    if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Password must be 10–128 characters." });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email,role,created_at",
      [email, hash]
    );
    req.session.userId = result.rows[0].id;
    res.status(201).json({ user: safeUser(result.rows[0]) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That email is already registered. Sign in instead." });
    next(e);
  }
});
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        res.json({ user: safeUser(user) });
      });
    });
  } catch (e) { next(e); }
});
app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("neonkey.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.json({ ok: true });
  });
});
app.get("/api/me", async (req, res, next) => {
  try {
    const user = await getUser(req);
    res.json({ user: user ? safeUser(user) : null });
  } catch (e) { next(e); }
});

app.get("/api/products", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id,name,description,price_paise,created_at FROM products WHERE active=TRUE ORDER BY created_at DESC");
    res.json({ products: result.rows });
  } catch (e) { next(e); }
});
app.get("/api/orders", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT o.id,o.quantity,o.amount_paise,o.payment_method,o.payment_status,o.order_status,o.delivery_note,o.created_at,
             p.name AS product_name
      FROM orders o JOIN products p ON p.id=o.product_id
      WHERE o.user_id=$1 ORDER BY o.created_at DESC`, [req.session.userId]);
    res.json({ orders: result.rows });
  } catch (e) { next(e); }
});
app.post("/api/orders", requireAuth, async (req, res, next) => {
  try {
    const productId = Number(req.body.productId);
    const quantity = Number(req.body.quantity || 1);
    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return res.status(400).json({ error: "Choose a valid product and quantity (1–10)." });
    }
    const productResult = await pool.query("SELECT id,price_paise FROM products WHERE id=$1 AND active=TRUE", [productId]);
    if (!productResult.rows.length) return res.status(404).json({ error: "Product not found." });
    const amount = productResult.rows[0].price_paise * quantity;
    const result = await pool.query(
      "INSERT INTO orders(user_id,product_id,quantity,amount_paise) VALUES($1,$2,$3,$4) RETURNING id,amount_paise,payment_status,order_status,created_at",
      [req.session.userId, productId, quantity, amount]
    );
    res.status(201).json({ order: result.rows[0], message: "Order created. Follow the payment instructions shown on the site." });
  } catch (e) { next(e); }
});

// Admin routes: authorization is checked on the server for every request.
app.get("/api/admin/summary", requireAdmin, async (req, res, next) => {
  try {
    const [users, products, orders, pending] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role='customer'"),
      pool.query("SELECT COUNT(*)::int AS count FROM products"),
      pool.query("SELECT COUNT(*)::int AS count FROM orders"),
      pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE payment_status='pending'")
    ]);
    res.json({ customers: users.rows[0].count, products: products.rows[0].count, orders: orders.rows[0].count, pendingPayments: pending.rows[0].count });
  } catch (e) { next(e); }
});
app.get("/api/admin/products", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY created_at DESC");
    res.json({ products: result.rows });
  } catch (e) { next(e); }
});
app.post("/api/admin/products", requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim().slice(0, 100);
    const description = String(req.body.description || "").trim().slice(0, 1000);
    const price = Number(req.body.price);
    if (!name || !Number.isFinite(price) || price < 0 || price > 10000000) return res.status(400).json({ error: "Enter a product name and valid price." });
    const result = await pool.query(
      "INSERT INTO products(name,description,price_paise) VALUES($1,$2,$3) RETURNING *",
      [name, description, Math.round(price * 100)]
    );
    res.status(201).json({ product: result.rows[0] });
  } catch (e) { next(e); }
});
app.patch("/api/admin/products/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const active = Boolean(req.body.active);
    const result = await pool.query("UPDATE products SET active=$1 WHERE id=$2 RETURNING *", [active, id]);
    if (!result.rows.length) return res.status(404).json({ error: "Product not found." });
    res.json({ product: result.rows[0] });
  } catch (e) { next(e); }
});
app.get("/api/admin/orders", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT o.*,u.email,p.name AS product_name
      FROM orders o JOIN users u ON u.id=o.user_id JOIN products p ON p.id=o.product_id
      ORDER BY o.created_at DESC LIMIT 300`);
    res.json({ orders: result.rows });
  } catch (e) { next(e); }
});
app.patch("/api/admin/orders/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const payment = String(req.body.payment_status || "");
    const status = String(req.body.order_status || "");
    const note = String(req.body.delivery_note || "").slice(0, 2000);
    const allowedPayment = ["pending", "paid", "rejected"];
    const allowedStatus = ["pending", "processing", "completed", "cancelled"];
    if (!allowedPayment.includes(payment) || !allowedStatus.includes(status)) return res.status(400).json({ error: "Invalid order status." });
    const result = await pool.query(
      "UPDATE orders SET payment_status=$1,order_status=$2,delivery_note=$3 WHERE id=$4 RETURNING *",
      [payment, status, note, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Order not found." });
    res.json({ order: result.rows[0] });
  } catch (e) { next(e); }
});
app.get("/api/admin/customers", requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id,email,role,created_at FROM users WHERE role='customer' ORDER BY created_at DESC LIMIT 500");
    res.json({ customers: result.rows });
  } catch (e) { next(e); }
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Server error. Please try again later." });
});

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`NeonKey running on port ${PORT}`));
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});
