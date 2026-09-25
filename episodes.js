// Stremio'nun (Cinemeta) sezon/bölümünü mutlak bölüm numarasına çevirir.
// Ör. Hunter x Hunter (2011): Cinemeta'da 1. sezon 58 bölüm, S2E5 -> 63.
// turkcealtyazi.org bazı dizilerde bölümleri mutlak numarayla ve farklı bir
// sezon bölmesiyle listelediği için eşleştirmede bu numara kullanılır.

const Axios = require("axios");
const NodeCache = require("node-cache");

const CINEMETA_URL = process.env.CINEMETA_URL || "https://v3-cinemeta.strem.io";
const cache = new NodeCache({ stdTTL: 24 * 60 * 60 });

async function seasonCounts(imdbId) {
  const cached = cache.get(imdbId);
  if (cached) return cached;
  const res = await Axios.get(`${CINEMETA_URL}/meta/series/${imdbId}.json`, { timeout: 10000 });
  const videos = (res.data && res.data.meta && res.data.meta.videos) || [];
  const counts = {};
  for (const v of videos) {
    if (!v.season || v.season < 1) continue; // 0. sezon = özel bölümler
    counts[v.season] = (counts[v.season] || 0) + 1;
  }
  cache.set(imdbId, counts);
  return counts;
}

async function absoluteEpisode(imdbId, season, episode) {
  try {
    const counts = await seasonCounts(imdbId);
    if (!counts[season]) return null;
    let total = 0;
    for (let s = 1; s < season; s++) total += counts[s] || 0;
    return total + episode;
  } catch (e) {
    console.log(`[episodes] ${imdbId} mutlak bölüm hesaplanamadı:`, e.message);
    return null;
  }
}

module.exports = { absoluteEpisode };
