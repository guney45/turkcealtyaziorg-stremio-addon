const cheerio = require('cheerio');
require("dotenv").config({ path: "./.env" });
const { siteGet } = require("./client");
const { SITE_URL } = require("./flaresolverr");
const { absoluteEpisode } = require("./episodes");
const { ensureSubtitleFolder, listSubtitleFiles, pickSubtitleFile, fileEpisodeInfo, encodeTarget } = require("./packs");

// Arama (autocomplete) endpoint yolu. Sitenin yapısına göre değişebildiği için
// SEARCH_PATH ile elle verilebilir; verilmezse bilinen iki aday sırayla denenir.
const SEARCH_PATHS = process.env.SEARCH_PATH
    ? [process.env.SEARCH_PATH]
    : ["/ajax/things_.php", "/things_.php"];

function parseSearchResults(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (typeof data === "string") {
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (error) {
            const matchedJson = data.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (matchedJson) {
                try {
                    const parsed = JSON.parse(matchedJson[0]);
                    return Array.isArray(parsed) ? parsed : [parsed];
                } catch (parseError) {
                    return [];
                }
            }
        }
    }

    return [];
}

async function mainPageFinder(imdbId) {
    var editedId = imdbId.substring(2);

    for (const searchPath of SEARCH_PATHS) {
        try {
            const url = `${SITE_URL}${searchPath}?t=99&term=${editedId}`;
            const response = await siteGet(url);
            const mainPageData = parseSearchResults(response.data)[0];

            if (response.status === 200 && mainPageData && mainPageData.url) {
                return SITE_URL + mainPageData.url;
            }
        } catch (error) {
            console.log(`mainPageFinder denemesi başarısız (${searchPath}):`, error.message);
        }
    }

    console.log("mainPageFinder: sonuç bulunamadı", imdbId);
    return "";
}

async function subIDfinder(subLink) {
    try {
        const response = await siteGet(subLink);

        $ = cheerio.load(response.data)
        let subIDs = []

        $('form[action$="/ind"] > div').each((i, section) => {
            let idid = $(section).children('input[name="idid"]').attr('value')
            let altid = $(section).children('input[name="altid"]').attr('value')
            let sidid = $(section).children('input[name="sidid"]').attr('value')
            subIDs.push({ idid, altid, sidid })
        }).get()

        return subIDs

    } catch (e) {
        console.log("Sub IDs could not found!", e.message)
        return []
    }
}


function rowMeta(section) {
    return {
        fps: $(section).children('.alfps').text().trim(),
        downloads: Number($(section).children('.alindirme').text().replace(/\D/g, '')) || 0,
        release: $(section).find('.ripdiv').text().replace(/\s+/g, ' ').trim(),
    };
}

async function subtitlePageFinder(imdbId, type, season, episode, baseUrl) {

    try {

        let subtitlesData = [];
        let seriesTarget = null;
        let fallbackData = [];

        //GOES TO THE MAIN PAGE FOR THE MOVIE/SERIES.
        const mainPageURL = await mainPageFinder(imdbId)
        if (typeof(mainPageURL) != "undefined" && mainPageURL.length > 0) {

            const absolute = type === "movie" ? null : await absoluteEpisode(imdbId, season, episode);
            const mainPageHTML = await siteGet(mainPageURL)


            $ = cheerio.load(mainPageHTML.data)

            //SCRAPES SUBTITLE PAGE LINK, SUBTITLE LANGUAGE AND CD NUMBER FOR MOVIES.
            //IT DOESN'T SCRAPE IF CD NUMBER MORE THAN 1.
            //IT DOESN'T SCRAPE IF THE SUBTITLE IS NOT TURKISH.
            if (type === "movie") {
                $('.altyazi-list-wrapper  > div > div').each((i, section) => {
                    let subPageURL = $(section).children('.alisim').children('.fl').children('a').attr('href');
                    let subLang = $(section).children('.aldil').children('span').attr('class')
                    let cd = Number($(section).children('.alcd').text().trim())

                    if (subLang === "flagtr" && subPageURL !== undefined && cd === 1) {

                        subPageURL = SITE_URL + subPageURL
                        subLang = subLang.substring(4)
                        subtitlesData.push({ lang: subLang, pageUrl: subPageURL, ...rowMeta(section) })
                    }
                }).get()


                //DİZİLER: Satır ya sezon+bölüm olarak (göreli) ya da mutlak bölüm
                //numarasıyla eşleşir. Paketler aday olarak alınır; içlerinde bölüm
                //gerçekten var mı aşağıda zip açılarak kontrol edilir.
            } else {
                // Tek bölümlük satırlarda mutlak eşleşme 2. sezondan itibaren anlamlı;
                // 1. sezonda göreli numarayla karışır (site S3 "E 5" != Stremio S1E5).
                const absRows = absolute && absolute !== episode;

                $('.altyazi-list-wrapper  > div > div').each((i, section) => {
                    let subPageURL = $(section).children('.alisim').children('.fl').children('a').attr('href');
                    let subLang = $(section).children('.aldil').children('span').attr('class');
                    let seasonNumber = Number($(section).children('.alcd').children('b').first().text().trim());
                    let episodeText = $(section).children('.alcd').children('b').last().text().trim();

                    if (subLang !== "flagtr" || subPageURL === undefined || !seasonNumber) return;

                    const isPack = /paket/i.test(episodeText);
                    const range = episodeText.split(/[~-]/).map(Number);
                    const inRange = (n) => range.length === 2 ? n >= range[0] && n <= range[1] : n === range[0];

                    let match = false;
                    if (isPack) {
                        match = seasonNumber === season || !!absolute;
                    } else if (seasonNumber === season && inRange(episode)) {
                        match = true;
                    } else if (absRows && seasonNumber !== season && inRange(absolute)) {
                        match = true;
                    }

                    if (match) {
                        subtitlesData.push({ lang: "tr", pageUrl: SITE_URL + subPageURL, season: seasonNumber, isPack, ...rowMeta(section) })
                    }
                }).get()

                seriesTarget = { season, episode, absolute };

                // Başka sezonların paketlerine (indirmesi pahalı) yalnızca aynı
                // sezonda hiçbir şey çıkmazsa bakılır.
                const primary = subtitlesData.filter((d) => !d.isPack || d.season === season);
                const secondary = subtitlesData.filter((d) => d.isPack && d.season !== season);
                subtitlesData = primary;
                fallbackData = secondary;
            }

            //CREATES DOWNLOAD LINK FOR THE POST REQUEST.
            let stremioElements = await buildElements(subtitlesData, seriesTarget, baseUrl);
            if (!stremioElements.length && fallbackData.length) {
                stremioElements = await buildElements(fallbackData, seriesTarget, baseUrl);
            }

            return stremioElements;

        }
        return [];
    } catch (e) {
        console.error("Error happened on subtitlePageFinder", e);
        return [];
    }

}

async function buildElements(subtitlesData, seriesTarget, baseUrl) {
    let stremioElements = []
    const hostBase = baseUrl || process.env.HOST_URL || "";

    for (let i = 0; i < subtitlesData.length; i++) {
        let subIDs = await subIDfinder(subtitlesData[i].pageUrl)
        if (!subIDs || !subIDs.length) continue;
        let idid = subIDs[0].idid;
        let altid = subIDs[0].altid;
        let sidid = subIDs[0].sidid;
        let lang = "tur";
        const { fps, downloads, release, isPack } = subtitlesData[i];

        let target = null;
        let packFile = null;
        if (seriesTarget) {
            target = { ...seriesTarget, packSeason: subtitlesData[i].season, isPack };
            // Paketi indirip (diske önbelleklenir) bölümü içeriyor mu bak.
            if (isPack) {
                try {
                    const dir = await ensureSubtitleFolder(idid, sidid, altid);
                    const file = pickSubtitleFile(listSubtitleFiles(dir), target);
                    if (!file) continue;
                    const info = fileEpisodeInfo(file);
                    packFile = info ? info.episode : "?";
                } catch (e) {
                    console.log(`[scraper] paket ${altid} açılamadı:`, e.message);
                    continue;
                }
            }
        }

        const url = `${hostBase}/download/${idid}-${sidid}-${altid}-${encodeTarget(target)}`;
        stremioElements.push({ url, lang, id: altid, fps, downloads, release, packFile })
    }

    return stremioElements;
}

module.exports = subtitlePageFinder
module.exports.mainPageFinder = mainPageFinder
