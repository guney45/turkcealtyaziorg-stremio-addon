require("dotenv").config({ path: "./.env" });
const flaresolverr = require("./flaresolverr");

// turkcealtyazi.org doğrudan kazınırken kullanılan istek başlıkları.
// Cookie ve User-Agent, FlareSolverr'ın çözdüğü anti-bot oturumundan doldurulur.
const header = {
  "Accept-Language": "tr,en;q=0.9,en-GB;q=0.8,en-US;q=0.7",
  "Sec-Ch-Ua-Platform": "Windows",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Cookie": "",
  "Origin": flaresolverr.SITE_URL,
  "Referer": flaresolverr.SITE_URL + "/",
};

// Cookie/User-Agent'ı güncel tutar. force=true ise anti-bot oturumunu yeniler.
async function ensureHeaders({ force = false } = {}) {
  try {
    const sol = await flaresolverr.solve(flaresolverr.SITE_URL, { force });
    if (sol && sol.cookie) header.Cookie = sol.cookie;
    if (sol && sol.userAgent) header["User-Agent"] = sol.userAgent;
  } catch (e) {
    console.log("FlareSolverr cookie alınamadı:", e.message);
  }
  return header;
}

module.exports = { header, ensureHeaders };
