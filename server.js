require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const multer = require("multer");
const midtransClient = require("midtrans-client");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET";
const IS_PRODUCTION = String(process.env.MIDTRANS_IS_PRODUCTION).toLowerCase() === "true";

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, "andale.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT,
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status TEXT NOT NULL DEFAULT 'new',
  midtrans_token TEXT,
  midtrans_transaction_id TEXT,
  payment_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  change_amount INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

function seed() {
  const admin = db.prepare("SELECT id FROM admins WHERE username = ?").get("admin");
  if (!admin) {
    const hash = bcrypt.hashSync("admin12345", 12);
    db.prepare("INSERT INTO admins (username, password_hash) VALUES (?, ?)").run("admin", hash);
  }

  const count = db.prepare("SELECT COUNT(*) AS c FROM products").get().c;
  if (!count) {
    const insert = db.prepare(`
      INSERT INTO products (slug,name,description,price,stock,image)
      VALUES (?,?,?,?,?,?)
    `);
    const products = [
      ["ground-200g","Andalé Ground 200 g","Kopi bubuk dengan karakter Sumatera Utara dan sentuhan andaliman.",70000,50,"/assets/ground.svg"],
      ["drip-bag-10","Andalé Drip Bag 10","10 sachet drip bag praktis untuk menikmati kopi Andalé kapan saja.",60000,80,"/assets/drip.svg"],
      ["gift-box","Andalé Gift Box","Paket hadiah yang menggabungkan kopi dan cerita rasa lokal Sumatera Utara.",150000,30,"/assets/gift.svg"]
    ];
    const tx = db.transaction(() => products.forEach(p => insert.run(...p)));
    tx();
  }
}
seed();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${ext}`);
    }
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg","image/png","image/webp","image/svg+xml"].includes(file.mimetype);
    cb(ok ? null : new Error("Format gambar harus JPG, PNG, WEBP, atau SVG."), ok);
  }
});

function money(n) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function createToken(admin) {
  return jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: "8h" });
}

function requireAdmin(req, res, next) {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ message: "Anda belum login." });
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie("admin_token");
    res.status(401).json({ message: "Sesi login tidak valid atau sudah berakhir." });
  }
}

function makeOrderCode() {
  return `AND-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function getCartProducts(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("Keranjang kosong.");
  const ids = items.map(x => Number(x.product_id));
  const unique = [...new Set(ids)];
  if (unique.some(x => !Number.isInteger(x) || x <= 0)) throw new Error("Produk tidak valid.");

  const placeholders = unique.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM products WHERE id IN (${placeholders}) AND active = 1`).all(...unique);
  const byId = new Map(rows.map(p => [p.id, p]));

  return items.map(item => {
    const product = byId.get(Number(item.product_id));
    const quantity = Number(item.quantity);
    if (!product) throw new Error("Ada produk yang sudah tidak tersedia.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Jumlah produk tidak valid.");
    if (quantity > product.stock) throw new Error(`Stok ${product.name} hanya ${product.stock}.`);
    return { product, quantity, subtotal: product.price * quantity };
  });
}

let snap = null;
function getSnap() {
  if (!process.env.MIDTRANS_SERVER_KEY) return null;
  if (!snap) {
    snap = new midtransClient.Snap({
      isProduction: IS_PRODUCTION,
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY
    });
  }
  return snap;
}

// Public product API
app.get("/api/products", (req, res) => {
  const products = db.prepare(`
    SELECT id, slug, name, description, price, stock, image
    FROM products WHERE active = 1 ORDER BY id
  `).all();
  res.json(products);
});

app.get("/api/config", (req, res) => {
  res.json({
    midtransConfigured: Boolean(process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_CLIENT_KEY),
    midtransClientKey: process.env.MIDTRANS_CLIENT_KEY || "",
    whatsapp: process.env.STORE_WHATSAPP || ""
  });
});

// Admin auth
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(String(username || ""));
  if (!admin || !bcrypt.compareSync(String(password || ""), admin.password_hash)) {
    return res.status(401).json({ message: "Username atau password salah." });
  }

  const token = createToken(admin);
  res.cookie("admin_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ message: "Login berhasil.", username: admin.username });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  res.clearCookie("admin_token");
  res.json({ message: "Logout berhasil." });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ username: req.admin.username });
});

app.post("/api/admin/change-password", requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const admin = db.prepare("SELECT * FROM admins WHERE id=?").get(req.admin.id);
  if (!admin || !bcrypt.compareSync(String(currentPassword || ""), admin.password_hash)) {
    return res.status(400).json({ message: "Password lama salah." });
  }
  if (String(newPassword || "").length < 10) {
    return res.status(400).json({ message: "Password baru minimal 10 karakter." });
  }
  const hash = bcrypt.hashSync(String(newPassword), 12);
  db.prepare("UPDATE admins SET password_hash=? WHERE id=?").run(hash, admin.id);
  res.json({ message: "Password berhasil diubah. Silakan login kembali." });
});

// Admin dashboard
app.get("/api/admin/dashboard", requireAdmin, (req, res) => {
  const revenue = db.prepare(`
    SELECT COALESCE(SUM(total),0) AS total
    FROM orders WHERE payment_status = 'paid'
  `).get().total;

  const orders = db.prepare("SELECT COUNT(*) AS c FROM orders").get().c;
  const pending = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE payment_status = 'pending'").get().c;
  const products = db.prepare("SELECT COUNT(*) AS c FROM products WHERE active = 1").get().c;
  const lowStock = db.prepare("SELECT COUNT(*) AS c FROM products WHERE active=1 AND stock <= 5").get().c;

  res.json({ revenue, orders, pending, products, lowStock });
});

app.get("/api/admin/products", requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all());
});

app.post("/api/admin/products", requireAdmin, upload.single("image"), (req, res) => {
  try {
    const { name, slug, description, price, stock, active } = req.body;
    const image = req.file ? `/uploads/${req.file.filename}` : "/assets/ground.svg";
    const result = db.prepare(`
      INSERT INTO products (slug,name,description,price,stock,image,active)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      String(slug || name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-"),
      String(name || "").trim(),
      String(description || "").trim(),
      Number(price),
      Number(stock),
      image,
      active === "0" ? 0 : 1
    );
    res.json({ id: result.lastInsertRowid, message: "Produk dibuat." });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

app.put("/api/admin/products/:id", requireAdmin, upload.single("image"), (req, res) => {
  try {
    const id = Number(req.params.id);
    const old = db.prepare("SELECT * FROM products WHERE id=?").get(id);
    if (!old) return res.status(404).json({ message: "Produk tidak ditemukan." });

    const { name, slug, description, price, stock, active } = req.body;
    const nextStock = Number(stock);
    if (!Number.isInteger(nextStock) || nextStock < 0) throw new Error("Stok tidak valid.");

    const image = req.file ? `/uploads/${req.file.filename}` : old.image;
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE products
        SET slug=?, name=?, description=?, price=?, stock=?, image=?, active=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(
        String(slug || name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-"),
        String(name || "").trim(),
        String(description || "").trim(),
        Number(price),
        nextStock,
        image,
        active === "0" ? 0 : 1,
        id
      );
      const diff = nextStock - old.stock;
      if (diff !== 0) {
        db.prepare(`
          INSERT INTO stock_movements(product_id,change_amount,stock_after,reason)
          VALUES (?,?,?,'manual admin adjustment')
        `).run(id, diff, nextStock);
      }
    });
    tx();
    res.json({ message: "Produk diperbarui." });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE products SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  res.json({ message: "Produk dinonaktifkan." });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
  const itemStmt = db.prepare("SELECT * FROM order_items WHERE order_id=?");
  res.json(orders.map(o => ({ ...o, items: itemStmt.all(o.id) })));
});

app.put("/api/admin/orders/:id/fulfillment", requireAdmin, (req, res) => {
  const allowed = ["new","processing","shipped","completed","cancelled"];
  const status = String(req.body.status || "");
  if (!allowed.includes(status)) return res.status(400).json({ message: "Status tidak valid." });
  db.prepare("UPDATE orders SET fulfillment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, Number(req.params.id));
  res.json({ message: "Status pesanan diperbarui." });
});

app.get("/api/admin/stock-movements", requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT sm.*, p.name
    FROM stock_movements sm
    JOIN products p ON p.id=sm.product_id
    ORDER BY sm.id DESC LIMIT 100
  `).all());
});

// Customer order creation + payment
app.post("/api/orders", async (req, res) => {
  try {
    const { customer, items } = req.body;
    if (!customer?.name || !customer?.phone || !customer?.address) {
      return res.status(400).json({ message: "Nama, nomor telepon, dan alamat wajib diisi." });
    }

    const normalized = getCartProducts(items);
    const subtotal = normalized.reduce((sum, x) => sum + x.subtotal, 0);
    const shipping = 0;
    const total = subtotal + shipping;
    const orderCode = makeOrderCode();

    const createOrder = db.transaction(() => {
      const order = db.prepare(`
        INSERT INTO orders(order_code,customer_name,email,phone,address,notes,subtotal,shipping,total)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(
        orderCode,
        String(customer.name).trim(),
        String(customer.email || "").trim(),
        String(customer.phone).trim(),
        String(customer.address).trim(),
        String(customer.notes || "").trim(),
        subtotal,
        shipping,
        total
      );

      const itemStmt = db.prepare(`
        INSERT INTO order_items(order_id,product_id,product_name,price,quantity,subtotal)
        VALUES (?,?,?,?,?,?)
      `);
      const stockStmt = db.prepare("UPDATE products SET stock=stock-?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
      const moveStmt = db.prepare(`
        INSERT INTO stock_movements(product_id,change_amount,stock_after,reason,order_id)
        SELECT ?, ?, stock, 'order reservation', ?
        FROM products WHERE id=?
      `);

      for (const x of normalized) {
        itemStmt.run(order.lastInsertRowid, x.product.id, x.product.name, x.product.price, x.quantity, x.subtotal);
        stockStmt.run(x.quantity, x.product.id);
        moveStmt.run(x.product.id, -x.quantity, order.lastInsertRowid, x.product.id);
      }
      return Number(order.lastInsertRowid);
    });

    const orderId = createOrder();

    const snapClient = getSnap();
    if (!snapClient) {
      return res.json({
        demo: true,
        orderId,
        orderCode,
        total,
        message: "Payment gateway belum dikonfigurasi. Pesanan tersimpan sebagai mode demo."
      });
    }

    const parameter = {
      transaction_details: {
        order_id: orderCode,
        gross_amount: total
      },
      customer_details: {
        first_name: customer.name,
        email: customer.email || undefined,
        phone: customer.phone,
        billing_address: { address: customer.address }
      },
      item_details: normalized.map(x => ({
        id: String(x.product.id),
        price: x.product.price,
        quantity: x.quantity,
        name: x.product.name.slice(0, 50)
      }))
    };

    const transaction = await snapClient.createTransaction(parameter);
    db.prepare("UPDATE orders SET midtrans_token=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(transaction.token, orderId);

    res.json({
      demo: false,
      orderId,
      orderCode,
      total,
      token: transaction.token
    });
  } catch (e) {
    res.status(400).json({ message: e.message || "Gagal membuat pesanan." });
  }
});

// Midtrans notification
app.post("/api/midtrans/notification", async (req, res) => {
  try {
    const notification = req.body;
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    if (!serverKey) return res.status(503).json({ message: "Midtrans belum dikonfigurasi." });

    const expected = crypto
      .createHash("sha512")
      .update(`${notification.order_id}${notification.status_code}${notification.gross_amount}${serverKey}`)
      .digest("hex");

    if (expected !== notification.signature_key) {
      return res.status(403).json({ message: "Signature tidak valid." });
    }

    const order = db.prepare("SELECT * FROM orders WHERE order_code=?").get(notification.order_id);
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan." });

    let paymentStatus = "pending";
    const ts = notification.transaction_status;
    if (ts === "settlement") paymentStatus = "paid";
    else if (ts === "capture") paymentStatus = notification.fraud_status && String(notification.fraud_status).toLowerCase() !== "accept" ? "failed" : "paid";
    else if (["deny","cancel","expire"].includes(ts)) paymentStatus = "failed";

    const alreadyPaid = order.payment_status === "paid";

    db.prepare(`
      UPDATE orders
      SET payment_status=?,midtrans_transaction_id=?,payment_type=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      paymentStatus,
      notification.transaction_id || null,
      notification.payment_type || null,
      order.id
    );

    // Return reserved stock only once if payment permanently failed.
    if (paymentStatus === "failed" && order.payment_status !== "failed") {
      const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(order.id);
      const tx = db.transaction(() => {
        for (const item of items) {
          db.prepare("UPDATE products SET stock=stock+?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(item.quantity, item.product_id);
          const current = db.prepare("SELECT stock FROM products WHERE id=?").get(item.product_id);
          db.prepare(`
            INSERT INTO stock_movements(product_id,change_amount,stock_after,reason,order_id)
            VALUES (?,?,?,'payment failed stock returned',?)
          `).run(item.product_id, item.quantity, current.stock, order.id);
        }
      });
      tx();
    }

    res.json({ ok: true, alreadyPaid });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

app.get("/api/orders/:code", (req, res) => {
  const order = db.prepare(`
    SELECT order_code,customer_name,total,payment_status,fulfillment_status,created_at
    FROM orders WHERE order_code=?
  `).get(req.params.code);
  if (!order) return res.status(404).json({ message: "Pesanan tidak ditemukan." });
  res.json(order);
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/{*splat}", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ message: "API tidak ditemukan." });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  res.status(400).json({ message: err.message || "Terjadi kesalahan." });
});

app.listen(PORT, () => {
  console.log(`Andalé Coffee berjalan di http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
