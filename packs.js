// Altyazı zip'lerini indirip subs/<altid>/ altına açar ve bir paketin içinden
// istenen bölümün dosyasını seçer. Hem listeleme (paket gerçekten bölümü içeriyor
// mu?) hem de /download tarafından kullanılır.

const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const { sitePost } = require("./client");
const { SITE_URL } = require("./flaresolverr");
const { ensureHeaders } = require("./header");

const SUB_EXTS = [".srt", ".ass", ".ssa", ".sub", ".vtt", ".smi"];
const SUBS_DIR = path.join(__dirname, "subs");

function listSubtitleFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => SUB_EXTS.includes(path.extname(f).toLowerCase()))
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort();
}

// Dosya adından sezon/bölüm numarasını çıkarır: "S02E05", "2x05", "E05",
// "Bölüm 5" ya da son bağımsız sayı ("Hunter 31-tr" -> 31). Çözünürlük, codec
// ve yıl gibi sayılar yok sayılır.
function fileEpisodeInfo(name) {
  const base = path.basename(name, path.extname(name)).toLowerCase();
  let m = base.match(/s(\d{1,2})[ ._-]*e(\d{1,4})(?!\d)/);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = base.match(/(?:^|[^a-z0-9])(\d{1,2})x(\d{1,4})(?!\d)/);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = base.match(/(?:^|[^a-zçğıöşü])(?:ep|episode|bölüm|bolum|e|b)[ ._-]*(\d{1,4})(?!\d)/);
  if (m) return { season: null, episode: Number(m[1]) };

  const numbers = [...base.matchAll(/(?<![a-z0-9])(\d{1,4})(?![0-9]|p\b|i\b)/g)]
    .map((x) => Number(x[1]))
    .filter((n) => ![480, 576, 720, 1080, 2160, 264, 265].includes(n) && !(n >= 1900 && n <= 2099));
  if (numbers.length) return { season: null, episode: numbers[numbers.length - 1] };
  return null;
}

// Paket içinden bölümü seçer. target: { season, episode, absolute, packSeason, isPack }
// Site bazı dizilerde (ör. Hunter x Hunter) bölümleri mutlak numarayla verir ve
// sezon bölmesi Stremio'dakinden farklıdır; bu yüzden mutlak numara da denenir.
function pickSubtitleFile(files, target) {
  if (!files.length) return "";
  if (!target || target.episode == null) return files[0];

  const { season, episode, absolute, packSeason, isPack } = target;
  const infos = files.map((f) => ({ file: f, info: fileEpisodeInfo(f) })).filter((x) => x.info);
  const nums = infos.map((x) => x.info.episode);
  const minNum = nums.length ? Math.min(...nums) : 0;
  const find = (fn) => (infos.find((x) => fn(x.info)) || {}).file;

  const explicit = find((i) => i.season === season && i.episode === episode);
  if (explicit) return explicit;

  const sameSeason = packSeason == null || packSeason === season;

  // Mutlak numara: 1'den başlamayan paketlerde (ör. 59-75) ya da 1. sezon paketinde.
  if (absolute && (minNum > 1 || packSeason === 1)) {
    const abs = find((i) => i.episode === absolute && (i.season == null || i.season === packSeason));
    if (abs) return abs;
  }

  if (sameSeason) {
    const rel = find((i) => i.episode === episode && (i.season == null || i.season === season));
    if (rel) return rel;
    // Son çare (Cinemeta'ya ulaşılamadıysa): sezon tutuyor ama numaralar
    // 1'den başlamıyor -> sıraya göre.
    if (!absolute && minNum > 1) {
      const ord = find((i) => i.episode === minNum + episode - 1);
      if (ord) return ord;
    }
  }

  // Tek bölümlük satır: içinde tek dosya varsa (ya da hiçbiri eşleşmediyse) ilki.
  if (!isPack) return files[0];
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

// "s2e5a63p3" -> { season: 2, episode: 5, absolute: 63, packSeason: 3, isPack: true }
// Eski biçim (düz bölüm numarası) ve "movie-0" da desteklenir.
function encodeTarget(t) {
  if (!t) return "movie-0";
  return `s${t.season}e${t.episode}` + (t.absolute ? `a${t.absolute}` : "") + (t.isPack ? `p${t.packSeason}` : "");
}

function decodeTarget(str) {
  if (!str || str.startsWith("movie")) return null;
  const m = String(str).match(/^s(\d+)e(\d+)(?:a(\d+))?(?:p(\d+))?$/);
  if (m) {
    return {
      season: Number(m[1]),
      episode: Number(m[2]),
      absolute: m[3] ? Number(m[3]) : null,
      packSeason: m[4] ? Number(m[4]) : null,
      isPack: !!m[4],
    };
  }
  const n = Number(str);
  return isNaN(n) ? null : { season: null, episode: n, absolute: null, packSeason: null, isPack: false };
}

module.exports = {
  SUB_EXTS, SUBS_DIR, listSubtitleFiles, fileEpisodeInfo, pickSubtitleFile,
  ensureSubtitleFolder, encodeTarget, decodeTarget,
};
