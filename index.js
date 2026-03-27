const axios = require("axios");
const fs = require("fs");

// ================= CONFIG =================
const FILE_JSON = "data.json";
const COINS_FILE = "indodaxCoins.json";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const USD_TO_IDR = 15000;

// Near Low
const MAX_PRICE_IDR = 30000;
const DIFF_MIN = 0;
const DIFF_MAX = 1;

// Pump
const LOOP_MINI = 2;
const DELAY_SCAN = 20000;
const MIN_CHANGE = 0.3;
const MAX_VOLUME = 5000000000;

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
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
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

// ================= GET BINANCE (ANTI 451) =================
async function getBinanceData() {
  try {
    console.log("🌐 Ambil data Binance utama...");
    const res = await fetchWithRetry("https://api.binance.com/api/v3/ticker/24hr");
    return res.data;
  } catch (err) {
    console.warn("⚠️ Binance utama gagal (kemungkinan 451), pakai backup...");
    const res = await fetchWithRetry("https://data-api.binance.vision/api/v3/ticker/24hr");
    return res.data;
  }
}

// ================= NEAR LOW =================
async function detectNearLow(data) {
  console.log("🔎 Scan Near Low...");
  let results = [];

  for (let coin of coins) {
    const symbol = coin.symbol.toUpperCase();
    const pair = symbol + "USDT";

    const market = data.find(d => d.symbol === pair);
    if (!market) {
      console.log(`⏭️ Skip ${symbol} (tidak ada di Binance)`);
      continue;
    }

    const price = parseFloat(market.lastPrice);
    const low = parseFloat(market.lowPrice);

    const priceIDR = price * USD_TO_IDR;
    const lowIDR = low * USD_TO_IDR;

    if (priceIDR > MAX_PRICE_IDR) continue;

    const diff = ((price - low) / low) * 100;

    if (diff >= DIFF_MIN && diff <= DIFF_MAX) {
      results.push({
        symbol,
        price: priceIDR,
        low: lowIDR,
        diff: diff.toFixed(2),
        below: price <= low
      });
    }
  }

  if (results.length > 0) {
    let msg = "*INDODAX | 🔎 NEAR LOW ALERT*\n\n";

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
  console.log("INDODAX | 🚀 Scan Pump...");

  let oldData = fs.existsSync(FILE_JSON)
    ? JSON.parse(fs.readFileSync(FILE_JSON))
    : {};

  let newData = {};
  let signals = [];

  for (let coin of coins) {
    const symbol = coin.symbol.toUpperCase();
    const pair = symbol + "USDT";

    const market = data.find(d => d.symbol === pair);
    if (!market) continue;

    const price = parseFloat(market.lastPrice);
    const volume = parseFloat(market.quoteVolume);

    if (volume > MAX_VOLUME) continue;

    let history = oldData[symbol] || [];

    if (history.length >= 1) {
      const prev = history[history.length - 1];
      const change = ((price - prev.price) / prev.price) * 100;

      let emoji = "";

      if (change >= 0.3 && change < 1) emoji = "🟢";
      else if (change >= 1 && change < 3) emoji = "🚀";
      else if (change >= 3) emoji = "🔥";

      if (emoji) {
        signals.push({
          symbol,
          change: change.toFixed(2),
          price: price * USD_TO_IDR
        });
      }
    }

    newData[symbol] = [...history, { price, volume }].slice(-2);
  }

  if (signals.length > 0) {
    let msg = "*🚀 PUMP SIGNAL*\n\n";

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
  console.log("INDODAX | 🚀 BOT START (ANTI 451 VERSION)");

  const data = await getBinanceData();

  await detectNearLow(data);

  for (let i = 1; i <= LOOP_MINI; i++) {
    console.log(`⏱️ Pump loop ${i}`);
    await detectPump(data);

    if (i < LOOP_MINI) await delay(DELAY_SCAN);
  }

  console.log("✅ Selesai");
}

runBot();
