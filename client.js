// turkcealtyazi.org'a yapılan tüm istekleri tek yerden yönetir:
//  - Her istekten önce FlareSolverr'dan alınan cookie/UA'yı ekler.
//  - Yanıt anti-bot tarafından engellenmiş görünüyorsa cookie'yi yenileyip 1 kez
//    yeniden dener.

const Axios = require("axios");
const { setupCache } = require("axios-cache-interceptor");
const { header, ensureHeaders } = require("./header");

// 4xx hataları throw etmesin ki engellenme durumunu inceleyip tekrar deneyebilelim.
const instance = Axios.create({ validateStatus: (s) => s >= 200 && s < 500 });
const axios = setupCache(instance);

function looksBlocked(res) {
  if (!res) return true;
  if ([403, 429, 503].includes(res.status)) return true;
  const body = typeof res.data === "string" ? res.data : "";
  return /just a moment|cdn-cgi\/challenge|cf-browser-verification|attention required|yoncukoruma/i.test(
    body
  );
}

async function request(opts) {
  await ensureHeaders();
  let res = await axios({ ...opts, headers: { ...header, ...(opts.headers || {}) } });

  if (looksBlocked(res)) {
    console.log(
      `[client] engellenmiş görünüyor (status=${res && res.status}), cookie yenileniyor...`
    );
    await ensureHeaders({ force: true });
    res = await axios({
      ...opts,
      headers: { ...header, ...(opts.headers || {}) },
      cache: false,
    });
  }
  return res;
}

const siteGet = (url, opts = {}) => request({ ...opts, url, method: "GET" });
const sitePost = (url, data, opts = {}) =>
  request({ ...opts, url, method: "POST", data });

module.exports = { siteGet, sitePost };
