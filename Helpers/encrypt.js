const fs = require("fs");
/**
 * Mã hóa chuỗi thành định dạng Base64Url (chuẩn dùng cho JWT)
 */
function base64UrlEncode(str) {
  const base64 = btoa(unescape(encodeURIComponent(str)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Mã hóa ArrayBuffer (kết quả của thuật toán băm) thành Base64Url
 */
function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Hàm mô phỏng handleProtect
 */
async function handleProtectSimulation(inputData) {
  try {
    // 1. KHÔI PHỤC KHÓA BÍ MẬT (Secret Key)
    // Dùng nguyên chuỗi string, KHÔNG giải mã Base64
    const secretKeyString = "1sDbzv+sd1Lr+rhGYGf5Iyc+lFPFDTb6jgm58Zjfri4=";
    const keyBytes = new Uint8Array(secretKeyString.length);
    for (let i = 0; i < secretKeyString.length; i++) {
      keyBytes[i] = secretKeyString.charCodeAt(i);
    }

    // Import khóa vào Web Crypto API để dùng cho HMAC SHA-256
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    //
    const expireTime = Math.floor(Date.now() / 1000) + 3600;

    // 2. CHUẨN BỊ HEADER VÀ PAYLOAD
    const header = { alg: "HS256", typ: "JWT" };

    const payload = {
      ...inputData,
      platform: "web",
      exp: expireTime,
    };

    // 3. MÃ HÓA HEADER VÀ PAYLOAD SANG BASE64URL
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));

    // Cú pháp của JWT trước khi ký: Header.Payload
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    // 4. THỰC HIỆN KÝ (SIGN) BẰNG HMAC-SHA256
    const encoder = new TextEncoder();
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(dataToSign),
    );

    // 5. TẠO CHUỖI JWT HOÀN CHỈNH
    const encodedSignature = bufferToBase64Url(signatureBuffer);
    const jwtToken = `${dataToSign}.${encodedSignature}`;

    return jwtToken;
  } catch (error) {
    console.error("Token generation error:", error);
    throw new Error("Token generation failed");
  }
}

// ==========================================
// THỰC THI THỬ NGHIỆM VỚI DỮ LIỆU MỚI
// ==========================================
// ĐÃ CẬP NHẬT: Dữ liệu đầu vào từ log mới
// const dataInput = {
//   mistakes: 0,
//   replay_count: 0,
//   sentence_id: "68c84d62814d43daf466b1aa",
// };

// // Gọi hàm và in ra kết quả
// handleProtectSimulation(dataInput).then((token) => {
//   console.log("=== KẾT QUẢ TẠO TOKEN ===");
//   console.log(token);
// });


const data = JSON.parse(fs.readFileSync("./data.json", "utf8"));

const sentenceIds = data.sentence_ids.map((x) => x._id);


async function submitSentence(sentenceId, accessToken) {
  const payload = {
    mistakes: 0,
    replay_count: 0,
    sentence_id: sentenceId,
  };

  const protectedData = await handleProtectSimulation(payload);

  const response = await fetch("https://api.parroto.app/api/sentences/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      data: protectedData,
    }),
  });

  if (!response.ok) {
    throw new Error(`Submit failed: ${response.status}`);
  }

  return response.json();
}

const accessToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjJmMjk1MGEyNGFlYWRkMjYzYzIxM2I2MDNhZjMxNWEzMjdiNmM3MjAiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vc2hhZG93LWRpY3RhdGlvbiIsImF1ZCI6InNoYWRvdy1kaWN0YXRpb24iLCJhdXRoX3RpbWUiOjE3ODIyOTg0NzgsInVzZXJfaWQiOiJDMGVYMXFKVWdjWnBTM0pCWU8xand0aWpBR28xIiwic3ViIjoiQzBlWDFxSlVnY1pwUzNKQllPMWp3dGlqQUdvMSIsImlhdCI6MTc4MjI5ODQ3OCwiZXhwIjoxNzgyMzAyMDc4LCJlbWFpbCI6Im5icGF1dXJuczZAbWF0cy5lZHUucGwiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZmlyZWJhc2UiOnsiaWRlbnRpdGllcyI6eyJlbWFpbCI6WyJuYnBhdXVybnM2QG1hdHMuZWR1LnBsIl19LCJzaWduX2luX3Byb3ZpZGVyIjoicGFzc3dvcmQifX0.lCpAr2efPfW-vrez2fJFbhWhSDwopTiyaePS6yCFao-tsBIwb0W8D93Ctx4gg2jZp3T65qHtT6OkpaAild_l4SgsRkGi7MUK6szHLbMKxVTiHxZvd3yrCfLl17TRHuv3meiz8QqlSlz65xpN5rdPuh_x9nS3_COQKSknG-EB_6Cjhttw5PyLyqMuhZISA9BgX3G-KYL7k49y6YtD3S9PzmuAfzDn_hlW7G63AyvvmAFnUAoABz1bt6s0G1H7ACnrcSdITB9nBh_YNcGUljvbt2WD8o5luNgFWqgYCtw9yYEBbAPabIpxHuZTvFqqic9x1sEnqSr3Gey0n8PAH-u2VQ";

await Promise.all(
  sentenceIds.map((id) =>
    submitSentence(id, accessToken)
      .then(() => {
        console.log("✔", id);
      })
      .catch((err) => {
        console.error("✖", id, err.message);
      }),
  ),
);

console.log("Done");
