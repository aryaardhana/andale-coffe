# Andalé Coffee Full-Stack

Website e-commerce lengkap untuk Andalé Coffee dengan:
- Frontend HTML/CSS/JavaScript
- Node.js + Express
- SQLite database
- Login admin
- Dashboard admin
- CRUD produk
- Ganti password admin
- Sistem stok dan riwayat pergerakan stok
- Order database
- Checkout
- Midtrans Snap Sandbox
- Midtrans notification/webhook dengan verifikasi signature
- Upload gambar produk
- WhatsApp reseller

## 1. Install Node.js
Install Node.js versi 20 atau lebih baru.

## 2. Buka folder
Buka folder project ini di VS Code.

## 3. Install dependency
Buka Terminal VS Code:
`npm install`

## 4. Buat .env
Copy `.env.example` menjadi `.env`.

Minimal untuk menjalankan website:
`JWT_SECRET=isi-secret-acak`

Untuk Midtrans Sandbox isi:
`MIDTRANS_SERVER_KEY=...`
`MIDTRANS_CLIENT_KEY=...`

Jangan pernah memasukkan Server Key ke JavaScript frontend atau meng-upload `.env` ke GitHub.

## 5. Jalankan
`npm run dev`

Buka:
http://localhost:3000

Admin:
http://localhost:3000/admin

Login demo:
username: admin
password: admin12345

## 6. Midtrans
Website menggunakan Midtrans Snap. Selama pengembangan gunakan Sandbox.

Setelah Client Key dan Server Key diisi, checkout akan membuka Snap.

Untuk webhook, saat website sudah online gunakan URL:
https://DOMAIN-ANDA/api/midtrans/notification

Masukkan URL tersebut pada konfigurasi HTTP Notification di Midtrans.

Untuk produksi, ganti:
MIDTRANS_IS_PRODUCTION=true

dan gunakan Production Client Key + Server Key. Jangan gunakan key Sandbox untuk transaksi nyata.

## 7. Database
Database otomatis dibuat:
data/andale.db

Tabel:
admins
products
orders
order_items
stock_movements

## 8. Catatan stok
Saat order dibuat, stok di-reserve dan berkurang.
Jika Midtrans mengirim status gagal/cancel/expire, stok dikembalikan satu kali.
Jika pembayaran berhasil, stok tetap berkurang.

## 9. Deploy
Untuk deployment nyata gunakan hosting Node.js yang menyediakan HTTPS dan persistent storage/database. GitHub Pages saja tidak cukup untuk backend Express + SQLite + Midtrans webhook.

## 10. Keamanan sebelum produksi
- Ganti password admin.
- Gunakan JWT_SECRET acak yang panjang.
- Jangan commit `.env`.
- Gunakan HTTPS.
- Gunakan Midtrans Production keys hanya di server.
- Pertimbangkan PostgreSQL/MySQL jika trafik sudah besar.
