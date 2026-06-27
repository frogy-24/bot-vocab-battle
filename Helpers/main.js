const CDP = require("chrome-remote-interface");
var ncp = require("node-clipboardy");
const OpenAI = require("openai");
const { exec } = require("child_process");
const Database = require("better-sqlite3");
const path = require("path");

// ─── DB Setup ────────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, "vocabulary.db");
const db = new Database(DB_PATH);


const stmtGet = db.prepare("SELECT id, card_id, word FROM cards WHERE card_id = ?");

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO cards (card_id, word)
  VALUES (?, ?)
`);

function getCached(cardId) {
  return stmtGet.get(cardId) ?? null;
}

function saveToCache(cardId, word) {
  stmtInsert.run(cardId, word);
}

// ─── Utils ───────────────────────────────────────────────────────────────────
function encodeClipboard(word, difficulty) {
  return `${word}|||d:${difficulty.toFixed(2)}`;
}

// ─── OpenAI Setup ────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: 'sk-57c14cfd465da19e-br8xpe-d44cc005',
  baseURL: 'http://localhost:20128/v1'
});

let currentAbortController = null;

function createAbortController() {
  if (currentAbortController) {
    currentAbortController.abort();
    console.log("🚫 Đã hủy request API đang chạy (breakpoint mới hit)\n");
  }
  const controller = new AbortController();
  currentAbortController = controller;
  return controller;
}

// ─── AI Solver ───────────────────────────────────────────────────────────────
async function solveCard(card, rawJson, signal) {
  const response = await openai.chat.completions.create(
    {
      model: "oc/deepseek-v4-flash-free",
      messages: [
        {
          role: "system",
          content: `You are an expert at solving English vocabulary flashcards.

Your task is to guess the correct English word based on the JSON card data and evaluate its difficulty.

Rules:
- The word has exactly ${card.wordLength} letters.
- Return your answer STRICTLY as a JSON object with exactly two keys:
  1. "word" (string): The English word you guessed.
  2. "difficulty" (float): A number between 0.0 and 1.0 indicating how hard this word is for an English learner (0.0 = very common/easy, 1.0 = rare/extremely difficult).
- Do not add any extra text, markdown, or explanation outside the JSON object.`,
        },
        {
          role: "user",
          content: rawJson,
        },
      ],
    },
    { signal },
  );

  let content = response.choices[0].message.content.trim();

  // Xử lý trường hợp model trả về markdown code block (```json ... ```)
  if (content.startsWith('```')) {
    content = content.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(content);
    return {
      word: parsed.word || "",
      difficulty: typeof parsed.difficulty === "number" ? parsed.difficulty : 0.5
    };
  } catch (error) {
    console.error("❌ Lỗi parse JSON từ AI, trả về nguyên bản:", content);
    // Fallback nếu AI trả về lỗi format
    return { word: content.replace(/[^a-zA-Z]/g, ''), difficulty: 0.5 };
  }
}

// ─── Human delay calc ─────────────────────────────────────────────────────────
function calcHumanDelay(word, difficulty) {
  const basePerChar = Math.floor(Math.random() * 60) + 100;
  const jitter = Math.floor(Math.random() * 200) - 100;

  const thinkMin = Math.round(200 + difficulty * 300);
  const thinkMax = Math.round(500 + difficulty * 800);
  const thinkDelay = Math.floor(Math.random() * (thinkMax - thinkMin)) + thinkMin;

  return Math.max(300, word.length * basePerChar + jitter + thinkDelay);
}

// ─── Chrome Launch ────────────────────────────────────────────────────────────
function launchChrome() {
  return new Promise((resolve) => {
    const cmd = `start "" "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\ChromeDebug"`;
    console.log("🚀 Đang mở Chrome với remote debugging...");
    exec(cmd, (err) => {
      if (err) console.warn("⚠️ Không thể mở Chrome tự động:", err.message);
    });
    setTimeout(resolve, 2000);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await launchChrome();

  const client = await CDP({ port: 9222 });
  const { Debugger, Runtime, Page } = client;

  await Promise.all([Debugger.enable(), Runtime.enable(), Page.enable()]);

  console.log(`✅ Tool đang chạy... DB: ${DB_PATH}`);
  console.log(
    `📦 Cache hiện có: ${db.prepare("SELECT COUNT(*) as c FROM cards").get().c} cards\n`,
  );

  Debugger.paused(async ({ callFrames }) => {
    const frame = callFrames[0];

    if (!frame) {
      await Debugger.resume();
      return;
    }

    console.log(`\n🔴 Breakpoint hit - Line: ${frame.location.lineNumber + 1}`);

    let rawJson = null;
    let card = null;

    try {
      const { result } = await Debugger.evaluateOnCallFrame({
        callFrameId: frame.callFrameId,
        expression: "JSON.stringify(e?.card, null, 2)",
        returnByValue: true,
      });

      if (result?.value && result.value !== "null" && result.value !== "undefined") {
        rawJson = result.value;
        card = JSON.parse(rawJson);
        console.log(`✅ cardId: ${card.cardId}`);
      } else {
        console.log("⚠️ Không tìm thấy e.card hoặc e.card là null");
      }
    } catch (err) {
      console.error("❌ Lỗi khi evaluate e.card:", err.message);
    }

    console.log("▶️ Resume ngay...\n");
    await Debugger.resume();

    if (!card || !rawJson) return;

    const cardId = String(card.cardId ?? "");
    if (!cardId) {
      console.warn("⚠️ card không có cardId, bỏ qua cache.");
      return;
    }

    // ── Check cache ────────────────────────────────────────────────
    const cached = getCached(cardId);
    if (cached) {
      const { word, difficulty } = cached;

      console.log(
        `⚡ Cache hit [${cardId}] → "${word}" | difficulty=${difficulty}`,
      );

      ncp.writeSync(word);
      console.log(`⚡ Cache hit [${cardId}] → "${word}" (đã copy)\n`);
      return;
    }

    // ── Gọi AI ─────────────────────────────────────────────────────
    const { signal } = createAbortController();

    try {
      console.log(`🤖 Cache miss [${cardId}] — đang gọi API...`);
      const apiStart = Date.now();

      // Nhận về Object chứa cả word và difficulty từ AI
      const aiResult = await solveCard(card, rawJson, signal);
      const apiElapsed = Date.now() - apiStart;

      if (signal.aborted) return;

      const word = aiResult.word;
      const difficulty = aiResult.difficulty;

      console.log(`📊 AI chấm điểm Difficulty [${cardId}]: ${difficulty} (wordLen=${card.wordLength})`);

      const humanDelay = calcHumanDelay(word, difficulty);
      const remaining = humanDelay - apiElapsed;

      if (remaining > 0) {
        console.log(
          `⏳ API xong sau ${apiElapsed}ms, human estimate ${humanDelay}ms → bù thêm ${remaining}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, remaining));
      } else {
        console.log(
          `⚡ API xong sau ${apiElapsed}ms >= human estimate ${humanDelay}ms → không delay`,
        );
      }

      saveToCache(cardId, word);
      console.log(`💾 Đã lưu DB: [${cardId}] → "${word}" (difficulty=${difficulty})`);

      ncp.writeSync(word);
      // ncp.writeSync(encodeClipboard(word, difficulty));
      console.log(`✅ Đã copy vào clipboard: "${word}" (difficulty=${difficulty})\n`);
    } catch (err) {
      if (err.name === "AbortError" || signal.aborted) return;
      console.error("❌ Lỗi khi gọi API:", err.message);
    }
  });
}

main().catch(console.error);