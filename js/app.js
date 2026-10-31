/* LUCA STORE — หน้าร้าน (ไม่ต้อง build ใช้กับ GitHub Pages ได้ทันที) */
(function () {
  "use strict";

  var CFG = window.LUCA_CONFIG || {};
  var LIVE = !!CFG.APPS_SCRIPT_URL;
  var STORE = null;
  var app = document.getElementById("app");

  var PROVINCES = ["กรุงเทพมหานคร","กระบี่","กาญจนบุรี","กาฬสินธุ์","กำแพงเพชร","ขอนแก่น","จันทบุรี","ฉะเชิงเทรา","ชลบุรี","ชัยนาท","ชัยภูมิ","ชุมพร","เชียงราย","เชียงใหม่","ตรัง","ตราด","ตาก","นครนายก","นครปฐม","นครพนม","นครราชสีมา","นครศรีธรรมราช","นครสวรรค์","นนทบุรี","นราธิวาส","น่าน","บึงกาฬ","บุรีรัมย์","ปทุมธานี","ประจวบคีรีขันธ์","ปราจีนบุรี","ปัตตานี","พระนครศรีอยุธยา","พะเยา","พังงา","พัทลุง","พิจิตร","พิษณุโลก","เพชรบุรี","เพชรบูรณ์","แพร่","ภูเก็ต","มหาสารคาม","มุกดาหาร","แม่ฮ่องสอน","ยโสธร","ยะลา","ร้อยเอ็ด","ระนอง","ระยอง","ราชบุรี","ลพบุรี","ลำปาง","ลำพูน","เลย","ศรีสะเกษ","สกลนคร","สงขลา","สตูล","สมุทรปราการ","สมุทรสงคราม","สมุทรสาคร","สระแก้ว","สระบุรี","สิงห์บุรี","สุโขทัย","สุพรรณบุรี","สุราษฎร์ธานี","สุรินทร์","หนองคาย","หนองบัวลำภู","อ่างทอง","อำนาจเจริญ","อุดรธานี","อุตรดิตถ์","อุทัยธานี","อุบลราชธานี"];

  var STEPS = ["สั่งซื้อแล้ว", "ยืนยันออเดอร์", "เตรียมจัดส่ง", "จัดส่งแล้ว"];
  var STATUS_STEP = {
    "รอชำระเงิน": 1, "รอตรวจสอบสลิป": 1, "ชำระแล้ว": 2, "เก็บเงินปลายทาง": 2,
    "กำลังเตรียมจัดส่ง": 3, "จัดส่งแล้ว": 4, "สำเร็จ": 4,
  };

  /* ---------------- utils ---------------- */
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function baht(n) { return "฿" + Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 }); }
  function load(key, def) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage ไม่พร้อมใช้งาน */ } }
  function product(id) { return STORE.products.filter(function (p) { return p.id === id; })[0]; }
  function collection(id) { return STORE.collections.filter(function (c) { return c.id === id; })[0]; }
  function colorOf(p, name) { return p.colors.filter(function (c) { return c.name === name; })[0] || p.colors[0]; }
  function isSoldOut(p, color, size) {
    var s = p.soldOut || [];
    return s.indexOf(color) >= 0 || (size && s.indexOf(color + "/" + size) >= 0);
  }
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return iso; }
  }

  /* ---------------- API (Google Apps Script) ---------------- */
  function api(action, data) {
    return fetch(CFG.APPS_SCRIPT_URL, {
      method: "POST",
      // text/plain เพื่อไม่ให้เกิด CORS preflight (Apps Script ไม่รองรับ OPTIONS)
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: action, data: data }),
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) throw new Error(res.error || "เกิดข้อผิดพลาด");
      return res;
    });
  }
  function apiGet(params) {
    var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(CFG.APPS_SCRIPT_URL + (CFG.APPS_SCRIPT_URL.indexOf("?") >= 0 ? "&" : "?") + qs)
      .then(function (r) { return r.json(); })
      .then(function (res) { if (!res.ok) throw new Error(res.error || "เกิดข้อผิดพลาด"); return res; });
  }

  /* ---------------- cart ---------------- */
  var cart = load("luca_cart_v1", []);

  function cartKey(id, color, size) { return id + "|" + color + "|" + size; }
  function validCart() {
    // ตัดสินค้าที่ถูกลบออกจาก store.json แล้ว
    cart = cart.filter(function (l) {
      var p = product(l.id);
      return p && p.colors.some(function (c) { return c.name === l.color; }) && STORE.sizes.indexOf(l.size) >= 0;
    });
  }
  function cartQty() { return cart.reduce(function (s, l) { return s + l.qty; }, 0); }
  function saveCart() {
    save("luca_cart_v1", cart);
    var c = $("#cartCount");
    c.textContent = cartQty();
    c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
    renderDrawer();
  }
  function addToCart(id, color, size, qty) {
    var key = cartKey(id, color, size);
    var line = cart.filter(function (l) { return l.key === key; })[0];
    if (line) line.qty = Math.min(50, line.qty + qty);
    else cart.push({ key: key, id: id, color: color, size: size, qty: qty });
    saveCart();
  }
  function setQty(key, qty) {
    cart = cart.map(function (l) { if (l.key === key) l.qty = Math.max(1, Math.min(50, qty | 0)); return l; });
    saveCart();
  }
  function removeLine(key) {
    cart = cart.filter(function (l) { return l.key !== key; });
    saveCart();
  }

  function openDrawer() {
    renderDrawer();
    $("#cartDrawer").classList.add("open");
    $("#cartDrawer").setAttribute("aria-hidden", "false");
    $("#drawerBackdrop").classList.add("open");
  }
  function closeDrawer() {
    $("#cartDrawer").classList.remove("open");
    $("#cartDrawer").setAttribute("aria-hidden", "true");
    $("#drawerBackdrop").classList.remove("open");
  }

  function lineHTML(l, compact) {
    var p = product(l.id);
    var c = colorOf(p, l.color);
    return '<div class="line">' +
      '<a href="#/p/' + esc(p.id) + '?color=' + encodeURIComponent(c.name) + '"><img src="' + esc(c.images[0]) + '" alt=""></a>' +
      '<div><a class="line-name" href="#/p/' + esc(p.id) + '?color=' + encodeURIComponent(c.name) + '">' + esc(p.name) + '</a>' +
      '<div class="line-meta">สี' + esc(c.label) + ' · ไซซ์ ' + esc(l.size) + (compact ? ' · x' + l.qty : '') + '</div>' +
      (compact ? '' :
        '<div class="row-between"><div class="qty sm"><button data-act="dec" data-key="' + esc(l.key) + '" aria-label="ลด">−</button>' +
        '<input type="number" min="1" max="50" value="' + l.qty + '" data-act="qty" data-key="' + esc(l.key) + '" aria-label="จำนวน">' +
        '<button data-act="inc" data-key="' + esc(l.key) + '" aria-label="เพิ่ม">+</button></div>' +
        '<button class="link-btn" data-act="remove" data-key="' + esc(l.key) + '">ลบ</button></div>') +
      '</div><div class="line-price">' + baht(p.price * l.qty) + '</div></div>';
  }

  function freeShipHTML(amount) {
    if (!STORE.freeShippingMin) return "";
    var left = STORE.freeShippingMin - amount;
    var pct = Math.min(100, Math.round(amount / STORE.freeShippingMin * 100));
    return '<div class="free-bar">' + (left > 0 ? 'ซื้ออีก <b>' + baht(left) + '</b> รับสิทธิ์ส่งฟรี!' : '🎉 คุณได้รับสิทธิ์<b>ส่งฟรี</b>แล้ว') +
      '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
  }

  function renderDrawer() {
    if (!STORE) return;
    var body = $("#cartBody"), foot = $("#cartFoot");
    if (!cart.length) {
      body.innerHTML = '<div class="empty"><div class="big">EMPTY</div><p class="muted">ยังไม่มีสินค้าในตะกร้า</p>' +
        '<a href="#/shop" class="btn btn-yellow" data-act="close-drawer">เลือกซื้อสินค้า</a></div>';
      foot.innerHTML = "";
      return;
    }
    var t = lucaCalcTotals(STORE, cart, null, null, null);
    body.innerHTML = cart.map(function (l) { return lineHTML(l); }).join("");
    foot.innerHTML = freeShipHTML(t.subtotal) +
      '<div class="row-between total-row"><span>ยอดรวม</span><span>' + baht(t.subtotal) + '</span></div>' +
      '<a href="#/checkout" class="btn btn-dark btn-block" data-act="close-drawer">ไปชำระเงิน →</a>' +
      '<p class="note" style="text-align:center;margin:10px 0 0">ค่าส่งและส่วนลดคำนวณในขั้นตอนถัดไป</p>';
  }

  /* ---------------- local orders ---------------- */
  function localOrders() { return load("luca_orders_v1", []); }
  function saveLocalOrder(o) {
    var list = localOrders().filter(function (x) { return x.id !== o.id; });
    list.unshift(o);
    save("luca_orders_v1", list.slice(0, 30));
  }
  function getLocalOrder(id) { return localOrders().filter(function (o) { return o.id === id; })[0]; }

  function orderText(o) {
    var t = o.totals;
    var lines = t.lines.map(function (l) { return "- " + l.name + " (" + l.colorLabel + "/" + l.size + ") x" + l.qty + " = " + baht(l.total); });
    var c = o.customer;
    return [
      "🛒 คำสั่งซื้อ LUCA #" + o.id,
      lines.join("\n"),
      "ค่าสินค้า: " + baht(t.subtotal),
      t.discount ? "ส่วนลด (" + t.coupon + "): -" + baht(t.discount) : "",
      "ค่าส่ง (" + t.shippingName + "): " + (t.shippingFee ? baht(t.shippingFee) : "ฟรี"),
      t.codFee ? "ค่าบริการเก็บเงินปลายทาง: " + baht(t.codFee) : "",
      "ยอดชำระ: " + baht(t.total),
      "ชำระโดย: " + (o.payment === "cod" ? "เก็บเงินปลายทาง" : "พร้อมเพย์ / โอนเงิน"),
      "",
      "ผู้รับ: " + c.name + " " + c.phone,
      "ที่อยู่: " + [c.address, c.subdistrict, c.district, c.province, c.postcode].join(" "),
      c.note ? "หมายเหตุ: " + c.note : "",
    ].filter(function (x) { return x !== ""; }).join("\n");
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("คัดลอกแล้ว"); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("คัดลอกแล้ว"); } catch (e) { toast("คัดลอกไม่สำเร็จ"); }
    ta.remove();
  }

  /* ---------------- shared pieces ---------------- */
  function cardHTML(p) {
    var c = p.colors[0];
    var all = p.colors.every(function (col) { return isSoldOut(p, col.name); });
    var badge = all ? '<span class="badge gray">Sold out</span>' :
      p.badge ? '<span class="badge' + (p.badge.toLowerCase() === "new" ? " red" : "") + '">' + esc(p.badge) + '</span>' : "";
    var coll = collection(p.collection);
    return '<article class="card">' +
      '<a class="card-img" href="#/p/' + esc(p.id) + '">' + badge + '<img loading="lazy" src="' + esc(c.images[0]) + '" alt="' + esc(p.name) + '"></a>' +
      '<div class="card-body">' +
      (coll ? '<div class="card-coll">' + esc(coll.name) + '</div>' : '') +
      '<a class="card-title" href="#/p/' + esc(p.id) + '">' + esc(p.name) + '</a>' +
      '<div class="price">' + baht(p.price) + (p.compareAt ? '<s>' + baht(p.compareAt) + '</s>' : '') + '</div>' +
      '<div class="card-foot"><div class="swatches">' +
      p.colors.map(function (col) { return '<span class="swatch" title="' + esc(col.label) + '" style="background:' + esc(col.hex) + '"></span>'; }).join("") +
      '</div><a class="btn btn-sm btn-yellow" href="#/p/' + esc(p.id) + '">เลือกไซซ์</a></div>' +
      '</div></article>';
  }

  function sizeTableHTML() {
    var sc = STORE.sizeChart;
    return '<table class="size-table"><thead><tr><th>' + esc(sc.unit) + '</th>' +
      STORE.sizes.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join("") + '</tr></thead><tbody>' +
      sc.rows.map(function (r) {
        return '<tr><td>' + esc(r.label) + '</td>' + r.values.map(function (v) { return '<td>' + esc(v) + '</td>'; }).join("") + '</tr>';
      }).join("") + '</tbody></table>';
  }

  var ICONS = {
    instagram: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M14 8V6.5c0-.8.2-1.5 1.5-1.5H17V2h-2.6C11.6 2 11 3.9 11 6v2H9v3h2v11h3V11h2.6l.4-3z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.5 2c.3 2.4 1.7 4 4 4.2v3.1c-1.5.1-2.8-.4-4-1.2v6.6c0 3.6-2.7 6.3-6.2 6.3S4 18.2 4 14.8c0-3.7 3.1-6.4 6.9-5.9v3.3c-1.9-.4-3.6.8-3.6 2.6 0 1.5 1.2 2.7 2.9 2.7 1.8 0 3-1.2 3-3.3V2h3.3z"/></svg>',
    line: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5 1.1-.5 6-3.5 8.2-6 1.5-1.6 1.8-3.2 1.8-4.8 0-4.4-4.5-8-10-8z"/></svg>',
    email: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  };
  function socialHTML() {
    var c = CFG.CONTACT || {};
    return Object.keys(ICONS).filter(function (k) { return c[k]; }).map(function (k) {
      var href = k === "email" ? "mailto:" + c[k] : c[k];
      return '<a href="' + esc(href) + '" target="_blank" rel="noopener" aria-label="' + k + '">' + ICONS[k] + '</a>';
    }).join("");
  }
  function chatLinks() {
    var c = CFG.CONTACT || {};
    var out = [];
    if (c.line) out.push('<a class="btn btn-sm" target="_blank" rel="noopener" href="' + esc(c.line) + '">LINE</a>');
    if (c.instagram) out.push('<a class="btn btn-sm" target="_blank" rel="noopener" href="' + esc(c.instagram) + '">Instagram</a>');
    if (c.facebook) out.push('<a class="btn btn-sm" target="_blank" rel="noopener" href="' + esc(c.facebook) + '">Facebook</a>');
    return out.join(" ");
  }

  /* ---------------- views ---------------- */
  function viewHome() {
    var featured = STORE.products;
    var marq = "GOOD GAME ★ LUCA RANGERS ★ FAILURE IS PART OF THE LEARNING PROCESS ★ じどうはんばいき ★ PRESS START ★ ";
    return '' +
      '<section class="hero"><div class="wrap hero-in">' +
      '<div><span class="kicker">NEW DROP</span>' +
      '<h1>GOOD GAME</h1><p class="sub">COLLECTION</p>' +
      '<p class="lead">เสื้อยืดลายกราฟิกสไตล์เกมย้อนยุคและการ์ตูนที่เราโตมาด้วยกัน ออกแบบโดย <b>LUCA</b> สั่งตรงจากแบรนด์ ไม่ผ่านคนกลาง</p>' +
      '<div class="hero-ctas"><a href="#/shop" class="btn btn-dark">ช้อปเลย →</a><a href="#/shop?c=good-game" class="btn">ดูคอลเลกชัน</a></div>' +
      '<div class="hero-badges"><span>ไซซ์ M – 2XL</span><span>ชำระผ่านพร้อมเพย์</span>' + (STORE.freeShippingMin ? '<span>ส่งฟรีครบ ' + baht(STORE.freeShippingMin) + '</span>' : '') + '</div>' +
      '</div>' +
      '<div class="hero-art"><img class="a1" src="assets/img/goodgame-photo.jpg" alt="เสื้อ GOOD GAME สีขาว พร้อมป้ายแท็ก">' +
      '<img class="a2" src="assets/img/goodgame-tag.jpg" alt="ป้ายแท็ก GOOD GAME COLLECTION">' +
      '<div class="sticker">PRESS<br>START</div></div>' +
      '</div></section>' +
      '<div class="marquee" aria-hidden="true"><div class="marquee-track">' +
      (marq + marq).split("★").map(function (s) { return "<span>" + esc(s.trim()) + "</span>★"; }).join("") +
      '</div></div>' +

      '<section class="section"><div class="wrap">' +
      '<div class="section-head"><div><h2>ALL ITEMS</h2><p>เลือกลายที่ใช่ ใส่แล้วเป็นตัวเอง</p></div><a href="#/shop" class="btn btn-sm">ดูทั้งหมด →</a></div>' +
      '<div class="grid">' + featured.map(cardHTML).join("") + '</div>' +
      '</div></section>' +

      '<section class="section" style="padding-top:0"><div class="wrap">' +
      '<div class="section-head"><div><h2>COLLECTIONS</h2><p>เลือกตามคอลเลกชัน</p></div></div>' +
      '<div class="coll-grid">' + STORE.collections.map(function (c) {
        return '<a class="coll" href="#/shop?c=' + esc(c.id) + '"><img loading="lazy" src="' + esc(c.image) + '" alt="' + esc(c.name) + '">' +
          '<div class="coll-label"><b>' + esc(c.name) + '</b><small>' + esc(c.tagline) + '</small></div></a>';
      }).join("") + '</div></div></section>' +

      '<section class="section band-dark quote-band"><div class="wrap">' +
      '<h2>FAILURE IS PART OF<br>THE LEARNING PROCESS</h2>' +
      '<p style="color:#cfc9b8;margin:0 0 22px">แพ้ได้ เรียนรู้ได้ แล้วกด Continue ใหม่ — ลายใหม่ล่าสุดจาก Good Game Collection</p>' +
      '<a href="#/p/failure-learning-tee" class="btn btn-yellow">ดูลายนี้ →</a>' +
      '</div></section>' +

      '<section class="section"><div class="wrap">' +
      '<div class="section-head"><div><h2>HOW TO ORDER</h2><p>สั่งง่าย จบในหน้าเดียว</p></div><a href="#/how" class="btn btn-sm">รายละเอียด</a></div>' +
      '<div class="steps">' +
      '<div class="step"><b>เลือกลาย สี ไซซ์</b><p>ดูตารางไซซ์ก่อนสั่งได้ทุกหน้า</p></div>' +
      '<div class="step"><b>กรอกที่อยู่จัดส่ง</b><p>เลือกขนส่งและใส่โค้ดส่วนลด</p></div>' +
      '<div class="step"><b>สแกนจ่ายพร้อมเพย์</b><p>QR ใส่ยอดให้อัตโนมัติ แนบสลิปในเว็บได้เลย</p></div>' +
      '<div class="step"><b>รอรับของ</b><p>ติดตามสถานะและเลขพัสดุได้ที่หน้า “ติดตามออเดอร์”</p></div>' +
      '</div></div></section>' +

      '<section class="section" style="padding-top:0"><div class="wrap"><div class="features">' +
      '<div class="feature"><div class="ico">👕</div><b>ไซซ์ M – 2XL</b><p>รอบอก 40–52 นิ้ว ใส่ได้ทุกคน</p></div>' +
      '<div class="feature"><div class="ico">🎨</div><b>ลายออกแบบเอง</b><p>ลิขสิทธิ์ LUCA หาที่อื่นไม่ได้</p></div>' +
      '<div class="feature"><div class="ico">📦</div><b>ส่งทั่วไทย</b><p>' + (STORE.freeShippingMin ? 'ส่งฟรีเมื่อซื้อครบ ' + baht(STORE.freeShippingMin) : 'แพ็คอย่างดีทุกออเดอร์') + '</p></div>' +
      '<div class="feature"><div class="ico">💳</div><b>จ่ายง่าย</b><p>พร้อมเพย์' + (STORE.cod && STORE.cod.enabled ? ' หรือเก็บเงินปลายทาง' : '') + '</p></div>' +
      '</div></div></section>';
  }

  function viewShop(q) {
    var c = q.get("c") || "";
    var color = q.get("color") || "";
    var sort = q.get("sort") || "";
    var list = STORE.products.filter(function (p) {
      return (!c || p.collection === c) && (!color || p.colors.some(function (x) { return x.name === color; }));
    });
    if (sort === "low") list = list.slice().sort(function (a, b) { return a.price - b.price; });
    if (sort === "high") list = list.slice().sort(function (a, b) { return b.price - a.price; });
    var coll = collection(c);
    function link(params) {
      var p = { c: c, color: color, sort: sort };
      Object.keys(params).forEach(function (k) { p[k] = params[k]; });
      var qs = Object.keys(p).filter(function (k) { return p[k]; }).map(function (k) { return k + "=" + encodeURIComponent(p[k]); }).join("&");
      return "#/shop" + (qs ? "?" + qs : "");
    }
    var colors = [];
    STORE.products.forEach(function (p) { p.colors.forEach(function (x) { if (!colors.some(function (y) { return y.name === x.name; })) colors.push(x); }); });

    return '<div class="wrap shop-top">' +
      '<div class="crumbs"><a href="#/">หน้าแรก</a> / ' + (coll ? '<a href="#/shop">สินค้าทั้งหมด</a> / ' + esc(coll.name) : 'สินค้าทั้งหมด') + '</div>' +
      '<h1 class="page-title">' + esc(coll ? coll.name.toUpperCase() : "SHOP ALL") + '</h1>' +
      (coll ? '<p class="muted" style="margin:6px 0 0">' + esc(coll.tagline) + '</p>' : '<p class="muted" style="margin:6px 0 0">' + STORE.products.length + ' รายการ</p>') +
      '<div class="filters">' +
      '<a class="chip' + (!c ? ' active' : '') + '" href="' + link({ c: "" }) + '">ทั้งหมด</a>' +
      STORE.collections.map(function (x) { return '<a class="chip' + (c === x.id ? ' active' : '') + '" href="' + link({ c: x.id }) + '">' + esc(x.name) + '</a>'; }).join("") +
      '<span class="spacer"></span>' +
      colors.map(function (x) {
        return '<a class="chip' + (color === x.name ? ' active' : '') + '" href="' + link({ color: color === x.name ? "" : x.name }) + '">' +
          '<span class="swatch" style="display:inline-block;vertical-align:-4px;width:16px;height:16px;margin-right:6px;background:' + esc(x.hex) + '"></span>' + esc(x.label) + '</a>';
      }).join("") +
      '<select class="input" data-act="sort" aria-label="เรียงลำดับ">' +
      '<option value="">แนะนำ</option><option value="low"' + (sort === "low" ? " selected" : "") + '>ราคา ต่ำ → สูง</option><option value="high"' + (sort === "high" ? " selected" : "") + '>ราคา สูง → ต่ำ</option>' +
      '</select></div>' +
      (list.length ? '<div class="grid" style="margin-bottom:70px">' + list.map(cardHTML).join("") + '</div>' :
        '<div class="empty"><div class="big">NO ITEMS</div><p class="muted">ไม่พบสินค้าตามตัวกรองนี้</p><a class="btn" href="#/shop">ดูสินค้าทั้งหมด</a></div>') +
      '</div>';
  }

  var pdp = {};
  function viewProduct(id, q) {
    var p = product(id);
    if (!p) return viewNotFound();
    var reqColor = q.get("color");
    if (pdp.id !== id) pdp = { id: id, color: (colorOf(p, reqColor) || p.colors[0]).name, size: "", qty: 1, img: 0 };
    else if (reqColor && reqColor !== pdp.color && p.colors.some(function (c) { return c.name === reqColor; })) { pdp.color = reqColor; pdp.img = 0; }
    return '<div class="wrap"><div class="crumbs"><a href="#/">หน้าแรก</a> / <a href="#/shop?c=' + esc(p.collection) + '">' +
      esc((collection(p.collection) || {}).name || "สินค้า") + '</a> / ' + esc(p.name) + '</div>' +
      '<div class="pdp" id="pdp">' + pdpInner(p) + '</div></div>';
  }
  function pdpInner(p) {
    var c = colorOf(p, pdp.color);
    var img = c.images[pdp.img] || c.images[0];
    var colorOut = isSoldOut(p, c.name);
    return '<div><div class="gallery-main"><img src="' + esc(img) + '" alt="' + esc(p.name + " สี" + c.label) + '"></div>' +
      (c.images.length > 1 ? '<div class="thumbs">' + c.images.map(function (src, i) {
        return '<button class="thumb' + (i === pdp.img ? ' active' : '') + '" data-act="img" data-i="' + i + '" aria-label="รูปที่ ' + (i + 1) + '"><img src="' + esc(src) + '" alt=""></button>';
      }).join("") + '</div>' : '') + '</div>' +

      '<div class="pdp-info">' +
      '<span class="kicker">' + esc((collection(p.collection) || {}).name || "LUCA") + '</span>' +
      '<h1>' + esc(p.name) + '</h1>' +
      '<div class="price">' + baht(p.price) + (p.compareAt ? '<s>' + baht(p.compareAt) + '</s>' : '') + '</div>' +
      '<p>' + esc(p.description) + '</p>' +

      '<div class="opt-label">สี: ' + esc(c.label) + '</div><div class="opts">' +
      p.colors.map(function (col) {
        return '<button class="opt' + (col.name === c.name ? ' active' : '') + '" data-act="color" data-v="' + esc(col.name) + '">' +
          '<span class="swatch" style="background:' + esc(col.hex) + '"></span>' + esc(col.label) + '</button>';
      }).join("") + '</div>' +

      '<div class="opt-label">ไซซ์ <a href="#size-chart" class="link-btn" data-act="to-chart">ดูตารางไซซ์</a></div><div class="opts">' +
      STORE.sizes.map(function (s) {
        var out = isSoldOut(p, c.name, s);
        return '<button class="opt' + (pdp.size === s ? ' active' : '') + '" data-act="size" data-v="' + esc(s) + '"' + (out ? ' disabled title="สินค้าหมด"' : '') + '>' + esc(s) + '</button>';
      }).join("") + '</div>' +

      '<div class="opt-label">จำนวน</div>' +
      '<div class="qty"><button data-act="pdp-dec" aria-label="ลด">−</button><input id="pdpQty" type="number" min="1" max="50" value="' + pdp.qty + '" aria-label="จำนวน"><button data-act="pdp-inc" aria-label="เพิ่ม">+</button></div>' +
      '<div id="pdpErr" class="err"></div>' +

      '<div class="buy-row">' + (colorOut ?
        '<button class="btn btn-block" disabled>สินค้าหมด</button>' :
        '<button class="btn btn-yellow" data-act="add">ใส่ตะกร้า</button><button class="btn btn-dark" data-act="buy">ซื้อเลย</button>') + '</div>' +

      '<ul class="perks">' +
      (STORE.freeShippingMin ? '<li>🚚 ส่งฟรีเมื่อซื้อครบ ' + baht(STORE.freeShippingMin) + '</li>' : '') +
      '<li>💳 ชำระผ่านพร้อมเพย์ สแกนจ่ายได้ทุกธนาคาร' + (STORE.cod && STORE.cod.enabled ? ' / เก็บเงินปลายทาง' : '') + '</li>' +
      '<li>🔁 เปลี่ยนไซซ์ได้ภายใน 7 วัน (ดู <a href="#/faq">เงื่อนไข</a>)</li></ul>' +

      '<div style="margin-top:26px">' +
      '<details class="acc" open><summary>รายละเอียดสินค้า</summary><ul>' + (p.details || []).map(function (d) { return '<li>' + esc(d) + '</li>'; }).join("") + '</ul></details>' +
      '<details class="acc" id="size-chart"><summary>ตารางไซซ์ (' + esc(STORE.sizeChart.unit) + ')</summary>' + sizeTableHTML() +
      '<p class="note">วัดแบบวางราบ รอบอก = ความกว้าง x 2 · ค่าอาจคลาดเคลื่อน ±1 นิ้ว</p></details>' +
      '<details class="acc"><summary>การจัดส่ง</summary><ul>' + STORE.shipping.map(function (s) {
        return '<li>' + esc(s.name) + ' — ' + baht(s.fee) + ' (' + esc(s.days) + ')</li>';
      }).join("") + '</ul></details>' +
      '</div></div>';
  }
  function rerenderPdp() {
    var p = product(pdp.id);
    var el = $("#pdp");
    if (p && el) el.innerHTML = pdpInner(p);
  }
  function pdpAdd(goCheckout) {
    var p = product(pdp.id);
    var qty = Math.max(1, Math.min(50, parseInt(($("#pdpQty") || {}).value, 10) || 1));
    if (!pdp.size) { $("#pdpErr").textContent = "กรุณาเลือกไซซ์"; return; }
    addToCart(p.id, pdp.color, pdp.size, qty);
    if (goCheckout) { location.hash = "#/checkout"; return; }
    toast("เพิ่ม " + p.name + " (" + pdp.size + ") ลงตะกร้าแล้ว");
    openDrawer();
  }

  /* ---------- checkout ---------- */
  var co = load("luca_checkout_v1", { shipping: "", payment: "promptpay", coupon: "", customer: {} });
  function saveCo() { save("luca_checkout_v1", co); }

  function viewCheckout() {
    validCart();
    if (!cart.length) {
      return '<div class="narrow empty"><div class="big">EMPTY CART</div><p class="muted">ยังไม่มีสินค้าในตะกร้า</p><a class="btn btn-yellow" href="#/shop">เลือกซื้อสินค้า</a></div>';
    }
    if (!co.shipping || !STORE.shipping.some(function (s) { return s.id === co.shipping; })) co.shipping = STORE.shipping[0].id;
    if (co.payment === "cod" && !(STORE.cod && STORE.cod.enabled)) co.payment = "promptpay";
    var c = co.customer || {};
    function f(name, label, attrs) {
      return '<label class="field"><span>' + label + '</span><input class="input" name="' + name + '" value="' + esc(c[name] || "") + '" ' + (attrs || "") + '></label>';
    }
    return '<div class="wrap"><div class="crumbs" style="padding-bottom:0"><a href="#/">หน้าแรก</a> / ชำระเงิน</div></div>' +
      '<form class="wrap checkout" id="coForm" novalidate>' +
      '<div>' +
      '<h1 class="page-title" style="margin-bottom:20px">CHECKOUT</h1>' +
      '<div class="panel"><h3><span class="n">1</span>ข้อมูลผู้รับ</h3>' +
      '<div class="grid-2">' + f("name", "ชื่อ-นามสกุล *", 'autocomplete="name" required') +
      f("phone", "เบอร์โทรศัพท์ *", 'type="tel" inputmode="numeric" autocomplete="tel" placeholder="08xxxxxxxx" required') + '</div>' +
      f("email", "อีเมล (ไม่บังคับ — สำหรับรับแจ้งเลขพัสดุ)", 'type="email" autocomplete="email"') +
      f("address", "ที่อยู่ (บ้านเลขที่ หมู่บ้าน ซอย ถนน) *", 'autocomplete="street-address" required') +
      '<div class="grid-2">' + f("subdistrict", "แขวง / ตำบล *", 'required') + f("district", "เขต / อำเภอ *", 'required') + '</div>' +
      '<div class="grid-2"><label class="field"><span>จังหวัด *</span><select class="input" name="province" required><option value="">เลือกจังหวัด</option>' +
      PROVINCES.map(function (pv) { return '<option' + (c.province === pv ? ' selected' : '') + '>' + pv + '</option>'; }).join("") + '</select></label>' +
      f("postcode", "รหัสไปรษณีย์ *", 'inputmode="numeric" maxlength="5" autocomplete="postal-code" required') + '</div>' +
      '<label class="field"><span>หมายเหตุถึงร้าน (ไม่บังคับ)</span><textarea class="input" name="note" rows="2">' + esc(c.note || "") + '</textarea></label>' +
      '</div>' +

      '<div class="panel"><h3><span class="n">2</span>การจัดส่ง</h3>' +
      STORE.shipping.map(function (s) {
        return '<label class="radio-card"><input type="radio" name="shipping" value="' + esc(s.id) + '"' + (co.shipping === s.id ? ' checked' : '') + '>' +
          '<span class="grow"><b>' + esc(s.name) + '</b><small>' + esc(s.days) + '</small></span><b>' + baht(s.fee) + '</b></label>';
      }).join("") +
      (STORE.freeShippingMin ? '<p class="note">ส่งฟรีเมื่อยอดสินค้า (หลังหักส่วนลด) ครบ ' + baht(STORE.freeShippingMin) + '</p>' : '') +
      '</div>' +

      '<div class="panel"><h3><span class="n">3</span>วิธีชำระเงิน</h3>' +
      '<label class="radio-card"><input type="radio" name="payment" value="promptpay"' + (co.payment !== "cod" ? ' checked' : '') + '>' +
      '<span class="grow"><b>พร้อมเพย์ / โอนเงิน</b><small>สแกน QR จ่ายได้ทุกธนาคาร แล้วแนบสลิป</small></span><b>ฟรี</b></label>' +
      (STORE.cod && STORE.cod.enabled ? '<label class="radio-card"><input type="radio" name="payment" value="cod"' + (co.payment === "cod" ? ' checked' : '') + '>' +
        '<span class="grow"><b>เก็บเงินปลายทาง (COD)</b><small>จ่ายเงินสดกับพนักงานส่งของ</small></span><b>+' + baht(STORE.cod.fee) + '</b></label>' : '') +
      '</div></div>' +

      '<aside class="summary"><div class="panel"><h3>สรุปคำสั่งซื้อ</h3>' +
      '<div id="coLines"></div>' +
      '<div class="coupon"><input class="input" id="coupon" placeholder="โค้ดส่วนลด" value="' + esc(co.coupon) + '" aria-label="โค้ดส่วนลด"><button type="button" class="btn btn-sm" data-act="coupon">ใช้โค้ด</button></div>' +
      '<div id="coTotals"></div>' +
      '<div id="coErr" class="err"></div>' +
      '<button class="btn btn-dark btn-block" style="margin-top:16px" id="coSubmit" type="submit">ยืนยันคำสั่งซื้อ</button>' +
      '<p class="note" style="text-align:center;margin:10px 0 0">กดยืนยันแล้ว ระบบจะแสดง QR พร้อมเพย์พร้อมยอดเงิน</p>' +
      '</div></aside>' +
      '</form>';
  }

  function currentTotals() { return lucaCalcTotals(STORE, cart, co.shipping, co.payment, co.coupon); }

  function renderCoSummary() {
    var t = currentTotals();
    var lines = $("#coLines");
    if (!lines) return;
    lines.innerHTML = cart.map(function (l) { return lineHTML(l, true); }).join("");
    $("#coTotals").innerHTML =
      (t.couponError ? '<div class="err" style="margin-top:-2px;margin-bottom:8px">' + esc(t.couponError) + '</div>' : (t.coupon ? '<div class="ok" style="margin-top:-2px;margin-bottom:8px">ใช้โค้ด ' + esc(t.coupon) + ' แล้ว <button type="button" class="link-btn" data-act="coupon-clear">ยกเลิก</button></div>' : '')) +
      '<div class="sum-row"><span>ค่าสินค้า</span><span>' + baht(t.subtotal) + '</span></div>' +
      (t.discount ? '<div class="sum-row discount"><span>ส่วนลด (' + esc(t.coupon) + ')</span><span>−' + baht(t.discount) + '</span></div>' : '') +
      '<div class="sum-row"><span>ค่าจัดส่ง</span><span>' + (t.shippingFee ? baht(t.shippingFee) : '<b style="color:var(--green)">ฟรี</b>') + '</span></div>' +
      (t.codFee ? '<div class="sum-row"><span>ค่าบริการ COD</span><span>' + baht(t.codFee) + '</span></div>' : '') +
      '<div class="sum-total"><span>ยอดชำระ</span><span>' + baht(t.total) + '</span></div>';
  }

  function readCustomer(form) {
    var data = {};
    ["name", "phone", "email", "address", "subdistrict", "district", "province", "postcode", "note"].forEach(function (k) {
      var el = form.elements[k];
      data[k] = el ? String(el.value).trim() : "";
    });
    data.phone = data.phone.replace(/[^0-9]/g, "");
    return data;
  }

  function validateCustomer(form, c) {
    var bad = [];
    if (c.name.length < 2) bad.push("name");
    if (!/^0\d{8,9}$/.test(c.phone)) bad.push("phone");
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) bad.push("email");
    if (c.address.length < 3) bad.push("address");
    if (!c.subdistrict) bad.push("subdistrict");
    if (!c.district) bad.push("district");
    if (!c.province) bad.push("province");
    if (!/^\d{5}$/.test(c.postcode)) bad.push("postcode");
    $$(".input", form).forEach(function (el) { el.classList.toggle("invalid", bad.indexOf(el.name) >= 0); });
    if (bad.length) { var first = form.elements[bad[0]]; if (first) first.focus(); }
    return !bad.length;
  }

  function newOrderId() {
    var d = new Date();
    var ymd = String(d.getFullYear()).slice(2) + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
    var r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return "LUCA-" + ymd + "-" + r;
  }

  function submitCheckout(form) {
    var c = readCustomer(form);
    co.customer = c; saveCo();
    var err = $("#coErr");
    err.textContent = "";
    if (!validateCustomer(form, c)) { err.textContent = "กรุณากรอกข้อมูลที่มีกรอบสีแดงให้ถูกต้อง"; return; }
    var t = currentTotals();
    if (t.errors.length) { err.textContent = t.errors.join(", "); return; }
    if (t.couponError) { co.coupon = ""; saveCo(); }

    var btn = $("#coSubmit");
    btn.disabled = true; btn.textContent = "กำลังส่งคำสั่งซื้อ…";
    var payload = {
      customer: c,
      items: cart.map(function (l) { return { id: l.id, color: l.color, size: l.size, qty: l.qty }; }),
      shipping: co.shipping, payment: co.payment, coupon: t.coupon,
    };
    var done = function (id, totals, createdAt) {
      var order = { id: id, createdAt: createdAt || new Date().toISOString(), customer: c, payment: co.payment, totals: totals,
        status: co.payment === "cod" ? "เก็บเงินปลายทาง" : "รอชำระเงิน", slip: false, live: LIVE };
      saveLocalOrder(order);
      cart = []; saveCart();
      co.coupon = ""; saveCo();
      location.hash = "#/order/" + encodeURIComponent(id);
    };
    if (!LIVE) { done(newOrderId(), t); return; }
    api("createOrder", payload).then(function (res) {
      done(res.orderId, res.totals, res.createdAt);
    }).catch(function (e) {
      err.textContent = "ส่งคำสั่งซื้อไม่สำเร็จ: " + e.message + " — ลองใหม่อีกครั้ง หรือทักแชทร้าน";
      btn.disabled = false; btn.textContent = "ยืนยันคำสั่งซื้อ";
    });
  }

  /* ---------- order / payment ---------- */
  function viewOrder(id) {
    var o = getLocalOrder(id);
    if (!o) {
      return '<div class="narrow empty"><div class="big">NOT FOUND</div><p class="muted">ไม่พบคำสั่งซื้อนี้ในเครื่องนี้</p>' +
        '<a class="btn" href="#/track?id=' + encodeURIComponent(id) + '">ไปที่หน้าติดตามออเดอร์</a></div>';
    }
    var t = o.totals;
    var isCod = o.payment === "cod";
    var paid = o.slip || isCod;
    var head = '<div class="pay-head">' +
      (paid ? '<div class="done-icon">🎉</div><h1 class="page-title">THANK YOU!</h1>' : '<h1 class="page-title">PAYMENT</h1>') +
      '<p class="muted" style="margin:8px 0 0">' + (paid ? (isCod ? 'ได้รับคำสั่งซื้อแล้ว ชำระเงินกับพนักงานเมื่อได้รับสินค้า' : 'ได้รับสลิปแล้ว ร้านจะตรวจสอบและจัดส่งโดยเร็ว') :
        'สั่งซื้อสำเร็จ! กรุณาชำระเงินและแนบสลิปเพื่อยืนยันคำสั่งซื้อ') + '</p>' +
      '<div class="order-id">#' + esc(o.id) + '</div>' +
      '<p class="note" style="margin-top:10px">เก็บเลขคำสั่งซื้อนี้ไว้ใช้ติดตามสถานะ</p></div>';

    var left;
    if (!paid) {
      var payload = CFG.PROMPTPAY_ID ? LucaPromptPay.payload(CFG.PROMPTPAY_ID, t.total) : null;
      var qrSvg = "";
      if (payload && window.qrcode) {
        var qr = qrcode(0, "M"); qr.addData(payload); qr.make();
        qrSvg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      }
      var bank = CFG.BANK || {};
      left = '<div><div class="panel qr-box"><div class="pp-head">Thai QR Payment · พร้อมเพย์</div>' +
        (qrSvg ? qrSvg + (CFG.PROMPTPAY_NAME ? '<p style="margin:8px 0 0">ชื่อบัญชี: <b>' + esc(CFG.PROMPTPAY_NAME) + '</b></p>' : '') :
          '<div class="alert red">ร้านยังไม่ได้ตั้งค่าพร้อมเพย์ กรุณาติดต่อร้านเพื่อรับช่องทางชำระเงิน</div>') +
        '<div class="qr-amount">' + baht(t.total) + '</div>' +
        '<p class="note">สแกนด้วยแอปธนาคารใดก็ได้ ยอดเงินจะขึ้นอัตโนมัติ<br>หรือบันทึกภาพหน้าจอแล้วเลือก “สแกนจากรูปภาพ”</p>' +
        (bank.number ? '<div class="alert" style="text-align:left;margin-top:14px">หรือโอนเข้าบัญชี <b>' + esc(bank.bank) + '</b><br>เลขที่ <b>' + esc(bank.number) + '</b> ' +
          '<button type="button" class="link-btn" data-act="copy" data-text="' + esc(bank.number.replace(/[^0-9]/g, "")) + '">คัดลอก</button><br>ชื่อ ' + esc(bank.name) + '</div>' : '') +
        '</div>' +
        '<div class="panel"><h3><span class="n">✓</span>แนบสลิปการโอน</h3>' +
        (LIVE ?
          '<label class="drop" id="drop"><input type="file" accept="image/*" id="slipFile"><b>📎 แตะเพื่อเลือกรูปสลิป</b><br><span class="note">รองรับไฟล์รูปภาพ JPG / PNG</span><div id="slipPrev"></div></label>' +
          '<div id="slipErr" class="err"></div>' +
          '<button class="btn btn-dark btn-block" style="margin-top:14px" data-act="send-slip" data-id="' + esc(o.id) + '" id="slipBtn" disabled>ส่งสลิป</button>' :
          '<p>ส่งรูปสลิปพร้อมสรุปคำสั่งซื้อให้ร้านทางแชท:</p><div style="display:flex;gap:8px;flex-wrap:wrap">' + chatLinks() + '</div>' +
          '<button class="btn btn-yellow btn-block" style="margin-top:14px" data-act="copy-order" data-id="' + esc(o.id) + '">📋 คัดลอกสรุปคำสั่งซื้อ</button>') +
        '</div></div>';
    } else {
      left = '<div class="panel"><h3>ขั้นตอนต่อไป</h3><ol style="margin:0;padding-left:20px">' +
        (isCod ? '<li>ร้านจะแพ็คและจัดส่งภายใน 1–2 วันทำการ</li><li>เตรียมเงินสด <b>' + baht(t.total) + '</b> สำหรับชำระกับพนักงานส่งของ</li>' :
          '<li>ร้านตรวจสอบยอดโอน (ปกติภายในไม่กี่ชั่วโมง)</li><li>แพ็คและจัดส่งภายใน 1–2 วันทำการ</li>') +
        '<li>เลขพัสดุจะแสดงที่หน้า <a href="#/track?id=' + encodeURIComponent(o.id) + '&phone=' + encodeURIComponent(o.customer.phone) + '">ติดตามออเดอร์</a>' + (o.customer.email ? ' และส่งไปที่อีเมลของคุณ' : '') + '</li></ol>' +
        (!LIVE ? '<div class="alert" style="margin-top:16px">กรุณาส่งสรุปคำสั่งซื้อให้ร้านทางแชทเพื่อยืนยัน<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' + chatLinks() + '</div></div>' +
          '<button class="btn btn-yellow btn-block" data-act="copy-order" data-id="' + esc(o.id) + '">📋 คัดลอกสรุปคำสั่งซื้อ</button>' : '') +
        '<a class="btn btn-block" style="margin-top:14px" href="#/shop">ช้อปต่อ</a></div>';
    }

    var right = '<div class="panel"><h3>รายการสั่งซื้อ</h3>' +
      t.lines.map(function (l) {
        return '<div class="sum-row"><span>' + esc(l.name) + ' <span class="muted">(' + esc(l.colorLabel) + '/' + esc(l.size) + ') ×' + l.qty + '</span></span><span>' + baht(l.total) + '</span></div>';
      }).join("") +
      '<hr style="border:0;border-top:1.5px dashed #c9c3b2;margin:10px 0">' +
      '<div class="sum-row"><span>ค่าสินค้า</span><span>' + baht(t.subtotal) + '</span></div>' +
      (t.discount ? '<div class="sum-row discount"><span>ส่วนลด (' + esc(t.coupon) + ')</span><span>−' + baht(t.discount) + '</span></div>' : '') +
      '<div class="sum-row"><span>ค่าจัดส่ง · ' + esc(t.shippingName) + '</span><span>' + (t.shippingFee ? baht(t.shippingFee) : 'ฟรี') + '</span></div>' +
      (t.codFee ? '<div class="sum-row"><span>ค่าบริการ COD</span><span>' + baht(t.codFee) + '</span></div>' : '') +
      '<div class="sum-total"><span>ยอดชำระ</span><span>' + baht(t.total) + '</span></div>' +
      '<h3 style="margin-top:22px">จัดส่งถึง</h3><p style="margin:0">' + esc(o.customer.name) + ' · ' + esc(o.customer.phone) + '<br>' +
      esc([o.customer.address, o.customer.subdistrict, o.customer.district, o.customer.province, o.customer.postcode].join(" ")) + '</p>' +
      '</div>';

    return '<div class="pay">' + head + left + right + '</div>';
  }

  var slipData = null;
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("อ่านไฟล์ไม่สำเร็จ")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพ")); };
        img.onload = function () {
          var max = 1600, w = img.width, h = img.height;
          if (Math.max(w, h) > max) { var r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
          var cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          var ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function sendSlip(id) {
    var o = getLocalOrder(id);
    var btn = $("#slipBtn"), err = $("#slipErr");
    if (!o || !slipData) return;
    btn.disabled = true; btn.textContent = "กำลังส่ง…"; err.textContent = "";
    api("uploadSlip", { orderId: o.id, phone: o.customer.phone, image: slipData }).then(function () {
      o.slip = true; o.status = "รอตรวจสอบสลิป";
      saveLocalOrder(o);
      slipData = null;
      render();
      toast("ส่งสลิปเรียบร้อย ขอบคุณค่ะ");
    }).catch(function (e) {
      err.textContent = "ส่งไม่สำเร็จ: " + e.message;
      btn.disabled = false; btn.textContent = "ส่งสลิป";
    });
  }

  /* ---------- track ---------- */
  function viewTrack(q) {
    var id = q.get("id") || "", phone = q.get("phone") || "";
    var mine = localOrders();
    return '<div class="narrow"><h1 class="page-title">TRACK ORDER</h1><p class="muted">กรอกเลขคำสั่งซื้อและเบอร์โทรที่ใช้สั่งซื้อ</p>' +
      '<form class="panel" id="trackForm" style="margin-top:18px">' +
      '<div class="grid-2"><label class="field"><span>เลขคำสั่งซื้อ</span><input class="input" name="id" placeholder="LUCA-XXXXXX-XXXX" value="' + esc(id) + '" required></label>' +
      '<label class="field"><span>เบอร์โทรศัพท์</span><input class="input" name="phone" type="tel" inputmode="numeric" value="' + esc(phone) + '" required></label></div>' +
      '<button class="btn btn-dark" type="submit">ตรวจสอบสถานะ</button></form>' +
      '<div id="trackResult"></div>' +
      (mine.length ? '<div class="panel"><h3>คำสั่งซื้อล่าสุดในเครื่องนี้</h3>' + mine.slice(0, 8).map(function (o) {
        return '<div class="order-card row-between"><div><b>#' + esc(o.id) + '</b><div class="note">' + esc(fmtDate(o.createdAt)) + ' · ' + baht(o.totals.total) + '</div></div>' +
          '<a class="btn btn-sm" href="#/order/' + encodeURIComponent(o.id) + '">ดู</a></div>';
      }).join("") + '</div>' : '') +
      '</div>';
  }
  function trackHTML(r) {
    var cancelled = r.status === "ยกเลิก";
    var step = STATUS_STEP[r.status] || 1;
    return '<div class="panel"><div class="row-between"><h3 style="margin:0">#' + esc(r.orderId) + '</h3><span class="kicker" style="margin:0">' + esc(r.status) + '</span></div>' +
      (cancelled ? '<div class="alert red" style="margin-top:14px">คำสั่งซื้อนี้ถูกยกเลิก หากมีข้อสงสัยกรุณาติดต่อร้าน</div>' :
        '<ol class="timeline">' + STEPS.map(function (s, i) { return '<li class="' + (i < step ? 'done' : '') + '">' + s + '</li>'; }).join("") + '</ol>') +
      (r.trackingNo ? '<div class="alert green">เลขพัสดุ' + (r.carrier ? ' (' + esc(r.carrier) + ')' : '') + ': <b>' + esc(r.trackingNo) + '</b> ' +
        '<button type="button" class="link-btn" data-act="copy" data-text="' + esc(r.trackingNo) + '">คัดลอก</button></div>' : '') +
      '<div class="note">สั่งซื้อเมื่อ ' + esc(fmtDate(r.createdAt)) + ' · ยอดชำระ ' + baht(r.total) + '</div>' +
      (r.items ? '<p style="margin:10px 0 0">' + esc(r.items) + '</p>' : '') +
      (r.status === "รอชำระเงิน" && getLocalOrder(r.orderId) ? '<a class="btn btn-yellow" style="margin-top:14px" href="#/order/' + encodeURIComponent(r.orderId) + '">ไปหน้าชำระเงิน</a>' : '') +
      '</div>';
  }
  function doTrack(id, phone) {
    var out = $("#trackResult");
    id = id.trim().toUpperCase(); phone = phone.replace(/[^0-9]/g, "");
    if (!id || !phone) return;
    if (!LIVE) {
      var o = getLocalOrder(id);
      out.innerHTML = o && o.customer.phone === phone ?
        trackHTML({ orderId: o.id, status: o.status, createdAt: o.createdAt, total: o.totals.total }) :
        '<div class="alert red">ไม่พบคำสั่งซื้อ กรุณาตรวจสอบเลขคำสั่งซื้อและเบอร์โทร หรือติดต่อร้านทางแชท</div>';
      return;
    }
    out.innerHTML = '<div class="panel">กำลังค้นหา…</div>';
    apiGet({ action: "track", orderId: id, phone: phone }).then(function (r) {
      out.innerHTML = trackHTML(r);
    }).catch(function (e) {
      out.innerHTML = '<div class="alert red">' + esc(e.message) + '</div>';
    });
  }

  /* ---------- static pages ---------- */
  function viewSize() {
    return '<div class="narrow"><h1 class="page-title">SIZE GUIDE</h1><p class="muted">ขนาดเสื้อทุกลายใช้ตารางเดียวกัน (หน่วย: ' + esc(STORE.sizeChart.unit) + ')</p>' +
      sizeTableHTML() +
      '<div class="prose"><h2>วิธีวัด</h2><ul><li><b>รอบอก (Width)</b> — วัดจากใต้แขนด้านหนึ่งไปอีกด้านหนึ่งขณะวางเสื้อราบ แล้วคูณ 2</li>' +
      '<li><b>ความยาว (Length)</b> — วัดจากจุดสูงสุดของบ่าลงไปถึงชายเสื้อ</li>' +
      '<li>แนะนำให้นำเสื้อตัวที่ใส่ประจำมาวัดเทียบ ค่าอาจคลาดเคลื่อน ±1 นิ้ว</li></ul></div>' +
      '<img src="assets/img/size-chart.jpg" alt="ตารางไซซ์เสื้อ LUCA" style="margin-top:24px;border:2.5px solid var(--ink);border-radius:16px;box-shadow:var(--shadow)">' +
      '</div>';
  }
  function viewHow() {
    return '<div class="narrow prose"><h1 class="page-title">HOW TO ORDER</h1>' +
      '<h2>1. เลือกสินค้า</h2><p>เลือกลาย สี และไซซ์ที่ต้องการ แล้วกด “ใส่ตะกร้า” หรือ “ซื้อเลย” (ดู<a href="#/size">ตารางไซซ์</a>ก่อนสั่ง)</p>' +
      '<h2>2. กรอกข้อมูลจัดส่ง</h2><p>กรอกชื่อ เบอร์โทร และที่อยู่ เลือกวิธีจัดส่ง ใส่โค้ดส่วนลด (ถ้ามี) แล้วกด “ยืนยันคำสั่งซื้อ”</p>' +
      '<h2>3. ชำระเงิน</h2><p>ระบบจะแสดง QR พร้อมเพย์ที่ใส่ยอดเงินไว้แล้ว สแกนด้วยแอปธนาคารใดก็ได้ จากนั้นแนบสลิปในหน้าเดียวกัน' +
      (STORE.cod && STORE.cod.enabled ? ' หรือเลือก “เก็บเงินปลายทาง” (ค่าบริการ ' + baht(STORE.cod.fee) + ')' : '') + '</p>' +
      '<h2>4. รอรับสินค้า</h2><p>ร้านจัดส่งภายใน 1–2 วันทำการหลังยืนยันการชำระเงิน ตรวจสอบสถานะและเลขพัสดุได้ที่ <a href="#/track">ติดตามออเดอร์</a></p>' +
      '<h2>ค่าจัดส่ง</h2><ul>' + STORE.shipping.map(function (s) { return '<li>' + esc(s.name) + ' — ' + baht(s.fee) + ' (' + esc(s.days) + ')</li>'; }).join("") +
      (STORE.freeShippingMin ? '<li><b>ส่งฟรี</b> เมื่อซื้อครบ ' + baht(STORE.freeShippingMin) + '</li>' : '') + '</ul>' +
      '<p><a class="btn btn-yellow" href="#/shop">เริ่มช้อปเลย →</a></p></div>';
  }
  function viewFaq() {
    var qa = [
      ["เสื้อไซซ์ไหนเหมาะกับฉัน?", "ดูตารางไซซ์ได้ที่หน้า <a href=\"#/size\">ตารางไซซ์</a> แนะนำให้วัดเทียบกับเสื้อตัวที่ใส่ประจำ หากไม่แน่ใจทักแชทร้านได้เลย"],
      ["ชำระเงินแล้วต้องทำอะไรต่อ?", "แนบสลิปในหน้าชำระเงินหลังสั่งซื้อ ร้านจะตรวจสอบและจัดส่งภายใน 1–2 วันทำการ"],
      ["ติดตามพัสดุได้อย่างไร?", "ไปที่หน้า <a href=\"#/track\">ติดตามออเดอร์</a> กรอกเลขคำสั่งซื้อและเบอร์โทร ระบบจะแสดงสถานะและเลขพัสดุ"],
      ["เปลี่ยนไซซ์ได้ไหม?", "เปลี่ยนไซซ์ได้ภายใน 7 วันหลังได้รับสินค้า สินค้าต้องยังไม่ผ่านการใช้งานหรือซัก และป้ายยังอยู่ครบ ลูกค้าเป็นผู้ชำระค่าส่งสินค้ากลับ กรุณาทักแชทร้านก่อนส่งคืน"],
      ["ได้รับสินค้าชำรุดหรือผิดแบบ?", "ถ่ายรูปและวิดีโอตอนแกะพัสดุ แล้วแจ้งร้านภายใน 3 วัน ร้านจะเปลี่ยนให้ฟรีพร้อมรับผิดชอบค่าส่ง"],
      ["วิธีดูแลเสื้อ", "กลับด้านเสื้อก่อนซัก ซักน้ำเย็น ไม่ใช้น้ำยาฟอกขาว ไม่รีดทับลาย และหลีกเลี่ยงการอบผ้าด้วยความร้อนสูง"],
    ];
    return '<div class="narrow"><h1 class="page-title">FAQ</h1><p class="muted">คำถามที่พบบ่อย และเงื่อนไขการเปลี่ยนสินค้า</p><div style="margin-top:20px">' +
      qa.map(function (x, i) { return '<details class="acc"' + (i === 0 ? ' open' : '') + '><summary>' + x[0] + '</summary><p>' + x[1] + '</p></details>'; }).join("") +
      '</div><div class="panel" style="margin-top:30px"><h3>ติดต่อร้าน</h3><div style="display:flex;gap:8px;flex-wrap:wrap">' + chatLinks() + '</div></div></div>';
  }
  function viewNotFound() {
    return '<div class="narrow empty"><div class="big">GAME OVER</div><p class="muted">ไม่พบหน้าที่คุณต้องการ</p><a class="btn btn-yellow" href="#/">CONTINUE?</a></div>';
  }

  /* ---------------- router ---------------- */
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, "");
    var qi = h.indexOf("?");
    var path = (qi >= 0 ? h.slice(0, qi) : h).split("/").filter(Boolean).map(decodeURIComponent);
    var query = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : "");
    return { path: path, query: query };
  }

  var lastPath = null;
  function render() {
    var r = parseHash();
    var p0 = r.path[0] || "";
    var html, title = "LUCA — เสื้อยืดลายกราฟิก | @luca.thailand";
    switch (p0) {
      case "": html = viewHome(); break;
      case "shop": html = viewShop(r.query); title = "สินค้าทั้งหมด — LUCA"; break;
      case "p":
        html = viewProduct(r.path[1], r.query);
        var pr = product(r.path[1]); if (pr) title = pr.name + " — LUCA"; break;
      case "checkout": html = viewCheckout(); title = "ชำระเงิน — LUCA"; break;
      case "order": html = viewOrder(r.path[1]); title = "คำสั่งซื้อ #" + r.path[1] + " — LUCA"; break;
      case "track": html = viewTrack(r.query); title = "ติดตามออเดอร์ — LUCA"; break;
      case "size": html = viewSize(); title = "ตารางไซซ์ — LUCA"; break;
      case "how": html = viewHow(); title = "วิธีสั่งซื้อ — LUCA"; break;
      case "faq": html = viewFaq(); title = "คำถามที่พบบ่อย — LUCA"; break;
      default: html = viewNotFound();
    }
    app.innerHTML = html;
    document.title = title;

    var pathKey = r.path.join("/");
    if (pathKey !== lastPath) window.scrollTo(0, 0);
    lastPath = pathKey;
    closeDrawer();
    $("#nav").classList.remove("open");
    $$("#nav a").forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === location.hash); });

    if (p0 === "checkout") renderCoSummary();
    if (p0 === "track" && r.query.get("id") && r.query.get("phone")) doTrack(r.query.get("id"), r.query.get("phone"));
  }

  /* ---------------- events ---------------- */
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var act = el.getAttribute("data-act");
    var key = el.getAttribute("data-key");
    switch (act) {
      case "close-drawer": closeDrawer(); break;
      case "inc": case "dec":
        var l = cart.filter(function (x) { return x.key === key; })[0];
        if (l) setQty(key, l.qty + (act === "inc" ? 1 : -1));
        if (parseHash().path[0] === "checkout") renderCoSummary();
        break;
      case "remove": removeLine(key); if (parseHash().path[0] === "checkout") render(); break;
      case "color": pdp.color = el.getAttribute("data-v"); pdp.img = 0; pdp.qty = qtyNow();
        if (isSoldOut(product(pdp.id), pdp.color, pdp.size)) pdp.size = "";
        rerenderPdp(); break;
      case "size": pdp.size = el.getAttribute("data-v"); pdp.qty = qtyNow(); rerenderPdp(); break;
      case "img": pdp.img = +el.getAttribute("data-i"); pdp.qty = qtyNow(); rerenderPdp(); break;
      case "pdp-inc": case "pdp-dec":
        var inp = $("#pdpQty");
        inp.value = Math.max(1, Math.min(50, (parseInt(inp.value, 10) || 1) + (act === "pdp-inc" ? 1 : -1)));
        pdp.qty = +inp.value; break;
      case "add": pdpAdd(false); break;
      case "buy": pdpAdd(true); break;
      case "to-chart": e.preventDefault(); var d = $("#size-chart"); d.open = true; d.scrollIntoView({ behavior: "smooth", block: "center" }); break;
      case "coupon": co.coupon = $("#coupon").value.trim().toUpperCase(); saveCo(); renderCoSummary(); break;
      case "coupon-clear": co.coupon = ""; $("#coupon").value = ""; saveCo(); renderCoSummary(); break;
      case "copy": copy(el.getAttribute("data-text")); break;
      case "copy-order": var o = getLocalOrder(el.getAttribute("data-id")); if (o) copy(orderText(o)); break;
      case "send-slip": sendSlip(el.getAttribute("data-id")); break;
    }
  });
  function qtyNow() { var i = $("#pdpQty"); return i ? Math.max(1, Math.min(50, parseInt(i.value, 10) || 1)) : 1; }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches("[data-act=qty]")) {
      setQty(t.getAttribute("data-key"), parseInt(t.value, 10) || 1);
      if (parseHash().path[0] === "checkout") renderCoSummary();
    } else if (t.matches("[data-act=sort]")) {
      var q = parseHash().query;
      if (t.value) q.set("sort", t.value); else q.delete("sort");
      var s = q.toString();
      location.hash = "#/shop" + (s ? "?" + s : "");
    } else if (t.form && t.form.id === "coForm") {
      if (t.name === "shipping") co.shipping = t.value;
      if (t.name === "payment") co.payment = t.value;
      co.customer = readCustomer(t.form);
      saveCo();
      renderCoSummary();
    } else if (t.id === "slipFile" && t.files && t.files[0]) {
      var prev = $("#slipPrev"), btn = $("#slipBtn"), err = $("#slipErr");
      err.textContent = ""; prev.innerHTML = '<p class="note">กำลังเตรียมรูป…</p>';
      compressImage(t.files[0]).then(function (data) {
        slipData = data;
        prev.innerHTML = '<img class="slip-preview" src="' + data + '" alt="ตัวอย่างสลิป">';
        btn.disabled = false;
      }).catch(function (ex) { prev.innerHTML = ""; err.textContent = ex.message; btn.disabled = true; });
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.id === "coupon") { e.preventDefault(); $("[data-act=coupon]").click(); }
    if (e.key === "Escape") closeDrawer();
  });

  document.addEventListener("submit", function (e) {
    if (e.target.id === "coForm") { e.preventDefault(); submitCheckout(e.target); }
    if (e.target.id === "trackForm") {
      e.preventDefault();
      var f = e.target;
      var q = "id=" + encodeURIComponent(f.elements.id.value.trim().toUpperCase()) + "&phone=" + encodeURIComponent(f.elements.phone.value.replace(/[^0-9]/g, ""));
      if (location.hash === "#/track?" + q) doTrack(f.elements.id.value, f.elements.phone.value);
      else location.hash = "#/track?" + q;
    }
  });

  $("#cartBtn").addEventListener("click", openDrawer);
  $("#cartClose").addEventListener("click", closeDrawer);
  $("#drawerBackdrop").addEventListener("click", closeDrawer);
  $("#menuBtn").addEventListener("click", function () { $("#nav").classList.toggle("open"); });
  window.addEventListener("hashchange", render);

  /* ---------------- boot ---------------- */
  $("#year").textContent = new Date().getFullYear();
  $("#socials").innerHTML = socialHTML();

  fetch(CFG.STORE_DATA_URL || "data/store.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      STORE = data;
      validCart();
      $("#cartCount").textContent = cartQty();
      var a = [];
      if (STORE.freeShippingMin) a.push("🚚 ส่งฟรีเมื่อซื้อครบ " + baht(STORE.freeShippingMin));
      a.push("💳 ชำระง่ายผ่านพร้อมเพย์");
      if (STORE.cod && STORE.cod.enabled) a.push("📦 มีบริการเก็บเงินปลายทาง");
      $("#announce").textContent = a.join("  ·  ");
      renderDrawer();
      render();
    })
    .catch(function () {
      app.innerHTML = '<div class="narrow empty"><div class="big">ERROR</div><p class="muted">โหลดข้อมูลสินค้าไม่สำเร็จ กรุณารีเฟรชหน้าอีกครั้ง</p></div>';
    });
})();
