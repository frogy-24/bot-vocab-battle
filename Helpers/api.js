require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { handleProtectSimulation } = require("./encrypt.cjs");

const DATA_FILE = path.join(__dirname, "data", "data.json");
const DONE_FILE = path.join(__dirname, "data", "done.json");

function loadDoneData() {
  try {
    return JSON.parse(fs.readFileSync(DONE_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveDoneData(doneData) {
  // Đảm bảo thư mục 'data' tồn tại trước khi lưu file
  const dir = path.dirname(DONE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DONE_FILE, JSON.stringify(doneData, null, 2), "utf8");
}

function isDone(doneData, payloadId, sentenceId) {
  const payload = doneData.find((x) => x.id === payloadId);

  if (!payload) {
    return false;
  }

  return payload.done.some((x) => x.sentence_id === sentenceId);
}

function markDone(doneData, payloadId, sentenceId) {
  let payload = doneData.find((x) => x.id === payloadId);

  if (!payload) {
    payload = {
      id: payloadId,
      done: [],
    };

    doneData.push(payload);
  }

  const exists = payload.done.some((x) => x.sentence_id === sentenceId);

  if (!exists) {
    payload.done.push({
      sentence_id: sentenceId,
    });
  }
}

// Đọc file data.json bằng đường dẫn an toàn
let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (err) {
  console.error(
    `\n❌ Lỗi: Không thể đọc file data.json tại đường dẫn: ${DATA_FILE}`,
  );
  console.error(`Chi tiết lỗi: ${err.message}\n`);
  process.exit(1);
}

const doneData = loadDoneData();

const result = data.map((item) => ({
  id: item.id,
  data: item.data.sentence_ids
    .map((x) => x._id)
    .filter((sentenceId) => !isDone(doneData, item.id, sentenceId)),
}));

const totalSentences = data.reduce(
  (sum, item) => sum + item.data.sentence_ids.length,
  0,
);

const remainingSentences = result.reduce(
  (sum, item) => sum + item.data.length,
  0,
);

console.log(`Need submit: ${remainingSentences}/${totalSentences}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitSentence(sentenceId, accessToken) {
  const payload = {
    mistakes: 0,
    replay_count: 0,
    sentence_id: sentenceId,
  };

  const protectedData = await handleProtectSimulation(payload);

  while (true) {
    const response = await fetch(
      "https://api.parroto.app/api/sentences/submit",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          data: protectedData,
        }),
      },
    );

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after")) || 60;

      console.log(
        `⚠ Rate limit (429) - sentence ${sentenceId}. Retry after ${retryAfter}s...`,
      );

      await sleep(retryAfter * 1000);

      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Submit failed: ${response.status} ${text}`);
    }

    return response.json();
  }
}

(async () => {
  // Lấy token từ file .env
  const accessToken = process.env.ACCESS_TOKEN;

  if (!accessToken) {
    console.error("\n❌ Lỗi: Không tìm thấy ACCESS_TOKEN trong file .env!");
    process.exit(1);
  }

  for (const item of result) {
    console.log(`\n===== Payload ${item.id} =====`);

    if (item.data.length === 0) {
      console.log("Skip (all done)");
      continue;
    }

    for (let i = 0; i < item.data.length; i++) {
      const sentenceId = item.data[i];
      await sleep(500); // Delay 1 giây giữa các request để tránh bị rate limit
      try {
        await submitSentence(sentenceId, accessToken);

        markDone(doneData, item.id, sentenceId);

        saveDoneData(doneData);

        console.log(
          `✔ Payload ${item.id} | ${i + 1}/${item.data.length} | ${sentenceId}`,
        );
      } catch (err) {
        console.error(
          `✖ Payload ${item.id} | ${i + 1}/${item.data.length} | ${sentenceId}`,
          err.message,
        );
      }
    }
  }

  console.log("\nDone");
})();
