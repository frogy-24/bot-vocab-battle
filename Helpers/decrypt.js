// Import Web Crypto API từ module tích hợp sẵn của Node.js
const { webcrypto } = require("crypto");
const fs = require("fs");

async function decryptData(encryptedBase64, keyBase64) {
  // Lấy API SubtleCrypto trong Node.js
  const subtleCrypto = webcrypto.subtle;
  if (!subtleCrypto) {
    throw new Error("Web Crypto API not available in this Node.js version");
  }

  // Hàm phụ trợ: Chuyển đổi Base64 thành Uint8Array (Dùng Buffer chuẩn của Node.js)
  const base64ToUint8Array = (base64Str) => {
    return Buffer.from(base64Str, "base64");
  };

  // 1. Giải mã chuỗi dữ liệu (Ciphertext + IV)
  const encryptedBytes = base64ToUint8Array(encryptedBase64);

  // Tách 12 byte đầu tiên làm IV, phần còn lại là Ciphertext
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);

  // 2. Giải mã và Import Key
  const keyBytes = base64ToUint8Array(keyBase64);

  const cryptoKey = await subtleCrypto.importKey(
    "raw", // Định dạng khóa thô
    keyBytes, // Mảng byte của khóa
    { name: "AES-GCM" },
    false, // Khóa không thể trích xuất lại
    ["decrypt"], // Mục đích sử dụng
  );

  // 3. Tiến hành giải mã
  const algorithmConfig = {
    name: "AES-GCM",
    iv: iv,
    tagLength: 128,
  };

  const decryptedBuffer = await subtleCrypto.decrypt(
    algorithmConfig,
    cryptoKey,
    ciphertext,
  );

  // 4. Decode kết quả và parse JSON
  const decryptedString = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decryptedString);
}

const data = JSON.parse(fs.readFileSync("./course.json", "utf8"));

const payloads = data.map((x) => x.src);

var key = "1sDbzv+sd1Lr+rhGYGf5Iyc+lFPFDTb6jgm58Zjfri4=";

async function processPayloads() {
  try {
    const results = [];

    for (let i = 0; i < payloads.length; i++) {
      const decrypted = await decryptData(payloads[i], key);

      results.push({
        id: i + 1,
        data: decrypted,
      });
    }

    fs.writeFileSync(
      "data.json",
      JSON.stringify(results, null, 2),
      "utf8"
    );

    console.log("Đã lưu vào data.json");
  } catch (error) {
    console.error("Lỗi khi giải mã:", error);
  }
}

processPayloads();