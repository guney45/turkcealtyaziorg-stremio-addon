# FurkanTürkçeAltyazı

**turkcealtyazi.org**'dan Türkçe altyazıları çekip Stremio'ya getiren, **resmi olmayan
(unofficial)**, **bireysel kullanım** için bir Stremio eklentisi. Kendi bilgisayarında
(Windows veya Mac) Docker ile çalıştırırsın; istersen aynı ağdaki TV/telefonundan da
kullanırsın.

> ⚠️ **Sorumluluk reddi:** Bu eklenti turkcealtyazi.org ile resmi bir ilişkisi olmayan,
> kişisel/eğitim amaçlı bir projedir. Altyazı içerikleri turkcealtyazi.org'a aittir.
> Kendi sorumluluğunda ve kişisel olarak kullan.

---

## Nasıl çalışır?

turkcealtyazi.org bir anti-bot koruması (Cloudflare/Yoncu) arkasındadır; bu yüzden
sunucudan düz istek atınca engellenirsin. Bu eklenti **iki parçadan** oluşur:

1. **FlareSolverr** — başsız (headless) bir tarayıcıyla anti-bot challenge'ını çözer,
   gerekli çerezleri (cookie) ve User-Agent'ı verir.
2. **Eklenti (addon)** — bu çerezlerle turkcealtyazi.org'a **doğrudan** gider, Türkçe
   altyazıları bulur, indirir ve Stremio'ya sunar.

İkisi `docker compose` ile **tek komutla** birlikte ayağa kalkar. Harici bir proxy/servis
gerekmez.

---

## Gereksinimler

- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (Windows veya Mac) — kurulu ve **çalışır** durumda olmalı.
- **[Git](https://git-scm.com/downloads)** (repoyu indirmek için; istersen ZIP olarak da indirebilirsin).
- ~2 GB boş disk (FlareSolverr içindeki tarayıcı için).

---

## Kurulum (Windows & Mac aynı)

**1) Repoyu indir** (terminal / PowerShell / CMD):

```sh
git clone https://github.com/guney45/turkcealtyaziorg-stremio-addon.git
cd turkcealtyaziorg-stremio-addon
```

**2) Çalıştır:**

```sh
docker compose up -d --build
```

> İlk çalıştırmada FlareSolverr imajı (~birkaç yüz MB) indirilir; biraz sürebilir.

**3) Çalışıyor mu kontrol et** — tarayıcında aç:

```
http://127.0.0.1:7000/
```

Eklentinin tanıtım sayfası açılıyorsa hazırsın. (JSON görmek istersen:
`http://127.0.0.1:7000/manifest.json`)

> **Port 7000 doluysa** başka bir port seç (örn. 7701) ve tüm adreslerde o portu kullan:
> ```sh
> PORT=7701 docker compose up -d --build
> ```
> Windows PowerShell'de: `$env:PORT=7701; docker compose up -d --build`

---

## Stremio'ya Ekleme

### A) Aynı bilgisayarda izleyeceksen (Stremio **masaüstü uygulaması**)

Stremio'da arama/ekleme kutusuna şunu yapıştır:

```
http://127.0.0.1:7000/addon/manifest.json
```

> ⚠️ **Stremio'nun web sürümü (app.strem.io) `http://` adresleri güvenlik nedeniyle
> engeller.** Yerel kurulumda **masaüstü uygulamasını** kullan.

### B) TV / telefon / başka bir cihazdan izleyeceksen (aynı Wi-Fi) — **LAN IP ile**

`127.0.0.1` her cihazda "o cihazın kendisi" demektir; TV ona ulaşamaz. Bu yüzden
**bilgisayarının yerel ağ (LAN) IP'siyle** kurman gerekir.

**1) Bilgisayarının LAN IP'sini öğren:**

- **Mac:**
  ```sh
  ipconfig getifaddr en0    # boş dönerse: ipconfig getifaddr en1
  ```
- **Windows:**
  ```powershell
  ipconfig
  ```
  Aktif bağlantının (Wi-Fi/Ethernet) altındaki **IPv4 Address** satırına bak (örn. `192.168.1.50`).

**2) Önce teyit et** — telefon/başka cihazın tarayıcısında (aynı Wi-Fi'da) aç:

```
http://192.168.1.50:7000/manifest.json
```

JSON geliyorsa ağ erişimi tamam.

**3) Stremio'da** (bilgisayarında veya doğrudan TV'de) bu adresle ekle:

```
http://192.168.1.50:7000/addon/manifest.json
```

**4) TV'de** Ayarlar → **"Sync addons"** (eklentileri senkronize et) yap → eklenti TV'ye gelir.

> 💡 **İpucu:** En baştan `127.0.0.1` yerine **LAN IP** ile kurarsan, "Sync addons"
> sonrası TV'ye de ulaşılabilir adres gider. İndirme linkleri zaten **isteğin geldiği
> adresten otomatik türetilir**, ekstra ayar gerekmez.

#### TV için şartlar (hepsi gerekli)
- TV ve bilgisayar **aynı ağda** (aynı Wi-Fi/router).
- Bilgisayar **açık ve uyumuyor** olmalı (uyursa eklenti durur).
  - **Mac:** izlerken `caffeinate -dimsu` çalıştır ya da uykuyu kapat.
  - **Windows:** Ayarlar → Güç → uyku süresini **"Hiçbir zaman"** yap.
- **Güvenlik duvarı** (firewall) ilgili porta izin vermeli. İlk bağlantıda Windows/Mac
  izin isterse **izin ver**.
- Docker (eklenti) **çalışır** durumda olmalı.

---

## Kullanım

Bir film/dizi aç → oynatıcıda **altyazılar** menüsünü aç → **Türkçe**'yi seç →
turkcealtyazi.org seçenekleri orada listelenir. Birden fazla seçenek varsa sırayla deneyebilirsin.

İlk seçimde altyazı indirilip senkronlanır; sonraki açışlarda anında gelir.

---

## Günlük komutlar

| Amaç | Komut |
|---|---|
| Başlat / güncelle | `docker compose up -d --build` |
| Canlı log izle | `docker compose logs -f addon` |
| Durdur | `docker compose down` |
| Yeniden başlat | `docker compose restart addon` |
| En son sürümü çek | `git pull` sonra `docker compose up -d --build` |

---

## Sorun Giderme

**Hiç altyazı gelmiyor:**
```sh
docker compose logs -f addon
```
- `[flaresolverr] cookie alındı (...)` satırını görmüyorsan FlareSolverr çalışmıyor olabilir
  (`docker compose ps` ile kontrol et).
- `mainPageFinder: sonuç bulunamadı` → o içeriğin sitede Türkçe altyazısı olmayabilir,
  **ya da** arama yolu değişmiştir. Gerekirse `.env`'de `SEARCH_PATH`'i ayarla.

**TV'de gözükmüyor (ama bilgisayarda çalışıyor):** `127.0.0.1` ile kurmuşsundur.
LAN IP ile yeniden kur + "Sync addons" yap. Aynı ağ ve firewall iznini kontrol et.

**İlk altyazı çok yavaş geldi:** Normal — FlareSolverr ilk istekte tarayıcıyı başlatır
(20–40 sn). Sonrakiler hızlıdır (çerez önbelleğe alınır).

**Port hatası (`address already in use`):** O port dolu. `PORT=7701 docker compose up -d --build`.

**Altyazılar nereye kaydediliyor?** İndirilen `.srt` dosyaları **bilgisayarındaki eklenti
konteynerinin** içinde önbelleğe alınır (TV'de değil). TV her seferinde bilgisayarından
yayınlar. `docker compose up --build` konteyneri yeniden kurduğunda bu önbellek silinir
(sorun değil, yeniden indirilir).

---

## Ayarlar (`.env`)

| Değişken | Açıklama |
|---|---|
| `PORT` | Eklentinin portu (varsayılan `7000`) |
| `HOST_URL` | (opsiyonel) Sabit dış adres. Boşsa indirme linkleri isteğin adresinden türetilir |
| `SITE_URL` | Kaynak site (varsayılan `https://turkcealtyazi.org`) |
| `FLARESOLVERR_URL` | FlareSolverr adresi (compose ile `http://flaresolverr:8191/v1`) |
| `SEARCH_PATH` | (opsiyonel) Arama yolu; boşsa `/ajax/things_.php` ve `/things_.php` denenir |
| `CLEARANCE_TTL_MS` | (opsiyonel) Çözülen çerezin yeniden kullanım süresi (ms) |

---

## (İleri) Farklı ağdaki arkadaşlarla paylaşmak / HTTPS

LAN yöntemi **aynı Wi-Fi** içindir. İnternet üzerinden (farklı ağdaki bir arkadaş, ya da
Stremio Web/çoğu TV uygulaması) erişim için **HTTPS'li bir public adres** gerekir.
En pratik ücretsiz yollar:

- **Cloudflare Tunnel** — bilgisayarın açıkken sana `https://...` bir adres verir; router
  ayarı/port açma gerektirmez.
- **Ucuz VPS / Oracle Cloud (Always Free)** — bilgisayarın kapalıyken de 7/24 çalışsın istiyorsan.

> Not: turkcealtyazi.org datacenter IP'lerine daha sert davranabilir; **ev IP'n
> (bilgisayarın) bu iş için genelde daha avantajlıdır.** Public yaparsan adresi bilen
> herkesin kullanabileceğini ve isteklerin **senin** üzerinden gittiğini unutma.

---

## Teşekkür / Kaynak

Bu proje [aflextr/turkcealtyaziorg-stremio-addon](https://github.com/aflextr/turkcealtyaziorg-stremio-addon)
projesinin bir fork'udur. Ek olarak [wizdom-stremio-v2](https://github.com/maormagori/wizdom-stremio-v2)
ve anti-bot için [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)'dan yararlanır.
