/* ==========================================================================
   LUCA STORE — ระบบหลังบ้าน (Google Apps Script + Google Sheets)
   - รับออเดอร์จากหน้าเว็บ → บันทึกลงชีต "Orders" + ส่งอีเมลแจ้งร้าน
   - รับสลิป → เก็บใน Google Drive โฟลเดอร์ "LUCA Slips" + อัปเดตสถานะ
   - ให้ลูกค้าเช็คสถานะ/เลขพัสดุ
   - แก้คอลัมน์ "สถานะ" หรือ "เลขพัสดุ" ในชีต → ระบบส่งอีเมลแจ้งลูกค้าอัตโนมัติ (ถ้าลูกค้าใส่อีเมล)
   วิธีติดตั้งดูที่ README.md
   ========================================================================== */

var CONFIG = {
  // ที่อยู่ไฟล์ store.json บนเว็บจริง (ใช้คำนวณราคาซ้ำฝั่งเซิร์ฟเวอร์ กันการแก้ราคาจากหน้าเว็บ)
  STORE_JSON_URL: "https://petit17.github.io/LUCA_Brand/data/store.json",
  SITE_URL: "https://petit17.github.io/LUCA_Brand/",
  SHOP_NAME: "LUCA",
  OWNER_EMAIL: "", // เว้นว่าง = ส่งแจ้งเตือนเข้าอีเมลเจ้าของสคริปต์
};

var SHEET_NAME = "Orders";
var HEADERS = [
  "เลขคำสั่งซื้อ", "วันที่สั่ง", "สถานะ", "ชื่อลูกค้า", "เบอร์โทร", "อีเมล", "ที่อยู่", "จังหวัด", "รหัสไปรษณีย์",
  "รายการสินค้า", "จำนวนชิ้น", "ค่าสินค้า", "ส่วนลด", "โค้ด", "ค่าส่ง", "ค่า COD", "ยอดรวม", "ชำระโดย", "วิธีจัดส่ง",
  "สลิป", "บริษัทขนส่ง", "เลขพัสดุ", "หมายเหตุลูกค้า", "หมายเหตุร้าน", "ข้อมูล (JSON)",
];
var STATUSES = ["รอชำระเงิน", "รอตรวจสอบสลิป", "ชำระแล้ว", "เก็บเงินปลายทาง", "กำลังเตรียมจัดส่ง", "จัดส่งแล้ว", "สำเร็จ", "ยกเลิก"];
var NOTIFY_STATUSES = ["ชำระแล้ว", "จัดส่งแล้ว", "ยกเลิก"];

/* ---------------- ติดตั้งครั้งแรก: เลือกฟังก์ชัน setup แล้วกด Run ---------------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold").setBackground("#F5C518");
  sh.setFrozenRows(1);
  sh.setColumnWidth(col_("รายการสินค้า"), 320);
  sh.setColumnWidth(col_("ที่อยู่"), 260);
  sh.hideColumns(col_("ข้อมูล (JSON)"));
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build();
  sh.getRange(2, col_("สถานะ"), sh.getMaxRows() - 1, 1).setDataValidation(rule);

  slipFolder_();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "onSheetEdit") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onSheetEdit").forSpreadsheet(ss).onEdit().create();

  // ทดสอบว่าโหลด store.json ได้
  var store = loadStore_(true);
  Logger.log("ตั้งค่าเสร็จแล้ว พบสินค้า " + store.products.length + " รายการ");
}

/* ---------------- Web API ---------------- */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var data = body.data || {};
    if (body.action === "createOrder") return json_(createOrder_(data));
    if (body.action === "uploadSlip") return json_(uploadSlip_(data));
    return json_({ ok: false, error: "unknown action" });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doGet(e) {
  try {
    var p = e.parameter || {};
    if (p.action === "track") return json_(track_(p.orderId, p.phone));
    return json_({ ok: true, service: CONFIG.SHOP_NAME + " store API" });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function createOrder_(d) {
  var c = d.customer || {};
  var phone = String(c.phone || "").replace(/[^0-9]/g, "");
  if (!c.name || !/^0\d{8,9}$/.test(phone) || !c.address || !c.province || !/^\d{5}$/.test(String(c.postcode || ""))) {
    return { ok: false, error: "ข้อมูลผู้รับไม่ครบถ้วน" };
  }
  if (!Array.isArray(d.items) || !d.items.length || d.items.length > 30) return { ok: false, error: "ไม่มีสินค้าในคำสั่งซื้อ" };
  var payment = d.payment === "cod" ? "cod" : "promptpay";

  var store = loadStore_(false);
  var t = lucaCalcTotals(store, d.items, d.shipping, payment, d.coupon || "");
  if (t.errors.length) return { ok: false, error: t.errors.join(", ") };
  if (!t.lines.length) return { ok: false, error: "ไม่มีสินค้าในคำสั่งซื้อ" };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_();
    var id = newId_(sh);
    var now = new Date();
    var status = payment === "cod" ? "เก็บเงินปลายทาง" : "รอชำระเงิน";
    var itemsText = t.lines.map(function (l) { return l.name + " (" + l.colorLabel + "/" + l.size + ") x" + l.qty; }).join("\n");
    var qty = t.lines.reduce(function (s, l) { return s + l.qty; }, 0);
    var row = {};
    row["เลขคำสั่งซื้อ"] = id;
    row["วันที่สั่ง"] = now;
    row["สถานะ"] = status;
    row["ชื่อลูกค้า"] = clean_(c.name, 100);
    row["เบอร์โทร"] = "'" + phone;
    row["อีเมล"] = clean_(c.email, 120);
    row["ที่อยู่"] = clean_([c.address, c.subdistrict, c.district].join(" "), 400);
    row["จังหวัด"] = clean_(c.province, 60);
    row["รหัสไปรษณีย์"] = "'" + String(c.postcode).replace(/[^0-9]/g, "");
    row["รายการสินค้า"] = itemsText;
    row["จำนวนชิ้น"] = qty;
    row["ค่าสินค้า"] = t.subtotal;
    row["ส่วนลด"] = t.discount;
    row["โค้ด"] = t.coupon;
    row["ค่าส่ง"] = t.shippingFee;
    row["ค่า COD"] = t.codFee;
    row["ยอดรวม"] = t.total;
    row["ชำระโดย"] = payment === "cod" ? "เก็บเงินปลายทาง" : "พร้อมเพย์";
    row["วิธีจัดส่ง"] = t.shippingName;
    row["หมายเหตุลูกค้า"] = clean_(c.note, 500);
    row["ข้อมูล (JSON)"] = JSON.stringify({ customer: c, totals: t });
    sh.appendRow(HEADERS.map(function (h) { return row[h] === undefined ? "" : row[h]; }));
  } finally {
    lock.releaseLock();
  }

  notifyOwner_("🛒 ออเดอร์ใหม่ #" + id + " — ฿" + t.total,
    "ออเดอร์ใหม่ #" + id + "\n\n" + itemsText + "\n\nยอดรวม: ฿" + t.total + " (" + row["ชำระโดย"] + ")\n" +
    "ผู้รับ: " + c.name + " " + phone + "\n" + row["ที่อยู่"] + " " + c.province + " " + c.postcode +
    (c.note ? "\nหมายเหตุ: " + c.note : "") + "\n\nเปิดชีต: " + SpreadsheetApp.getActiveSpreadsheet().getUrl());

  return { ok: true, orderId: id, totals: t, createdAt: now.toISOString() };
}

function uploadSlip_(d) {
  var found = findOrder_(d.orderId, d.phone);
  if (!found) return { ok: false, error: "ไม่พบคำสั่งซื้อ" };
  var status = found.get("สถานะ");
  if (["รอชำระเงิน", "รอตรวจสอบสลิป"].indexOf(status) < 0) return { ok: false, error: "คำสั่งซื้อนี้ไม่อยู่ในสถานะรอชำระเงิน" };

  var m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(d.image || ""));
  if (!m) return { ok: false, error: "ไฟล์สลิปไม่ถูกต้อง" };
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 4 * 1024 * 1024) return { ok: false, error: "ไฟล์ใหญ่เกินไป" };

  var ext = m[1].split("/")[1].replace("jpeg", "jpg");
  var file = slipFolder_().createFile(Utilities.newBlob(bytes, m[1], found.id + "_" + Date.now() + "." + ext));
  found.set("สลิป", file.getUrl());
  found.set("สถานะ", "รอตรวจสอบสลิป");

  notifyOwner_("💸 สลิปใหม่ #" + found.id + " — ฿" + found.get("ยอดรวม"),
    "ลูกค้าแนบสลิปสำหรับออเดอร์ #" + found.id + "\nยอดที่ต้องได้รับ: ฿" + found.get("ยอดรวม") +
    "\nสลิป: " + file.getUrl() + "\n\nตรวจสอบแล้วเปลี่ยนสถานะในชีตเป็น \"ชำระแล้ว\"\n" + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  return { ok: true };
}

function track_(orderId, phone) {
  var found = findOrder_(orderId, phone);
  if (!found) return { ok: false, error: "ไม่พบคำสั่งซื้อ กรุณาตรวจสอบเลขคำสั่งซื้อและเบอร์โทร" };
  var created = found.get("วันที่สั่ง");
  return {
    ok: true,
    orderId: found.id,
    status: found.get("สถานะ"),
    createdAt: created instanceof Date ? created.toISOString() : String(created),
    total: found.get("ยอดรวม"),
    items: String(found.get("รายการสินค้า")).replace(/\n/g, ", "),
    carrier: found.get("บริษัทขนส่ง"),
    trackingNo: found.get("เลขพัสดุ"),
  };
}

/* ---------------- แจ้งลูกค้าเมื่อร้านแก้สถานะ / ใส่เลขพัสดุ (installable trigger จาก setup) ---------------- */
function onSheetEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== SHEET_NAME || e.range.getRow() < 2 || e.range.getNumRows() > 1) return;
  var col = e.range.getColumn();
  var isStatus = col === col_("สถานะ"), isTracking = col === col_("เลขพัสดุ");
  if (!isStatus && !isTracking) return;

  var r = e.range.getRow();
  var vals = sh.getRange(r, 1, 1, HEADERS.length).getValues()[0];
  var get = function (h) { return vals[HEADERS.indexOf(h)]; };
  var email = String(get("อีเมล") || "").trim();
  if (!email) return;

  var status = String(get("สถานะ"));
  var tracking = String(get("เลขพัสดุ") || "").trim();
  if (isStatus && NOTIFY_STATUSES.indexOf(status) < 0) return;
  if (isTracking && !tracking) return;
  if (isStatus && status === "จัดส่งแล้ว" && !tracking) return; // รอให้ใส่เลขพัสดุก่อนค่อยแจ้ง

  var id = get("เลขคำสั่งซื้อ");
  var trackUrl = CONFIG.SITE_URL + "#/track?id=" + encodeURIComponent(id) + "&phone=" + encodeURIComponent(String(get("เบอร์โทร")).replace(/[^0-9]/g, ""));
  var lines = [
    "สวัสดีคุณ " + get("ชื่อลูกค้า"),
    "",
    "คำสั่งซื้อ #" + id + " สถานะ: " + status,
    tracking ? "เลขพัสดุ" + (get("บริษัทขนส่ง") ? " (" + get("บริษัทขนส่ง") + ")" : "") + ": " + tracking : null,
    "",
    "ติดตามคำสั่งซื้อ: " + trackUrl,
    "",
    "ขอบคุณที่อุดหนุน " + CONFIG.SHOP_NAME + " ❤️",
  ].filter(function (x) { return x !== null; });
  MailApp.sendEmail({ to: email, subject: CONFIG.SHOP_NAME + " — คำสั่งซื้อ #" + id + " " + status, body: lines.join("\n"), name: CONFIG.SHOP_NAME });
}

/* ---------------- helpers ---------------- */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function sheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error("ยังไม่ได้รัน setup()");
  return sh;
}
function col_(h) { return HEADERS.indexOf(h) + 1; }
function clean_(s, max) {
  s = String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B-\u001F]/g, "").trim();
  if (/^[=+\-@]/.test(s)) s = "'" + s; // กันสูตรใน Google Sheets
  return s.slice(0, max);
}
function newId_(sh) {
  var tz = Session.getScriptTimeZone() || "Asia/Bangkok";
  var ymd = Utilities.formatDate(new Date(), tz, "yyMMdd");
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  for (var tries = 0; tries < 20; tries++) {
    var r = "";
    for (var i = 0; i < 4; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
    var id = "LUCA-" + ymd + "-" + r;
    if (ids.indexOf(id) < 0) return id;
  }
  throw new Error("สร้างเลขคำสั่งซื้อไม่สำเร็จ");
}
function findOrder_(orderId, phone) {
  orderId = String(orderId || "").trim().toUpperCase();
  phone = String(phone || "").replace(/[^0-9]/g, "");
  if (!orderId || !phone) return null;
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]).toUpperCase() !== orderId) continue;
    var row = i + 2;
    var vals = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    if (String(vals[col_("เบอร์โทร") - 1]).replace(/[^0-9]/g, "") !== phone) return null;
    return {
      id: vals[0],
      get: function (h) { return vals[HEADERS.indexOf(h)]; },
      set: function (h, v) { sh.getRange(row, col_(h)).setValue(v); vals[HEADERS.indexOf(h)] = v; },
    };
  }
  return null;
}
function loadStore_(fresh) {
  var cache = CacheService.getScriptCache();
  var hit = !fresh && cache.get("store");
  if (hit) return JSON.parse(hit);
  var res = UrlFetchApp.fetch(CONFIG.STORE_JSON_URL + "?t=" + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("โหลดข้อมูลสินค้าไม่สำเร็จ (" + res.getResponseCode() + ")");
  var text = res.getContentText();
  try { cache.put("store", text, 300); } catch (e) { /* ไฟล์ใหญ่เกิน cache */ }
  return JSON.parse(text);
}
function slipFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SLIP_FOLDER_ID");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* ถูกลบไปแล้ว สร้างใหม่ */ } }
  var folder = DriveApp.createFolder(CONFIG.SHOP_NAME + " Slips");
  props.setProperty("SLIP_FOLDER_ID", folder.getId());
  return folder;
}
function notifyOwner_(subject, body) {
  var to = CONFIG.OWNER_EMAIL || Session.getEffectiveUser().getEmail();
  if (to) MailApp.sendEmail({ to: to, subject: subject, body: body, name: CONFIG.SHOP_NAME + " Store" });
}

/* ---------------- คำนวณราคา (คัดลอกมาจาก js/pricing.js — ถ้าแก้สูตรที่ไฟล์นั้น ให้คัดลอกมาวางแทนที่ตรงนี้ด้วย) ---------------- */
/* คำนวณราคาออเดอร์ — โค้ดชุดเดียวกับใน apps-script/Code.gs (ฝั่งเซิร์ฟเวอร์คำนวณซ้ำเพื่อกันการแก้ราคา)
   ถ้าแก้สูตรที่นี่ ให้แก้ใน Code.gs ให้ตรงกันด้วย */
function lucaCalcTotals(store, items, shippingId, payment, couponCode) {
  var errors = [];
  var lines = [];
  var subtotal = 0;
  (items || []).forEach(function (it) {
    var p = (store.products || []).filter(function (x) { return x.id === it.id; })[0];
    if (!p) { errors.push("ไม่พบสินค้า " + it.id); return; }
    var color = (p.colors || []).filter(function (c) { return c.name === it.color; })[0];
    if (!color) { errors.push(p.name + ": ไม่มีสี " + it.color); return; }
    if ((store.sizes || []).indexOf(it.size) < 0) { errors.push(p.name + ": ไม่มีไซซ์ " + it.size); return; }
    if ((p.soldOut || []).indexOf(it.color + "/" + it.size) >= 0 || (p.soldOut || []).indexOf(it.color) >= 0) {
      errors.push(p.name + " " + color.label + " " + it.size + " สินค้าหมด"); return;
    }
    var qty = Math.floor(Number(it.qty));
    if (!(qty >= 1 && qty <= 50)) { errors.push(p.name + ": จำนวนไม่ถูกต้อง"); return; }
    var lineTotal = p.price * qty;
    subtotal += lineTotal;
    lines.push({ id: p.id, name: p.name, color: it.color, colorLabel: color.label, size: it.size, qty: qty, price: p.price, total: lineTotal });
  });

  var discount = 0;
  var coupon = null;
  var couponError = "";
  if (couponCode) {
    var code = String(couponCode).trim().toUpperCase();
    coupon = (store.coupons || []).filter(function (c) { return c.code.toUpperCase() === code; })[0] || null;
    if (!coupon) couponError = "ไม่พบโค้ดส่วนลดนี้";
    else if (subtotal < (coupon.minSubtotal || 0)) { couponError = "ต้องซื้อขั้นต่ำ ฿" + coupon.minSubtotal; coupon = null; }
    else discount = coupon.type === "percent" ? Math.round(subtotal * coupon.value / 100) : Math.min(coupon.value, subtotal);
  }

  var ship = (store.shipping || []).filter(function (s) { return s.id === shippingId; })[0] || (store.shipping || [])[0];
  var afterDiscount = subtotal - discount;
  var shippingFee = ship ? (store.freeShippingMin && afterDiscount >= store.freeShippingMin ? 0 : ship.fee) : 0;
  var codFee = payment === "cod" && store.cod && store.cod.enabled ? store.cod.fee : 0;
  if (payment === "cod" && !(store.cod && store.cod.enabled)) errors.push("ร้านไม่รับเก็บเงินปลายทาง");

  return {
    lines: lines,
    errors: errors,
    subtotal: subtotal,
    discount: discount,
    coupon: coupon ? coupon.code : "",
    couponError: couponError,
    shipping: ship ? ship.id : "",
    shippingName: ship ? ship.name : "",
    shippingFee: shippingFee,
    codFee: codFee,
    total: afterDiscount + shippingFee + codFee,
  };
}
