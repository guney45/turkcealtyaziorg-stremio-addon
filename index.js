require("dotenv").config({ path: "./.env" });
const express = require("express");
const landing = require('./landingTemplate');
const { publishToCentral } = require('stremio-addon-sdk')
const app = express();
const fs = require("fs");
const subsrt = require("subtitle-converter");
const iconv = require("iconv-lite");
const Axios = require('axios')
const subtitlePageFinder = require("./scraper");
const { openSubtitlesFinder, fileUrl } = require("./opensubtitles");
const { findAlignment, applyAlignment, pickReference } = require("./subsync");
const MANIFEST = require('./manifest');
const NodeCache = require("node-cache");
const rateLimit = require('express-rate-limit')
const { SITE_URL, FLARESOLVERR_URL, solve } = require("./flaresolverr");
const { ensureSubtitleFolder, listSubtitleFiles, pickSubtitleFile, decodeTarget } = require("./packs");
const path = require("path");
const chardet = require('chardet');
const ass2srt = require('ass-to-srt');
const sub2srt = require("./subtosrt");
const sslfix = require("./sslfix");
const { setupCache } = require("axios-cache-interceptor");


const instance = Axios.create();
const axios = setupCache(instance);



const myCache = new NodeCache({ stdTTL: 30 * 60, checkperiod: 300 });



const CACHE_MAX_AGE = 4 * 60 * 60; // 4 hours in seconds
const STALE_REVALIDATE_AGE = 4 * 60 * 60; // 4 hours
const STALE_ERROR_AGE = 7 * 24 * 60 * 60; // 7 days

// Tüm yanıtlara CORS başlığı ekle. TV (webOS/Tizen) ve web sürümlerinde Stremio
// altyazı dosyasını doğrudan tarayıcı fetch'i ile çeker; CORS yoksa dosya
// indirilir ama oynatıcı onu okuyamaz ve altyazı hiç görünmez.
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

var respond = function (res, data) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(data);
};

app.get('/', function (req, res) {
    res.set('Content-Type', 'text/html');
    res.send(landing(MANIFEST));
});

app.get('/configure', function (req, res) {
    res.set('Content-Type', 'text/html');
    const newManifest = { ...MANIFEST };
    res.send(landing(newManifest));
})

function buildManifest(configurationRequired) {
    return {
        ...MANIFEST,
        behaviorHints: { ...MANIFEST.behaviorHints, configurable: true, configurationRequired },
    };
}

app.get('/manifest.json', function (req, res) {
    return respond(res, buildManifest(false));
});

app.get('/:userConf/manifest.json', function (req, res) {
    return respond(res, buildManifest(false));
});





async function getsub(subFilePath) {
  try {
    if (fs.existsSync(subFilePath)) {
      var text = "";
      const encoding = chardet.detectFileSync(subFilePath);
      if (encoding != "UTF-8") {
        var buffer = fs.readFileSync(subFilePath);
        text = iconv.decode(buffer, 'win1254')
      }
      else {
        text = fs.readFileSync(subFilePath).toString("utf8")
      }
      var foundext = path.extname(subFilePath)
      if (typeof (text) !== "undefined" && text != "") {
        if (foundext == ".srt") {
          return { text: text, ext: foundext };
        }
        else if (foundext == ".ass") {
          let data = ass2srt(text);
          return { text: data, ext: foundext };
        } else if (foundext == ".sub") {
          var data = await sub2srt(subFilePath);
          return { text: data, ext: foundext };
        } else {
          const outputExtension = '.srt'
          const options = {
            removeTextFormatting: true,
          };

          const { subtitle } = subsrt.convert(text, outputExtension, options);
          return { text: subtitle, ext: foundext };
        }
      }


    }
  } catch (error) {
    if (error) return console.log(error);
  }
}


function CheckFolderAndFiles() {
  try {
    const folderPath = './subs/';
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
    }

    const files = fs.readdirSync(folderPath);
    // Deletes subtitles after 600 subtitle files
    if (files.length > 600) {
      files.forEach((file) => {
        const filePath = path.join(folderPath, file);
        const fileStats = fs.statSync(filePath);

        if (fileStats.isFile()) {
          fs.unlinkSync(filePath);
        } else if (fileStats.isDirectory()) {
          fs.rmdirSync(filePath, { recursive: true });
        }
      });
    }
  } catch (error) {
    if (error) console.log(error);
  }

}


// turkcealtyazi.org altyazısını (gerekirse paketten doğru bölümü seçerek) SRT metni olarak döndürür.
async function loadTaSubtitle(idid, sidid, altid, episode) {
  if (![idid, sidid, altid].every((v) => /^[a-zA-Z0-9]+$/.test(v))) {
    const err = new Error("Geçersiz altyazı kimliği.");
    err.status = 400;
    throw err;
  }
  CheckFolderAndFiles();
  const dir = await ensureSubtitleFolder(idid, sidid, altid);
  const file = pickSubtitleFile(listSubtitleFiles(dir), decodeTarget(episode));
  const sub = file ? await getsub(path.join(dir, file)) : null;
  return sub && sub.text ? sub.text : null;
}

function sendSubtitle(res, text) {
  res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_REVALIDATE_AGE}, stale-if-error=${STALE_ERROR_AGE}`);
  res.set('Content-Type', 'text/plain; charset=utf-8');
  return res.send(text);
}

app.get('/download/:idid\-:sidid\-:altid\-:episode', async function (req, res) {
  const { idid, sidid, altid, episode } = req.params;
  try {
    const text = await loadTaSubtitle(idid, sidid, altid, episode);
    if (!text) {
      console.log(`[download] ${altid}: bölüm ${episode} için uygun altyazı bulunamadı`);
      return res.status(404).send("Altyazı bulunamadı.");
    }
    return sendSubtitle(res, text);
  } catch (err) {
    if (err.status === 400) return res.status(400).send(err.message);
    console.log(`[download] ${altid} hata:`, err.message);
    res.set('Cache-Control', 'no-store');
    return res.status(502).send("Couldn't get the subtitle.");
  }
});

async function fetchOsSubtitle(id) {
  const res = await axios.get(fileUrl(id), { timeout: 15000, responseType: "text", cache: false });
  return String(res.data);
}

// Senkronlanmış altyazı: /sync/<referans OS dosya id>/a/<indirme kodu> veya /sync/<ref>/o/<OS dosya id>
// Kaynak altyazı, oynatılan dosyayla aynı sürüme ait referans altyazının zamanlarına oturtulur.
const syncCache = new NodeCache({ stdTTL: 6 * 60 * 60, checkperiod: 600 });

app.get('/sync/:ref/:kind/:src', async function (req, res) {
  const { ref, kind, src } = req.params;
  try {
    if (!/^\d+$/.test(ref)) return res.status(400).send("Geçersiz referans.");
    const key = `${ref}|${kind}|${src}`;
    let text = syncCache.get(key);
    if (!text) {
      let source;
      if (kind === "o" && /^\d+$/.test(src)) {
        source = await fetchOsSubtitle(src);
      } else if (kind === "a") {
        const m = src.match(/^([a-zA-Z0-9]+)-([a-zA-Z0-9]+)-([a-zA-Z0-9]+)-(.+)$/);
        if (!m) return res.status(400).send("Geçersiz altyazı kimliği.");
        source = await loadTaSubtitle(m[1], m[2], m[3], m[4]);
      } else {
        return res.status(400).send("Geçersiz altyazı türü.");
      }
      if (!source) return res.status(404).send("Altyazı bulunamadı.");

      const reference = await fetchOsSubtitle(ref);
      const alignment = findAlignment(reference, source);
      if (alignment) {
        console.log(`[sync] ${kind}/${src} -> ref ${ref}: kayma ${alignment.offset.toFixed(1)}s, ölçek ${alignment.scale.toFixed(4)}, örtüşme %${Math.round(alignment.score * 100)}`);
        text = applyAlignment(source, alignment);
      } else {
        // Güvenilir eşleşme yoksa altyazı olduğu gibi verilir.
        console.log(`[sync] ${kind}/${src} -> ref ${ref}: güvenilir eşleşme bulunamadı, değiştirilmedi`);
        text = source;
      }
      syncCache.set(key, text);
    }
    return sendSubtitle(res, text);
  } catch (err) {
    console.log(`[sync] ${kind}/${src} hata:`, err.message);
    res.set('Cache-Control', 'no-store');
    return res.status(502).send("Couldn't get the subtitle.");
  }
});

// Tanılama: tarayıcıdan http://<ip>:7000/debug/tt0816692 (film) veya
// http://<ip>:7000/debug/tt0944947:1:1 (dizi) açarak zincirin hangi adımda
// takıldığını görebilirsin.
app.get('/debug/:imdbId', async function (req, res) {
  const out = { siteUrl: SITE_URL, flaresolverrUrl: FLARESOLVERR_URL };
  try {
    const t0 = Date.now();
    const sol = await solve(SITE_URL);
    out.flaresolverr = { ok: !!(sol && sol.cookie), cookieParts: sol && sol.cookie ? sol.cookie.split(";").length : 0, ms: Date.now() - t0 };
  } catch (e) {
    out.flaresolverr = { ok: false, error: e.message };
  }
  try {
    const [videoId, season, episode] = req.params.imdbId.split(":");
    const type = season ? "series" : "movie";
    out.mainPage = await subtitlePageFinder.mainPageFinder(videoId);
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol || 'http';
    const baseUrl = process.env.HOST_URL || `${proto}://${req.headers.host}`;
    out.subtitles = await subtitlePageFinder(videoId, type, Number(season), Number(episode), baseUrl);
  } catch (e) {
    out.error = e.message;
  }
  return respond(res, out);
});

// Oynatılan dosyanın adı altyazının sürüm adını (ör. "aXXo") içeriyorsa o altyazı
// aynı kaynaktan yapılmıştır ve senkronu tutar; onu öne al.
function releaseMatches(release, filename) {
  if (!release || !filename) return false;
  const name = filename.toLowerCase();
  return release.toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && t !== "genel")
    .some((t) => name.includes(t));
}

// Her altyazının hemen arkasına, referans altyazıya göre kaydırılmış "-sync" kopyasını ekler.
function syncUrl(s, ref, baseUrl) {
  if (!ref) return null;
  if (s.source === "os") {
    return s.fileId && s.fileId !== ref.fileId ? `${baseUrl}/sync/${ref.fileId}/o/${s.fileId}` : null;
  }
  const token = String(s.url).split("/download/")[1];
  return token ? `${baseUrl}/sync/${ref.fileId}/a/${token}` : null;
}

function rankSubtitles(raw, filename, ref, baseUrl) {
  let taCount = 0, osCount = 0;
  return raw
    .map((s) => ({ ...s, match: releaseMatches(s.release, filename) }))
    .sort((a, b) => (b.match - a.match) || (b.downloads - a.downloads))
    .flatMap((s) => {
      // turkcealtyazi.org: A1-3806-23.976, OpenSubtitles: O1-23.976
      const name = s.source === "os" ? `O${++osCount}` : `A${++taCount}`;
      const parts = s.source === "os" ? [name] : [name, s.downloads];
      if (s.fps) parts.push(s.fps);
      if (s.packFile != null) parts.push("P" + s.packFile);
      const out = [{ id: s.id, url: s.url, lang: s.lang, label: parts.join("-") }];
      const url = syncUrl(s, ref, baseUrl);
      if (url) out.push({ id: s.id + "-sync", url, lang: s.lang, label: name + "-sync" });
      return out;
    });
}

app.get('/:userConf?/subtitles/:type/:imdbId/:query?.json', async function (req, res) {
  try {
    let { type, imdbId, query } = req.params
    let videoId = String(imdbId.split(":")[0]);
    let season = Number(imdbId.split(":")[1])
    let episode = Number(imdbId.split(":")[2])

    // İndirme linkleri için temel adres: HOST_URL verilmişse o kullanılır,
    // verilmezse gelen isteğin Host başlığından türetilir (TV/telefon için doğru).
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol || 'http';
    const baseUrl = process.env.HOST_URL || `${proto}://${req.headers.host}`;
    const cacheKey = `${baseUrl}|${req.params.imdbId}`;
    const filename = String(new URLSearchParams(query || "").get("filename") || "");
    console.log(`[subtitles] ${req.params.imdbId} filename=${filename || "-"}`);

    let found = myCache.get(cacheKey);
    if (!found) {
      const [ta, os] = await Promise.all([
        subtitlePageFinder(videoId, type, season, episode, baseUrl).catch(() => []),
        openSubtitlesFinder(videoId, type, season, episode),
      ]);
      found = { subs: [...(ta || []), ...os.turkish], references: os.references };
      myCache.set(cacheKey, found, found.subs.length ? 45 * 60 : 2 * 60);
    }

    // Oynatılan dosyayla aynı sürüme ait altyazı, senkron için referans olur.
    const ref = pickReference(found.references, filename);
    if (ref) console.log(`[subtitles] senkron referansı: ${ref.lang} ${ref.release.trim()}`);
    const subtitles = rankSubtitles(found.subs, filename, ref, baseUrl);
    if (subtitles.length > 0) {
      respond(res, { subtitles, cacheMaxAge: CACHE_MAX_AGE, staleRevalidate: STALE_REVALIDATE_AGE, staleError: STALE_ERROR_AGE });
    } else {
      respond(res, { subtitles });
    }

  } catch (err) {
    console.log(err);
    respond(res, { "subtitles": [] });
  }
})


app.get('*', function (req, res) {
  res.redirect("/")
});

if (module.parent) {
  module.exports = app;
} else {
  app.listen(process.env.PORT || 7000, function (err) {
    if (err) return console.error("Error "+err);
    console.log(`extension running port : ${process.env.PORT}`)
  });
}

//publish to stremio store
//publishToCentral(process.env.HOST_URL + "/manifest.json");
