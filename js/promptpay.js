/* สร้างข้อมูล QR พร้อมเพย์ (มาตรฐาน EMVCo / Thai QR Payment) พร้อมยอดเงิน */
(function () {
  function field(id, value) {
    var len = String(value.length);
    return id + (len.length < 2 ? "0" + len : len) + value;
  }

  function crc16(str) {
    var crc = 0xffff;
    for (var i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xffff;
      }
    }
    return ("0000" + crc.toString(16).toUpperCase()).slice(-4);
  }

  function payload(id, amount) {
    var target = String(id || "").replace(/[^0-9]/g, "");
    var tag;
    if (target.length === 10) { tag = "01"; target = ("0000000000000" + "66" + target.slice(1)).slice(-13); }
    else if (target.length === 13) tag = "02";
    else if (target.length === 15) tag = "03";
    else return null;

    var data =
      field("00", "01") +
      field("01", amount ? "12" : "11") +
      field("29", field("00", "A000000677010111") + field(tag, target)) +
      field("58", "TH") +
      field("53", "764") +
      (amount ? field("54", Number(amount).toFixed(2)) : "") +
      "6304";
    return data + crc16(data);
  }

  window.LucaPromptPay = { payload: payload, crc16: crc16 };
})();
