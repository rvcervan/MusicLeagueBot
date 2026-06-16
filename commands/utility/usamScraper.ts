import { JSDOM } from "jsdom";
import { DatabaseSync } from 'node:sqlite';
import { notifyUserOfNewListing } from '../../bot/MusicLeagueSongChecker_Bot.ts';
import { checkIfListingMatchesWatchTerms } from "./discordListingInteractions.ts";

const usamBaseUrl = "https://www.usaudiomart.com/classifieds/all/";
const usamTableClassName = "adverttable table table-bordered table-condensed";

export function removeEndedUSAMListings(db: DatabaseSync): string {
    const totalItems: number = Number(db.prepare("SELECT COUNT(*) AS count FROM usamListings").get()?.count ?? 0);
    const deleteEnded = db.prepare("DELETE FROM usamListings WHERE listingStatus IN ('OFF', 'SOLD')");
    const result: number = Number(deleteEnded.run().changes);
    // console.log(`Removed ${result} ended listings from USAM database. Total items before cleanup: ${totalItems}`);
    return `Removed ${result} ended listings from USAM database. Total items before cleanup: ${totalItems}`;
}

// Run this after every 100th listing added to the db.
export async function updateUSAMListingStatuses(db: DatabaseSync) {
    const listingUrls = db.prepare("SELECT listingUrl FROM usamListings").all() as { listingUrl: string | null }[];
    for (const listingUrl of Object.values(listingUrls).map(l => l.listingUrl)) {
        if (!listingUrl) continue;
        const response = await fetchWithRetry(listingUrl);

        const htmlText = await response.text()
        const dom = new JSDOM(htmlText);
        const listingName = dom.window.document.getElementsByClassName("cftitle");
        const listingStatus = listingName[0].textContent.split("-")[0].trim(); // Gets listing status
        if (listingStatus.includes("OFF") || listingStatus.includes("SOLD")) {
            console.log(`Updating listing status for ${listingUrl} to ${listingStatus}`);
            db.prepare("UPDATE usamListings SET listingStatus = ? WHERE listingUrl = ?").run(listingStatus, listingUrl);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

type USAMListing = {
    listingId: number;
    listingName: string;
    listingUrl: string;
    listingType: string;
    listingStatus: string | null;
}
function insertUSAMListing(l: Element, db: DatabaseSync, returnListinginfo?: boolean): USAMListing | undefined {
    const listingId = l.getElementsByTagName("a").item(0)?.href?.split("details/")[1].split("-")[0]; // Gets listing id
    const listingName = l.getElementsByTagName("a").item(0)?.innerHTML; // Gets listing Name
    const listingUrl = l.getElementsByTagName("a").item(0)?.href; // Gets listing link
    const listingType = l.getElementsByTagName("span").item(1)?.textContent; // Gets listing status, "For Sale" or "Wanted"

    if (!listingId || !listingName || !listingUrl || !listingType) {
        const stuff = [listingId, listingName, listingUrl, listingType];
        throw new Error(`Failed to parse listing info from USAM listing element. Extracted values: ${JSON.stringify(stuff)}`);
    }

    const listingInfo: USAMListing = {
        listingId: Number(listingId),
        listingName,
        listingUrl,
        listingType,
        listingStatus: null
    };

    const insertListing = db.
    prepare("INSERT INTO usamListings (listingId, listingName, listingUrl, listingType, listingStatus) VALUES (?, ?, ?, ?, ?)");
    insertListing.run(listingId, listingName, listingUrl, listingType, null);

    if (returnListinginfo) {
        return listingInfo;
    }
}

// Refreshes the new listings page and adds new listings to the listings table. Refresh on a 2min(?) timer
export async function checkForNewUSAMListings(database: DatabaseSync): Promise<number> {
    const sql = database.createTagStore();

    const response = await fetchWithRetry(usamBaseUrl);
    const htmlText = await response.text()
    const dom = new JSDOM(htmlText);
    const listingElements = dom.window.document.getElementsByClassName(usamTableClassName);
    let listingsAddedCount = 0;
    for (const l of listingElements[0].getElementsByTagName("tbody")[0].getElementsByTagName("tr")) {
        const listingId: number = Number(l.getElementsByTagName("a").item(0)?.href?.split("details/")[1].split("-")[0]);
        const listing = sql.get`SELECT * FROM usamListings WHERE listingId = ${listingId}`;



        if (!listing && l.getElementsByClassName("precontent section-vu clearfix").item(0)?.textContent.trim() == undefined) { // 2nd condition is to filter out the stray table row that isn't a listing.
            const listingInfo: USAMListing | undefined = insertUSAMListing(l, database, true);
            listingsAddedCount++;

            if (listingInfo && listingInfo.listingType.toLowerCase().includes("sale")) {
                const matchingUserIds = checkIfListingMatchesWatchTerms(listingInfo.listingName, database);
                if (matchingUserIds) {
                    for (const discordUserId of matchingUserIds) {
                        notifyUserOfNewListing(listingInfo.listingUrl, discordUserId);
                    }
                }
            }
        }
    }
    return listingsAddedCount;
}

async function fetchWithRetry(url: string, maxRetries: number = 5, baseDelay: number = 3000): Promise<Response> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            let response = await fetch(url, {
                redirect: 'follow',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://www.usaudiomart.com/',
                    'Accept-Encoding': 'gzip, deflate',
                }
            });
            if (!response.ok && response.status !== 403) {
                throw new Error(`Response status: ${response.status}`);
            }
            if (response.status === 403) { //Why does this work?
                response = await fetch(url, {
                redirect: 'follow',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://www.usaudiomart.com/',
                    'Accept-Encoding': 'gzip, deflate',
                    }
                });
            }
            return response;
        } catch (error) {
            if (attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                console.warn(`Fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`Fetch failed after ${maxRetries} attempts:`, error);
                throw error;
            }
        }
    }
    return Promise.reject(new Error('Failed to fetch after maximum retries'));
}