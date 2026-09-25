require("dotenv").config({ path: "./.env" });
const express = require("express");
const landing = require('./landingTemplate');
const { publishToCentral } = require('stremio-addon-sdk')
const app = express();
const fs = require("fs");
const subsrt = require("subtitle-converter");
const iconv = require("iconv-lite");
const unzipper = require("unzipper");
const Axios = require('axios')
const subtitlePageFinder = require("./scraper");
const MANIFEST = require('./manifest');
const NodeCache = require("node-cache");
const rateLimit = require('express-rate-limit')
const { sitePost } = require("./client");
const { SITE_URL, FLARESOLVERR_URL, solve } = require("./flaresolverr");
const { ensureHeaders } = require("./header");
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


const SUB_EXTS = [".srt", ".ass", ".ssa", ".sub", ".vtt", ".smi"];
const SUBS_DIR = path.join(__dirname, "subs");

function listSubtitleFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => SUB_EXTS.includes(path.extname(f).toLowerCase()))
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort();
}

function pickSubtitleFile(files, episode) {
  if (!files.length) return "";
  if (episode == "movie-0" || files.length == 1) return files[0];

  const checks = ["e" + episode, "b" + episode, "_" + episode + "_", "-" + episode, "x" + episode, episode];
  for (const check of checks) {
    const found = files.find((f) => f.toLowerCase().includes(check));
    if (found) return found;
  }
  return "";
}

// Zip'i bellekte açar; klasör yapısını düzleştirip sadece altyazı dosyalarını
// subs/<altid>/ altına yazar. Yazılan dosya sayısını döner.
async function extractZip(buffer, targetDir) {
  const directory = await unzipper.Open.buffer(buffer);
  fs.mkdirSync(targetDir, { recursive: true });
  let count = 0;
  for (const entry of directory.files) {
    if (entry.type !== "File") continue;
    const name = path.basename(entry.path);
    if (!SUB_EXTS.includes(path.extname(name).toLowerCase())) continue;
    fs.writeFileSync(path.join(targetDir, name), await entry.buffer());
    count++;
  }
  return count;
}

function isZip(buffer) {
  return buffer && buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

async function downloadZip(idid, sidid, altid) {
  const body = `idid=${idid}&altid=${altid}&sidid=${sidid}`;
  const opts = { responseType: 'arraybuffer', cache: false, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await ensureHeaders({ force: true });
    const response = await sitePost(SITE_URL + '/ind', body, opts);
    const buffer = response && response.data ? Buffer.from(response.data) : null;
    if (response && response.status === 200 && isZip(buffer)) return buffer;
    console.log(`[download] ${altid}: zip gelmedi (deneme ${attempt}, status=${response && response.status}, ${buffer ? buffer.length : 0} bayt)`);
  }
  throw new Error("turkcealtyazi.org zip dosyası vermedi (anti-bot engeli olabilir)");
}

// Aynı altyazı için eşzamanlı gelen istekler tek indirmeyi paylaşsın.
const inflightDownloads = new Map();

async function ensureSubtitleFolder(idid, sidid, altid) {
  const dir = path.join(SUBS_DIR, altid);
  if (listSubtitleFiles(dir).length) return dir;

  if (!inflightDownloads.has(altid)) {
    inflightDownloads.set(altid, (async () => {
      // Önceki başarısız denemeden kalan boş/bozuk klasörü temizle.
      fs.rmSync(dir, { recursive: true, force: true });
      const buffer = await downloadZip(idid, sidid, altid);
      const count = await extractZip(buffer, dir);
      if (!count) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error("zip içinde altyazı dosyası yok");
      }
      return dir;
    })().finally(() => inflightDownloads.delete(altid)));
  }
  return inflightDownloads.get(altid);
}

app.get('/download/:idid\-:sidid\-:altid\-:episode', async function (req, res) {
  const { idid, sidid, altid } = req.params;
  try {
    if (![idid, sidid, altid].every((v) => /^[a-zA-Z0-9]+$/.test(v))) {
      return res.status(400).send("Geçersiz altyazı kimliği.");
    }

    var episode = req.params.episode;
    if (episode < 10) episode = "0" + episode;

    CheckFolderAndFiles();

    const dir = await ensureSubtitleFolder(idid, sidid, altid);
    const file = pickSubtitleFile(listSubtitleFiles(dir), episode);
    const sub = file ? await getsub(path.join(dir, file)) : null;

    if (!sub || !sub.text) {
      console.log(`[download] ${altid}: bölüm ${episode} için uygun altyazı bulunamadı`);
      return res.status(404).send("Altyazı bulunamadı.");
    }

    res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_REVALIDATE_AGE}, stale-if-error=${STALE_ERROR_AGE}`);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    return res.send(sub.text);
  } catch (err) {
    console.log(`[download] ${altid} hata:`, err.message);
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

function rankSubtitles(raw, filename) {
  return raw
    .map((s) => ({ ...s, match: releaseMatches(s.release, filename) }))
    .sort((a, b) => (b.match - a.match) || (b.downloads - a.downloads))
    .map((s, i) => {
      const parts = [`A${i + 1}`, s.downloads];
      if (s.fps) parts.push(s.fps);
      return { id: s.id, url: s.url, lang: s.lang, label: parts.join("-") };
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

    let raw = myCache.get(cacheKey);
    if (!raw) {
      raw = (await subtitlePageFinder(videoId, type, season, episode, baseUrl)) || [];
      myCache.set(cacheKey, raw, raw.length ? 45 * 60 : 2 * 60);
    }

    const subtitles = rankSubtitles(raw, filename);
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
