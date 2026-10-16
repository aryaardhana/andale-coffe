let products = [];
let cart = JSON.parse(localStorage.getItem("andale-cart-v2") || "{}");
let config = {};

const rupiah = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(n) || 0);


/* =========================
   API HELPER
========================= */

async function api(url, options = {}) {
  const res = await fetch(url, options);

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || "Terjadi kesalahan.");
  }

  return data;
}


/* =========================
   INITIALIZATION
========================= */

async function init() {
  try {
    config = await api("/api/config");

    products = await api("/api/products");

    /*
      Pastikan jumlah dalam keranjang
      tidak melebihi stok terbaru.
    */

    Object.keys(cart).forEach((id) => {
      const product = products.find(
        (p) => p.id === Number(id)
      );

      if (!product || product.stock <= 0) {
        delete cart[id];
        return;
      }

      if (cart[id] > product.stock) {
        cart[id] = product.stock;
      }

      if (cart[id] < 1) {
        delete cart[id];
      }
    });

    saveCart();

    renderProducts();
    renderCart();

    /*
      Muat Midtrans setelah konfigurasi
      berhasil diterima dari server.
    */

    await loadMidtrans();

  } catch (error) {
    console.error(error);

    alert(
      error.message ||
      "Website gagal memuat data."
    );
  }
}


/* =========================
   MIDTRANS
========================= */

function loadMidtrans() {
  return new Promise((resolve, reject) => {

    if (!config.midtransConfigured) {
      console.warn(
        "Midtrans belum dikonfigurasi."
      );

      resolve();
      return;
    }

    if (!config.midtransClientKey) {
      console.warn(
        "Midtrans Client Key tidak tersedia."
      );

      resolve();
      return;
    }

    /*
      Jangan memuat Snap dua kali.
    */

    if (window.snap) {
      resolve();
      return;
    }

    const existingScript =
      document.getElementById(
        "midtrans-script"
      );

    if (existingScript) {
      existingScript.remove();
    }

    const script =
      document.createElement("script");

    /*
      Sandbox untuk testing.
      Production akan menggunakan
      URL Midtrans production.
    */

    const isProduction =
      location.protocol === "https:" &&
      !location.hostname.includes("localhost");

    script.id = "midtrans-script";

    script.src = isProduction
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js";

    script.setAttribute(
      "data-client-key",
      config.midtransClientKey
    );

    script.onload = () => {
      console.log(
        "Midtrans Snap berhasil dimuat."
      );

      resolve();
    };

    script.onerror = () => {
      reject(
        new Error(
          "Midtrans Snap gagal dimuat."
        )
      );
    };

    document.head.appendChild(script);
  });
}


/* =========================
   PRODUCTS
========================= */

function renderProducts() {
  
function productImage(p) {
  const name = String(p.name || "").toLowerCase();

  if (name.includes("ground")) {
    return "/assets/andale-ground-200g.png";
  }

  if (name.includes("drip")) {
    return "/assets/andale-drip-bag.png";
  }

  if (name.includes("gift")) {
    return "/assets/andale-gift-box.png";
  }

  return p.image || "/assets/ground.svg";
}


  const grid =
    document.getElementById(
      "product-grid"
    );

  if (!grid) return;

  if (!products.length) {

    grid.innerHTML = `
      <p>
        Produk belum tersedia.
      </p>
    `;

    return;
  }

  grid.innerHTML = products
    .map((p) => {

      const stockClass =
        p.stock <= 5
          ? "low"
          : "";

      const buttonDisabled =
        p.stock < 1
          ? "disabled"
          : "";

      const buttonText =
        p.stock < 1
          ? "Stok Habis"
          : "Tambah ke Keranjang";

      return `
        <article class="product-card">

          <div class="product-image">

            <img
              src="${productImage(p)}"
              alt="${escapeHtml(p.name)}"
              loading="lazy"
              onerror="this.onerror=null;this.src='/assets/ground.svg'"
            >

          </div>

          <div class="product-info">

            <span class="eyebrow">
              ANDALÉ COFFEE
            </span>

            <h3>
              ${escapeHtml(p.name)}
            </h3>

            <p>
              ${escapeHtml(p.description)}
            </p>

            <span class="price">
              ${rupiah(p.price)}
            </span>

            <div class="stock ${stockClass}">
              ${
                p.stock > 0
                  ? `Stok ${p.stock}`
                  : "Stok habis"
              }
            </div>

            <button
              class="btn primary"
              ${buttonDisabled}
              onclick="addCart(${p.id})"
            >
              ${buttonText}
            </button>

          </div>

        </article>
      `;
    })
    .join("");
}


/* =========================
   CART
========================= */

function saveCart() {

  localStorage.setItem(
    "andale-cart-v2",
    JSON.stringify(cart)
  );
}


function addCart(id) {

  const product =
    products.find(
      (p) => p.id === Number(id)
    );

  if (!product) {
    alert(
      "Produk tidak ditemukan."
    );

    return;
  }

  if (product.stock <= 0) {
    alert(
      "Produk sedang habis."
    );

    return;
  }

  const current =
    Number(cart[id] || 0);

  if (current >= product.stock) {

    alert(
      `Stok ${product.name} hanya ${product.stock}.`
    );

    return;
  }

  cart[id] =
    current + 1;

  saveCart();

  renderCart();

  openCart();
}


function changeCart(id, delta) {

  const product =
    products.find(
      (p) => p.id === Number(id)
    );

  if (!product) return;

  const current =
    Number(cart[id] || 0);

  let next =
    current + Number(delta);

  if (next <= 0) {

    delete cart[id];

  } else {

    if (next > product.stock) {

      alert(
        `Stok ${product.name} hanya ${product.stock}.`
      );

      next =
        product.stock;
    }

    cart[id] =
      next;
  }

  saveCart();

  renderCart();
}


function removeCart(id) {

  delete cart[id];

  saveCart();

  renderCart();
}


function getCartRows() {

  return Object.entries(cart)
    .map(([id, q]) => {

      const product =
        products.find(
          (p) => p.id === Number(id)
        );

      if (!product) {
        return null;
      }

      const quantity =
        Number(q);

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return null;
      }

      return {
        p: product,
        q: quantity,
        subtotal:
          product.price * quantity
      };
    })
    .filter(Boolean);
}


/* =========================
   RENDER CART
========================= */

function renderCart() {

  const rows =
    getCartRows();

  const count =
    rows.reduce(
      (total, item) =>
        total + item.q,
      0
    );

  const total =
    rows.reduce(
      (total, item) =>
        total + item.subtotal,
      0
    );

  const countElement =
    document.getElementById(
      "cart-count"
    );

  const totalElement =
    document.getElementById(
      "cart-total"
    );

  const itemsElement =
    document.getElementById(
      "cart-items"
    );

  if (countElement) {
    countElement.textContent =
      count;
  }

  if (totalElement) {
    totalElement.textContent =
      rupiah(total);
  }

  if (!itemsElement) return;

  if (!rows.length) {

    itemsElement.innerHTML = `
      <div class="empty-cart">
        <p>
          Keranjang masih kosong.
        </p>
      </div>
    `;

    return;
  }

  itemsElement.innerHTML =
    rows
      .map(
        (x) => `
        <div class="cart-row">

          <div class="cart-row-top">

            <div>

              <b>
                ${escapeHtml(x.p.name)}
              </b>

              <div>
                ${rupiah(x.p.price)}
              </div>

            </div>

            <b>
              ${rupiah(x.subtotal)}
            </b>

          </div>

          <div class="qty">

            <button
              type="button"
              onclick="changeCart(${x.p.id}, -1)"
            >
              −
            </button>

            <b>
              ${x.q}
            </b>

            <button
              type="button"
              onclick="changeCart(${x.p.id}, 1)"
            >
              +
            </button>

            <button
              type="button"
              onclick="removeCart(${x.p.id})"
            >
              Hapus
            </button>

          </div>

        </div>
      `
      )
      .join("");
}


/* =========================
   CART DRAWER
========================= */

function openCart() {

  const cartElement =
    document.getElementById(
      "cart"
    );

  const overlay =
    document.getElementById(
      "cart-overlay"
    );

  if (cartElement) {
    cartElement.classList.add(
      "show"
    );
  }

  if (overlay) {
    overlay.classList.add(
      "show"
    );
  }
}


function closeCart() {

  const cartElement =
    document.getElementById(
      "cart"
    );

  const overlay =
    document.getElementById(
      "cart-overlay"
    );

  if (cartElement) {
    cartElement.classList.remove(
      "show"
    );
  }

  if (overlay) {
    overlay.classList.remove(
      "show"
    );
  }
}


/* =========================
   CHECKOUT MODAL
========================= */

function openCheckout() {

  const rows =
    getCartRows();

  const total =
    rows.reduce(
      (sum, item) =>
        sum + item.subtotal,
      0
    );

  if (!rows.length || total <= 0) {

    alert(
      "Keranjang masih kosong."
    );

    return;
  }

  const checkoutTotal =
    document.getElementById(
      "checkout-total"
    );

  if (checkoutTotal) {

    checkoutTotal.textContent =
      rupiah(total);
  }

  const modal =
    document.getElementById(
      "checkout-modal"
    );

  if (modal) {
    modal.classList.add(
      "show"
    );
  }
}


function closeCheckout() {

  const modal =
    document.getElementById(
      "checkout-modal"
    );

  if (modal) {

    modal.classList.remove(
      "show"
    );
  }
}


/* =========================
   CHECKOUT
========================= */

async function checkout(e) {

  e.preventDefault();

  const rows =
    getCartRows();

  if (!rows.length) {

    alert(
      "Keranjang masih kosong."
    );

    return;
  }

  const name =
    document.getElementById(
      "c-name"
    ).value.trim();

  const email =
    document.getElementById(
      "c-email"
    ).value.trim();

  const phone =
    document.getElementById(
      "c-phone"
    ).value.trim();

  const address =
    document.getElementById(
      "c-address"
    ).value.trim();

  const notes =
    document.getElementById(
      "c-notes"
    ).value.trim();


  if (!name) {

    alert(
      "Nama lengkap wajib diisi."
    );

    return;
  }


  if (!phone) {

    alert(
      "Nomor WhatsApp wajib diisi."
    );

    return;
  }


  if (!address) {

    alert(
      "Alamat lengkap wajib diisi."
    );

    return;
  }


  const btn =
    document.getElementById(
      "pay-btn"
    );

  if (btn) {

    btn.disabled = true;

    btn.textContent =
      "Membuat pesanan...";
  }


  try {

    /*
      Kirim hanya product_id
      dan quantity.

      Harga tidak dikirim dari
      browser karena harga harus
      ditentukan oleh server.
    */

    const data =
      await api(
        "/api/orders",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              customer: {
                name,
                email,
                phone,
                address,
                notes
              },

              items:
                rows.map(
                  (x) => ({
                    product_id:
                      x.p.id,

                    quantity:
                      x.q
                  })
                )
            })
        }
      );


    /*
      MODE DEMO
    */

    if (data.demo) {

      alert(
        `Pesanan ${data.orderCode} berhasil dibuat.\n\n` +
        `Total: ${rupiah(data.total)}\n\n` +
        `Midtrans belum dikonfigurasi sehingga pembayaran masih dalam mode demo.`
      );

      cart = {};

      saveCart();

      renderCart();

      closeCheckout();

      closeCart();

      /*
        Ambil ulang stok
        dari database.
      */

      products =
        await api(
          "/api/products"
        );

      renderProducts();

      return;
    }


    /*
      Pastikan token tersedia.
    */

    if (!data.token) {

      throw new Error(
        "Token pembayaran Midtrans tidak diterima."
      );
    }


    /*
      Pastikan Snap sudah dimuat.
    */

    if (
      typeof window.snap ===
      "undefined"
    ) {

      await loadMidtrans();
    }


    if (
      typeof window.snap ===
      "undefined"
    ) {

      throw new Error(
        "Midtrans Snap belum siap. Periksa Client Key dan koneksi internet."
      );
    }


    /*
      Buka popup pembayaran.
    */

    window.snap.pay(
      data.token,
      {

        onSuccess:
          function(result) {

            console.log(
              "Pembayaran berhasil:",
              result
            );

            paymentDone(
              data.orderCode,
              "Pembayaran berhasil."
            );
          },


        onPending:
          function(result) {

            console.log(
              "Pembayaran pending:",
              result
            );

            paymentDone(
              data.orderCode,
              "Pembayaran menunggu penyelesaian."
            );
          },


        onError:
          function(result) {

            console.error(
              "Pembayaran gagal:",
              result
            );

            alert(
              "Pembayaran gagal. Silakan coba lagi."
            );
          },


        onClose:
          function() {

            console.log(
              "Popup pembayaran ditutup."
            );
          }

      }
    );


  } catch (err) {

    console.error(
      "Checkout error:",
      err
    );

    alert(
      err.message ||
      "Gagal membuat pesanan."
    );

  } finally {

    if (btn) {

      btn.disabled = false;

      btn.textContent =
        "Lanjut ke Pembayaran";
    }
  }
}


/* =========================
   PAYMENT SUCCESS / PENDING
========================= */

function paymentDone(
  code,
  msg
) {

  alert(
    `${msg}\n\nNomor pesanan: ${code}`
  );

  cart = {};

  saveCart();

  renderCart();

  closeCheckout();

  closeCart();

  /*
    Refresh data produk supaya
    stok di website mengikuti
    database.
  */

  api("/api/products")
    .then((data) => {

      products = data;

      renderProducts();

      renderCart();

    })
    .catch((error) => {

      console.error(
        "Gagal memperbarui stok:",
        error
      );
    });
}


/* =========================
   RESELLER
========================= */

async function reseller(e) {

  e.preventDefault();

  const name =
    document.getElementById(
      "r-name"
    ).value.trim();

  const business =
    document.getElementById(
      "r-business"
    ).value.trim();

  const type =
    document.getElementById(
      "r-type"
    ).value;


  if (!name || !business) {

    alert(
      "Nama dan nama usaha wajib diisi."
    );

    return;
  }


  if (!config.whatsapp) {

    alert(
      "Nomor WhatsApp toko belum diatur."
    );

    return;
  }


  const cleanWhatsapp =
    String(config.whatsapp)
      .replace(/\D/g, "");


  const message =
    `Halo Andalé Coffee,%0A%0A` +
    `Saya tertarik menjadi reseller.%0A%0A` +
    `Nama: ${encodeURIComponent(name)}%0A` +
    `Usaha: ${encodeURIComponent(business)}%0A` +
    `Jenis: ${encodeURIComponent(type)}`;


  const url =
    `https://wa.me/${cleanWhatsapp}?text=${message}`;


  window.open(
    url,
    "_blank"
  );
}


/* =========================
   SECURITY
========================= */

function escapeHtml(s) {

  return String(s ?? "")
    .replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        })[m]
    );
}


/* =========================
   EVENT LISTENERS
========================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    const openCartButton =
      document.getElementById(
        "open-cart"
      );

    const closeCartButton =
      document.getElementById(
        "close-cart"
      );

    const cartOverlay =
      document.getElementById(
        "cart-overlay"
      );

    const checkoutButton =
      document.getElementById(
        "checkout-btn"
      );

    const closeCheckoutButton =
      document.getElementById(
        "close-checkout"
      );

    const checkoutForm =
      document.getElementById(
        "checkout-form"
      );

    const resellerForm =
      document.getElementById(
        "reseller-form"
      );


    if (openCartButton) {

      openCartButton.onclick =
        openCart;
    }


    if (closeCartButton) {

      closeCartButton.onclick =
        closeCart;
    }


    if (cartOverlay) {

      cartOverlay.onclick =
        closeCart;
    }


    if (checkoutButton) {

      checkoutButton.onclick =
        openCheckout;
    }


    if (closeCheckoutButton) {

      closeCheckoutButton.onclick =
        closeCheckout;
    }


    if (checkoutForm) {

      checkoutForm.addEventListener(
        "submit",
        checkout
      );
    }


    if (resellerForm) {

      resellerForm.addEventListener(
        "submit",
        reseller
      );
    }


    /*
      Klik area luar modal
      untuk menutup checkout.
    */

    const checkoutModal =
      document.getElementById(
        "checkout-modal"
      );

    if (checkoutModal) {

      checkoutModal.addEventListener(
        "click",
        (e) => {

          if (
            e.target ===
            checkoutModal
          ) {

            closeCheckout();
          }
        }
      );
    }


    /*
      Tekan ESC untuk menutup
      keranjang atau checkout.
    */

    document.addEventListener(
      "keydown",
      (e) => {

        if (e.key === "Escape") {

          closeCart();

          closeCheckout();
        }
      }
    );


    /*
      Jalankan website.
    */

    init();
  }
);