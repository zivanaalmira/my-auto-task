const axios = require("axios");
const fs = require("fs");

// ================= CONFIG =================
const FILE_JSON = "data.json";
const COINS_FILE = "indodaxCoins.json";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Near Low
const MAX_PRICE_IDR = 30000;
const DIFF_MIN = -10;
const DIFF_MAX = 0.5;

// Pump
const LOOP_MINI = 2;
const DELAY_SCAN = 20000;
const MIN_CHANGE = 0.5;
const MAX_VOLUME = 15000000000;

// Retry
const RETRIES = 3;
const RETRY_DELAY = 5000;

// ================= LOAD COINS =================
let coins = [];
if (fs.existsSync(COINS_FILE)) {
  coins = JSON.parse(fs.readFileSync(COINS_FILE));
} else {
  console.error("❌ indodaxCoins.json tidak ditemukan");
  process.exit(1);
}

// ================= UTIL =================
const delay = ms => new Promise(res => setTimeout(res, ms));

// ================= TELEGRAM =================
async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) return;

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "Markdown"
    });
    console.log("✅ Telegram terkirim");
  } catch (err) {
    console.error("❌ Telegram error:", err.message);
  }
}

// ================= FETCH WITH RETRY =================
async function fetchWithRetry(url, retries = RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
    } catch (err) {
      if (i < retries) {
        console.warn(`⚠️ Retry ${i + 1}/${retries}`);
        await delay(RETRY_DELAY);
      } else {
        throw err;
      }
    }
  }
}

// ================= GET INDODAX DATA =================
async function getIndodaxData() {
  try {
    console.log("🌐 Ambil data Indodax...");
    const res = await fetchWithRetry("https://indodax.com/api/tickers");
    return res.data.tickers;
  } catch (err) {
    console.error("❌ Gagal ambil data:", err.message);
    return {};
  }
}

// ================= NEAR LOW =================
async function detectNearLow(data) {
  console.log("🔎 Scan Near Low...");
  let results = [];

  for (let coin of coins) {
    const pair = coin.symbol.toLowerCase() + "_idr";
    const market = data[pair];

    if (!market) {
      console.log(`⏭️ Skip ${coin.symbol}`);
      continue;
    }

    const price = parseFloat(market.last);
    const low = parseFloat(market.low);

    if (price > MAX_PRICE_IDR) continue;

    const diff = ((price - low) / low) * 100;

    if (diff >= DIFF_MIN && diff <= DIFF_MAX) {
      results.push({
        symbol: coin.symbol,
        price,
        low,
        diff: diff.toFixed(2),
        below: price <= low
      });
    }
  }

  if (results.length > 0) {
    let msg = "*INDODAX | 🔎 MENUJU HARGA RENDAH*\n\n";

    results.forEach(r => {
      msg += `*${r.symbol}* | Rp${Math.round(r.price).toLocaleString("id-ID")} | Low Rp${Math.round(r.low).toLocaleString("id-ID")} | Δ ${r.diff}%`;
      if (r.below) msg += " 💥";
      msg += "\n";
    });

    await sendTelegram(msg);
  } else {
    console.log("⚠️ Tidak ada near low");
  }
}

// ================= PUMP =================
async function detectPump(data) {
  console.log("🚀 Scan Pump...");

  let oldData = fs.existsSync(FILE_JSON)
    ? JSON.parse(fs.readFileSync(FILE_JSON))
    : {};

  let newData = {};
  let signals = [];

  for (let coin of coins) {
    const pair = coin.symbol.toLowerCase() + "_idr";
    const market = data[pair];

    if (!market) continue;

    const price = parseFloat(market.last);
    const volume = parseFloat(market.vol_idr);

   // if (volume > MAX_VOLUME) continue;

    let history = oldData[coin.symbol] || [];

    if (history.length >= 1) {
      const prev = history[history.length - 1];
      const change = ((price - prev.price) / prev.price) * 100;

      let emoji = "";

      if (change >= MIN_CHANGE && change < 1) emoji = "🟢";
      else if (change >= 1 && change < 3) emoji = "🚀";
      else if (change >= 3) emoji = "🔥";

      if (emoji) {
        signals.push({
          symbol: coin.symbol,
          change: change.toFixed(2),
          price
        });
      }
    }

    newData[coin.symbol] = [...history, { price, volume }].slice(-2);
  }

  if (signals.length > 0) {
    let msg = "*🚀 SINYAL NAIK *\n\n";

    signals.slice(0, 10).forEach(s => {
      msg += `${s.symbol} | +${s.change}% | Rp${Math.round(s.price).toLocaleString("id-ID")}\n`;
    });

    await sendTelegram(msg);
  } else {
    console.log("⚠️ Tidak ada pump");
  }

  fs.writeFileSync(FILE_JSON, JSON.stringify(newData, null, 2));
}

// ================= MAIN =================
async function runBot() {
  console.log("🚀 BOT START (FULL INDODAX)");

  const data = await getIndodaxData();

  await detectNearLow(data);

  for (let i = 1; i <= LOOP_MINI; i++) {
    console.log(`⏱️ Pump loop ${i}`);
    await detectPump(data);

    if (i < LOOP_MINI) await delay(DELAY_SCAN);
  }

  console.log("✅ Selesai");
}

runBot();
