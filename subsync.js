// Altyazıyı, oynatılan dosyayla senkron olduğu varsayılan bir referans altyazıya
// (genelde aynı sürüm adına sahip İngilizce altyazı) göre kaydırır. Diller farklı
// olduğu için metin değil, konuşmanın olduğu zaman aralıkları karşılaştırılır.

const RES = 10; // saniyede örnek sayısı (100 ms çözünürlük)
const MAX_SHIFT = 120; // saniye
const SCALES = [1, 23.976 / 25, 25 / 23.976]; // fps farkı (25 <-> 23.976)
const MIN_SCORE = 0.5; // bu skorun altında eşleşmeye güvenilmez

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g;

function toSeconds(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

function parseCues(text) {
  const cues = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes("-->")) continue;
    const t = [...line.matchAll(TIME_RE)];
    if (t.length < 2) continue;
    const start = toSeconds(t[0][1], t[0][2], t[0][3], t[0][4]);
    const end = toSeconds(t[1][1], t[1][2], t[1][3], t[1][4]);
    if (end > start) cues.push([start, end]);
  }
  return cues;
}

function activeSignal(cues) {
  const len = Math.ceil(Math.max(0, ...cues.map((c) => c[1])) * RES) + 1;
  const sig = new Uint8Array(len);
  for (const [a, b] of cues) sig.fill(1, Math.floor(a * RES), Math.ceil(b * RES));
  return sig;
}

function activeIndices(cues, scale) {
  const sig = activeSignal(cues.map(([a, b]) => [a * scale, b * scale]));
  const out = [];
  for (let i = 0; i < sig.length; i++) if (sig[i]) out.push(i);
  return out;
}

function overlap(ref, idx, shift) {
  let n = 0;
  for (let k = 0; k < idx.length; k++) {
    const j = idx[k] + shift;
    if (j >= 0 && j < ref.length && ref[j]) n++;
  }
  return n;
}

// src altyazısını ref'e oturtmak için gereken ölçek ve kaymayı bulur:
// yeni zaman = eski * scale + offset
function findAlignment(refText, srcText) {
  const refCues = parseCues(refText);
  const srcCues = parseCues(srcText);
  if (refCues.length < 10 || srcCues.length < 10) return null;

  const ref = activeSignal(refCues);
  let refActive = 0;
  for (let i = 0; i < ref.length; i++) refActive += ref[i];

  let best = null;
  for (const scale of SCALES) {
    const idx = activeIndices(srcCues, scale);
    let bestShift = 0, bestN = -1, sum = 0, count = 0;
    // Önce yarım saniyelik adımlarla kaba arama, sonra 100 ms ile ince ayar.
    for (let d = -MAX_SHIFT * RES; d <= MAX_SHIFT * RES; d += RES / 2) {
      const n = overlap(ref, idx, d);
      sum += n; count++;
      if (n > bestN) { bestN = n; bestShift = d; }
    }
    for (let d = bestShift - RES / 2; d <= bestShift + RES / 2; d++) {
      const n = overlap(ref, idx, d);
      if (n > bestN) { bestN = n; bestShift = d; }
    }
    // Konuşma sürenin büyük kısmını kapladığından rastgele bir kaydırma da yüksek
    // örtüşme verir; skor, ortalama kaydırmaya göre ne kadar iyi olduğunu ölçer
    // (0: rastgele kadar, 1: kusursuz).
    const mean = sum / count;
    const score = (bestN - mean) / Math.max(1, Math.min(refActive, idx.length) - mean);
    // fps değiştirmek ancak belirgin şekilde daha iyi eşleşiyorsa seçilir.
    if (!best || score > best.score + (scale === 1 ? 0 : 0.05)) {
      best = { scale, offset: bestShift / RES, score };
    }
  }
  return best && best.score >= MIN_SCORE ? best : null;
}

function formatTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

function applyAlignment(text, { scale, offset }) {
  return String(text).split(/(\r?\n)/).map((line) => {
    if (!line.includes("-->")) return line;
    return line.replace(TIME_RE, (_, h, m, s, ms) => formatTime(toSeconds(h, m, s, ms) * scale + offset));
  }).join("");
}

// Dosya adına en çok benzeyen sürüm adına sahip altyazıyı referans seçer.
// Her adayda geçen kelimeler (dizi adı gibi) ayırt edici olmadığı için sayılmaz;
// çözünürlük/kaynak gibi genel kelimeler daha az ağırlık alır.
const GENERIC = new Set(["480p", "720p", "1080p", "2160p", "4k", "x264", "x265", "h264", "h265", "hevc", "web", "webrip", "webdl", "dl", "bluray", "brrip", "bdrip", "hdtv", "aac", "ac3", "dts", "10bit", "mkv", "mp4", "avi", "srt", "en", "eng", "tr", "tur", "the", "and"]);

function tokens(str) {
  return new Set(String(str).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2));
}

function pickReference(candidates, filename) {
  if (!filename || !candidates.length) return null;
  const want = tokens(filename);
  const sets = candidates.map((c) => tokens(c.release));
  const common = new Set();
  if (candidates.length >= 3) {
    for (const t of want) {
      if (sets.filter((s) => s.has(t)).length >= candidates.length / 2) common.add(t);
    }
  }

  let best = null;
  candidates.forEach((c, i) => {
    let score = 0, distinctive = 0;
    for (const t of sets[i]) {
      if (!want.has(t) || common.has(t)) continue;
      if (GENERIC.has(t)) score += 0.3;
      else { score += 1; distinctive++; }
    }
    if (distinctive && (!best || score > best.score)) best = { ...c, score };
  });
  return best;
}

module.exports = { findAlignment, applyAlignment, pickReference };
