// turkcealtyazi.org'un anti-bot korumasını (Cloudflare / Yoncu) FlareSolverr ile
// aşar. FlareSolverr başsız (headless) bir tarayıcı çalıştırıp challenge'ı çözer
// ve cookie + User-Agent döner. Bu cookie'leri saklayıp normal axios isteklerinde
// tekrar kullanırız (cf_clearance IP+UA'ya bağlıdır; bu yüzden addon ile
// FlareSolverr'ın AYNI çıkış IP'sinde -aynı sunucu/Docker ağı- olması gerekir).

const Axios = require("axios");
require("dotenv").config({ path: "./.env" });

const FLARESOLVERR_URL =
  process.env.FLARESOLVERR_URL || "http://127.0.0.1:8191/v1";
const SITE_URL = (
  process.env.SITE_URL ||
  process.env.PROXY_URL ||
  "https://turkcealtyazi.org"
).replace(/\/+$/, "");
const TTL_MS = Number(process.env.CLEARANCE_TTL_MS || 25 * 60 * 1000);
const TIMEOUT_MS = Number(process.env.FLARESOLVERR_TIMEOUT_MS || 60000);

let session = { cookie: "", userAgent: "", ts: 0 };
let inflight = null;

async function doSolve(targetUrl) {
  const res = await Axios.post(
    FLARESOLVERR_URL,
    { cmd: "request.get", url: targetUrl, maxTimeout: TIMEOUT_MS },
    { timeout: TIMEOUT_MS + 5000 }
  );

  const sol = res.data && res.data.solution;
  if (!sol || !Array.isArray(sol.cookies)) {
    throw new Error(
      "FlareSolverr çözümü boş: " +
        JSON.stringify((res.data && res.data.message) || res.data)
    );
  }

  const cookie = sol.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  session = {
    cookie,
    userAgent: sol.userAgent || session.userAgent,
    ts: Date.now(),
  };
  console.log(
    `[flaresolverr] cookie alındı (${sol.cookies.length} parça), UA=${
      session.userAgent ? "var" : "yok"
    }`
  );
  return session;
}

// Geçerli bir oturum varsa onu döner; yoksa (veya force=true) FlareSolverr'a gider.
// Eşzamanlı çağrılar tek bir çözüm isteğinde birleştirilir.
async function solve(targetUrl = SITE_URL, { force = false } = {}) {
  if (!force && session.cookie && Date.now() - session.ts < TTL_MS) {
    return session;
  }
  if (!force && inflight) return inflight;

  inflight = doSolve(targetUrl).finally(() => {
    inflight = null;
  });
  return inflight;
}

function invalidate() {
  session.ts = 0;
}

module.exports = { solve, invalidate, SITE_URL, FLARESOLVERR_URL };
