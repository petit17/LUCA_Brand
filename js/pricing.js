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
