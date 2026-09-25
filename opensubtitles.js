// Stremio'nun resmi OpenSubtitles v3 eklentisinden Türkçe altyazıları çeker.
// OpenSubtitles bazı dizilerde bölümleri mutlak numarayla tutar (ör. Hunter x
// Hunter "A × Hard × Master?" orada S1E63, Cinemeta'da S2E5). Bu yüzden dizilerde
// Stremio'nun numarasına ek olarak 1. sezon + mutlak bölüm ile de sorgulanır.

const Axios = require("axios");
const { absoluteEpisode } = require("./episodes");

const OPENSUBTITLES_URL = process.env.OPENSUBTITLES_URL || "https://opensubtitles-v3.strem.io";
const OS_FILE_BASE = "https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/";

function fileId(url) {
  const m = String(url).match(/\/src-api\/file\/(\d+)$/);
  return m ? m[1] : null;
}

function fileUrl(id) {
  return OS_FILE_BASE + id;
}

async function query(type, id) {
  try {
    const res = await Axios.get(`${OPENSUBTITLES_URL}/subtitles/${type}/${id}.json`, { timeout: 8000 });
    return (res.data && res.data.subtitles) || [];
  } catch (e) {
    console.log(`[opensubtitles] ${id} alınamadı:`, e.message);
    return [];
  }
}

async function openSubtitlesFinder(imdbId, type, season, episode) {
  const ids = [type === "series" ? `${imdbId}:${season}:${episode}` : imdbId];
  if (type === "series" && season > 1) {
    const abs = await absoluteEpisode(imdbId, season, episode);
    if (abs && abs !== episode) ids.push(`${imdbId}:1:${abs}`);
  }

  const results = await Promise.all(ids.map((id) => query(type, id)));
  const seen = new Set();
  const turkish = [];
  const references = []; // senkron için referans adayları (tüm diller)
  for (const s of results.flat()) {
    if (!s.url || seen.has(s.id)) continue;
    seen.add(s.id);
    const release = s.movieReleaseName || s.subtitleFileName || "";
    const fid = fileId(s.url);
    if (fid) references.push({ fileId: fid, lang: s.lang, release: [s.movieReleaseName, s.subtitleFileName].join(" ") });
    if (s.lang !== "tur") continue;
    turkish.push({
      source: "os",
      id: "os-" + s.id,
      url: s.url,
      fileId: fid,
      lang: "tur",
      downloads: 0,
      fps: s.fpsMilli ? String(s.fpsMilli / 1000) : "",
      release,
    });
  }
  return { turkish, references };
}

module.exports = { openSubtitlesFinder, fileUrl };
