const fs = require("fs");
const { handleProtectSimulation } = require("./encrypt.cjs");

const DONE_FILE = "./done.json";

function loadDoneData() {
  try {
    return JSON.parse(fs.readFileSync(DONE_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveDoneData(doneData) {
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

const data = JSON.parse(fs.readFileSync("./data.json", "utf8"));

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
  const accessToken =
    "eyJhbGciOiJSUzI1NiIsImtpZCI6IjJmMjk1MGEyNGFlYWRkMjYzYzIxM2I2MDNhZjMxNWEzMjdiNmM3MjAiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiY2IgdmlldCIsInBpY3R1cmUiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NJNHRnZ25hc0hnWENSc0xFYW9FN3RmYXZURk9NR3JOaE92UE02SGZGN2FFc0xNcEE9czk2LWMiLCJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vc2hhZG93LWRpY3RhdGlvbiIsImF1ZCI6InNoYWRvdy1kaWN0YXRpb24iLCJhdXRoX3RpbWUiOjE3ODIzMTczMDQsInVzZXJfaWQiOiJFb0pHTFdWcmZxUTNRVjRpcVhzeTM3Qk1kWHUxIiwic3ViIjoiRW9KR0xXVnJmcVEzUVY0aXFYc3kzN0JNZFh1MSIsImlhdCI6MTc4MjMyMDkxOSwiZXhwIjoxNzgyMzI0NTE5LCJlbWFpbCI6InZpZXRjYjMxMEBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZmlyZWJhc2UiOnsiaWRlbnRpdGllcyI6eyJnb29nbGUuY29tIjpbIjExNDEzNzk5ODA0NDQyMDQzNjAyOCJdLCJlbWFpbCI6WyJ2aWV0Y2IzMTBAZ21haWwuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoiZ29vZ2xlLmNvbSJ9fQ.FyZSSoZLBFidsvccCy-MIimRObe9qyQb7CpAl114501wf4nbp25zsGqrzPB59hE0nvPJGdAqHxbwA1ejLVuhmczuYlpLMLY9FrfAyiNG8C_MBTpHqsy1W9NFMC_gHlGkCuS0s5i5bVOi8lfJzfIaxGdNRJ61Ex3iV-qystiIadYF1S2ZxmPqH4UludnsgBd7J0dYGnW8Ez-gzAsxqrCBhuaWDzk4GHdWHoGd9bVwfo327t_n8yRNMiNz137089ojLB6cK7UUQtsj7C1jYzJ71erCUkJ10WDaeXmg_hE2otLKjI-B2zHHKp_NKiW6BrQmOxT0KY5fU8nWOE7HoS57lw";
  for (const item of result) {
    console.log(`\n===== Payload ${item.id} =====`);

    if (item.data.length === 0) {
      console.log("Skip (all done)");
      continue;
    }

    for (let i = 0; i < item.data.length; i++) {
      const sentenceId = item.data[i];

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
