const cheerio = require('cheerio');
require("dotenv").config({ path: "./.env" });
const { siteGet } = require("./client");
const { SITE_URL } = require("./flaresolverr");

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


async function subtitlePageFinder(imdbId, type, season, episode) {

    try {

        let subtitlesData = [];

        //GOES TO THE MAIN PAGE FOR THE MOVIE/SERIES.
        const mainPageURL = await mainPageFinder(imdbId)
        if (typeof(mainPageURL) != "undefined" && mainPageURL.length > 0) {

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
                        subtitlesData.push({ lang: subLang, pageUrl: subPageURL })
                    }
                }).get()


                //SCRAPES SUBTITLE PAGE URL, SUBTITLE LANGUAGE, SEASON AND EPISODE NUMBER. IT LISTS ALSO SUBTITLE PACKS IF THE SEASON NUMBER MATCHS.
            } else {
                $('.altyazi-list-wrapper  > div > div').each((i, section) => {
                    let subPageURL = $(section).children('.alisim').children('.fl').children('a').attr('href');
                    let subLang = $(section).children('.aldil').children('span').attr('class');
                    let seasonNumber = $(section).children('.alcd').children('b').first().text().trim();
                    let episodeNumber = $(section).children('.alcd').children('b').last().text().trim();

                    if (seasonNumber.indexOf("0") === 0) {
                        seasonNumber = seasonNumber.substring(1)
                    }

                    if (episodeNumber.indexOf("0") === 0) {
                        episodeNumber = (episodeNumber.substring(1))
                    }

                    seasonNumber = Number(seasonNumber);

                    if (episodeNumber === "Paket" || episodeNumber === "paket") {
                        episodeNumber = "Paket";
                    } else if (episode <= Number(episodeNumber.split("~")[1]) && episode >= Number(episodeNumber.split("~")[0])) {
                        episodeNumber = episode;
                    } else if (episode <= Number(episodeNumber.split("-")[1]) && episode >= Number(episodeNumber.split("-")[0])) {
                        episodeNumber = episode;
                    } else {
                        episodeNumber = Number(episodeNumber);
                    }

                    if (subLang === "flagtr" && subPageURL !== undefined && season === seasonNumber) {

                        if (episode === episodeNumber || episodeNumber === "Paket") {
                            subPageURL = SITE_URL + subPageURL
                            subLang = subLang.substring(4)
                            subtitlesData.push({ lang: subLang, pageUrl: subPageURL, season: seasonNumber, episode: episodeNumber })
                        }
                    }
                }).get()
            }

            //CREATES DOWNLOAD LINK FOR THE POST REQUEST.
            let stremioElements = []

            for (let i = 0; i < subtitlesData.length; i++) {
                let subIDs = await subIDfinder(subtitlesData[i].pageUrl)
                if (!subIDs || !subIDs.length) continue;
                let idid = subIDs[0].idid;
                let altid = subIDs[0].altid;
                let sidid = subIDs[0].sidid;
                let lang = "tur";


                //CHECK MOVİE OR SERİES
                if (isNaN(episode)) episode = "movie-0";


                var url = `${process.env.HOST_URL}/download/${idid}-${sidid}-${altid}-${episode}`;


                stremioElements.push({ url, lang, id: altid, episode })
            }

            return stremioElements;

        }
    } catch (e) {
        console.error("Error happened on subtitlePageFinder", e);
    }

}

module.exports = subtitlePageFinder
