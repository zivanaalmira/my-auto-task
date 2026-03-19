const axios = require("axios");
const fs = require("fs");

const FILE_JSON = "data.json";

// Telegram config dari GitHub Secrets
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Kurs Rupiah
const USD_TO_IDR = 15000;
const BIG_PUMP_THRESHOLD = 1.05; // 5% kenaikan untuk BIG PUMP

// FUNCTION TELEGRAM
async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "Markdown"
    });
    console.log("✅ Pesan Telegram terkirim");
  } catch (err) {
    console.error("❌ Error Telegram:", err.response?.data || err.message);
  }
}

// MAIN FUNCTION
async function getCrypto() {
  try {
    const res = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
      params: { vs_currency: "usd", order: "market_cap_desc", per_page: 100, page: 2 },
      timeout: 10000
    });

    // Load data lama
    let oldData = {};
    if (fs.existsSync(FILE_JSON)) oldData = JSON.parse(fs.readFileSync(FILE_JSON));

    let newData = {};
    let early = [], beruntun = [], big = [];

    res.data.forEach(c => {
      const symbol = c.symbol.toUpperCase();
      const priceUSD = c.current_price;
      const priceIDR = priceUSD * USD_TO_IDR;
      const isCheap = priceIDR < 15000 && priceIDR > 50;

      // EARLY PUMP
      if (oldData[symbol]?.length >= 1) {
        const oldPrice = oldData[symbol].slice(-1)[0];
        const change = oldPrice > 0 ? parseFloat(((priceUSD - oldPrice)/oldPrice*100).toFixed(3)) : 0;
        if (isCheap && change >= 0.1 && change < 0.5) early.push({ symbol, change, price: priceIDR });
      }

      // PUMP BERUNTUN
      if (oldData[symbol]?.length === 2) {
        const [p20, p10] = oldData[symbol];
        const ch1 = p20>0 ? parseFloat(((p10 - p20)/p20*100).toFixed(3)) : 0;
        const ch2 = p10>0 ? parseFloat(((priceUSD - p10)/p10*100).toFixed(3)) : 0;
        const totalChange = ch1 + ch2;
        if (isCheap && ch1>0.15 && ch2>0.15 && c.total_volume*USD_TO_IDR>500000000 && c.price_change_percentage_24h>0) {
          beruntun.push({ symbol, change1: ch1, change2: ch2, totalChange, price: priceIDR, volume: c.total_volume*USD_TO_IDR });
        }
      }

      // BIG PUMP
      if (isCheap && oldData[symbol]?.length>=2 && priceUSD > BIG_PUMP_THRESHOLD*oldData[symbol][0] && c.total_volume*USD_TO_IDR>1000000000 && c.price_change_percentage_24h>0) {
        const oldPrice = oldData[symbol][0];
        const change = ((priceUSD - oldPrice)/oldPrice*100).toFixed(3);
        big.push({ symbol, price: priceIDR, volume: c.total_volume*USD_TO_IDR, change });
      }

      // Update data historis (hanya 2 harga terakhir)
      let history = oldData[symbol] || [];
      if (!Array.isArray(history)) history = [history];
      newData[symbol] = [...history, priceUSD].slice(-2);
    });

    // FORMAT PESAN TELEGRAM
    let msg = "*🚀 CRYPTO PUMP ALERT (IDR)*\n\n";
    const fmtLine = (c, isBeruntun=false) => {
      const priceStr = `Rp${c.price.toLocaleString("id-ID")}`;
      if (isBeruntun) return `*${c.symbol}* | 🔼 +${c.totalChange.toFixed(3)}% | Vol: Rp${c.volume.toLocaleString("id-ID")} | ${priceStr}`;
      return `*${c.symbol}* | +${c.change}% | ${priceStr}`;
    };

    if (early.length) { msg += "🟢 *EARLY PUMP*\n"; early.forEach(c=>msg+=fmtLine(c)+"\n"); msg+="\n"; }
    if (beruntun.length) { msg += "🔼 *PUMP BERUNTUN*\n"; beruntun.forEach(c=>msg+=fmtLine(c,true)+"\n"); msg+="\n"; }
    if (big.length) { msg += "🔥 *BIG PUMP*\n"; big.forEach(c=>{ msg+=`*${c.symbol}* | +${c.change}% | Vol: Rp${c.volume.toLocaleString("id-ID")} | Rp${c.price.toLocaleString("id-ID")}\n`; }); msg+="\n"; }

    // Kirim Telegram jika ada pump
    if (early.length + beruntun.length + big.length>0) {
      await sendTelegram(msg);
    } else {
      // Jika tidak ada pump, tetap log di console
      console.log("Tidak ada pump terdeteksi saat ini.");
    }

    // Simpan JSON
    fs.writeFileSync(FILE_JSON, JSON.stringify(newData,null,2));

  } catch(err) {
    console.error("Error:", err.message);
  }
}

getCrypto();
