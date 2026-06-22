
# TurkceAltyaziOrg-Stremio-Addon

This is an unofficial Stremio Addon for Turkish Subtitles from turkcealtyazi.org.

## Installation

### Remote

You can install it through

```sh {"id":"01HS1K9537SBFVP1Q2C1HM75A7"}
https://turkcealtyaziorg-stremio-addon.mycodelab.com.tr/
```

or

```sh {"id":"01HS1K9537SBFVP1Q2C2XX2N4Q"}
stremio://turkcealtyaziorg-stremio-addon.mycodelab.com.tr/manifest.json
```

### Local

Download and install [Node.js](https://nodejs.org/en/download/) on your computer, then install and launch the addon from Powershell, CMD, or any kind of Terminal:

```sh {"id":"01HS1K9537SBFVP1Q2C4V6HGFQ"}
git clone https://github.com/aflextr/turkcealtyaziorg-stremio-addon.git
cd turkcealtyaziorg-stremio-addon
npm install
npm start
```

Add the addon to stremio from browser:

```sh {"id":"01HS1K9537SBFVP1Q2C5VFA82C"}
stremio://127.0.0.1:7000/manifest.json
```

or from the addon search menu:

```sh {"id":"01HS1K9537SBFVP1Q2C8JTQG7Q"}
http://127.0.0.1:7000/manifest.json
```

## Kendi Sunucunda Çalıştırma (Doğrudan + FlareSolverr)

Eski sürüm, turkcealtyazi.org'a harici bir **proxy** üzerinden bağlanıyordu; o
proxy ya da barındırma kapandığında addon altyazı getiremiyordu. Bu sürüm
proxy'ye gerek bırakmadan **doğrudan** turkcealtyazi.org'a bağlanır ve sitenin
anti-bot korumasını (Cloudflare / Yoncu) [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)
ile aşar.

### Nasıl çalışır

1. FlareSolverr başsız bir tarayıcıyla challenge'ı çözüp `cf_clearance` benzeri
   cookie'leri ve eşleşen User-Agent'ı verir.
2. Addon bu cookie/UA ile normal isteklerini (arama, sayfa, indirme) doğrudan
   siteye yapar. Engellenirse cookie'yi tazeleyip bir kez daha dener.

> **Önemli:** `cf_clearance` cookie'si **çıkış IP'sine** bağlıdır. Bu yüzden
> addon ile FlareSolverr **aynı sunucuda/ağda** çalışmalıdır (aşağıdaki
> docker-compose bunu otomatik sağlar). Farklı IP'lerden çıkarlarsa cookie
> geçersiz olur.

### Docker Compose ile (önerilen)

```sh
docker compose up -d --build
```

Bu komut hem addon'u (`:7000`) hem de FlareSolverr'ı ayağa kaldırır.

**Port 7000 doluysa** `PORT` ile başka bir port seç:

```sh
PORT=7701 docker compose up -d --build
```

Stremio'ya ekle: tarayıcıda `http://127.0.0.1:7701/` aç → Install, veya
`http://127.0.0.1:7701/addon/manifest.json`.

> `docker compose logs/ps/down` gibi komutları sorunsuz çalıştırmak için
> dilersen `PORT` ve `HOST_URL`'i bir kez `.env` dosyasına yaz; compose bu
> dosyayı otomatik okur.

### Ayarlar (.env)

| Değişken | Açıklama |
|---|---|
| `HOST_URL` | (opsiyonel) Addon'un dış adresi. Boşsa indirme linkleri gelen isteğin adresinden türetilir. Sabit domain/reverse-proxy arkasında elle ver. |
| `SITE_URL` | Kaynak site, varsayılan `https://turkcealtyazi.org` |
| `FLARESOLVERR_URL` | FlareSolverr adresi, ör. `http://flaresolverr:8191/v1` |
| `SEARCH_PATH` | (opsiyonel) Arama yolu; boşsa `/ajax/things_.php` ve `/things_.php` denenir |
| `CLEARANCE_TTL_MS` | (opsiyonel) Çözülen cookie'nin yeniden kullanım süresi |

> Sitenin arama endpoint yolu zamanla değişebilir. Altyazı hiç gelmiyorsa önce
> `SEARCH_PATH`'i tarayıcıdan teyit edip elle ayarlayın.

## Contributions

Great thanks to:

* [wizdom-stremio-v2](https://github.com/maormagori/wizdom-stremio-v2)

* [turkcealtyazi-stremio-addon(fork)](https://github.com/gorlev/turkcealtyaziorg-stremio-addon)


