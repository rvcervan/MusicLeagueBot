import { JSDOM } from "jsdom";
import { DatabaseSync } from 'node:sqlite';
import { notifyUserOfNewListing } from '../../bot/MusicLeagueSongChecker_Bot.ts';
import { checkIfListingMatchesWatchTerms, fetchWithRetry } from "./discordListingInteractions.ts";

const headfiClassifiedUrlBase = "https://www.head-fi.org/classifieds/"; 
const pageBase = "page-"; //probably get the first 10 pages of items. url looks like this "https://www.head-fi.org/classifieds/page-1"
const listingClassName = "hfcUserListing";
const titleClassName = "hfcListingTitle";
const priceClassName = "hfcPrice";
const listingDateClassName = "hfcListingDate";
const listingTitleClassName = "p-title-value head-fi_generic_page_title";

export class HeadfiListing { //Not really needed tbh
    Id: number; // Listing Id
    Name: string; // Listing Name
    Price: string; // Listing Price
    currencySymbol: string; // Listing Price's currency symbol
    Type: string; // Listing type (For Sale, Want To Buy, etc)
    Date: string; // Date Listed
    Status?: string; // Listing Status (Closed, Sold, Traded)

    constructor(listingId: number, listingName: string, listingPrice: string, currencySymbol: string, listingType: string, listingDate: string, listingStatus?: string) {
        this.Id = listingId;
        this.Name = listingName;
        this.Price = listingPrice;
        this.currencySymbol = currencySymbol;
        this.Type = listingType;
        this.Date = listingDate;
        this.Status = listingStatus;
    }

    get listingUrl() {
        return headfiClassifiedUrlBase+this.Id;
    }

    get listingName() {
        return this.Name;
    }
}

export function removeEndedHeadfiListings(db: DatabaseSync): string {
    // Remove all listings that have a listing status of "Closed", "Sold", or "Traded"
    const totalItems: number = Number(db.prepare("SELECT COUNT(*) AS count FROM classifieds").get()?.count ?? 0);
    const deleteEnded = db.prepare("DELETE FROM classifieds WHERE listingStatus IN ('Closed', 'Sold', 'Traded')");
    const result: number = Number(deleteEnded.run().changes);
    return `Removed ${result} ended listings from Head-Fi database. Total items before cleanup: ${totalItems}`;
}

// Run this after every 100th listing added to the db.
export async function updateHeadfiListingStatuses(db: DatabaseSync) {
    // Update listing statuses by iterating through all listing ids in db, fetching their page, and updating the status in the database if it has changed.
    const listingIds = db.prepare("SELECT listingId FROM classifieds").all() as { listingId: number }[];
    for (const { listingId } of listingIds) {
        if (!listingId) continue;
        const response =  await fetchWithRetry(headfiClassifiedUrlBase+listingId);
        
        const htmlText = await response.text()
        const dom = new JSDOM(htmlText);
        const listing = dom.window.document.getElementsByClassName(listingTitleClassName);
        const listingStatus = listing.item(0)?.textContent.replaceAll('\t', '').replaceAll('\n', '').split(":")[0].trim();
        if ((listingStatus?.includes("Closed") && listingStatus.split(" ").length == 1) || (listingStatus?.includes("Sold") && listingStatus.split(" ").length == 1) || (listingStatus?.includes("Traded") && listingStatus.split(" ").length == 1)) {
            console.log(`Updating listing status for ${listingId} to ${listingStatus}`);
            db.prepare("UPDATE classifieds SET listingStatus = ? WHERE listingId = ?").run(listingStatus, listingId);
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

function insertHeadfiListing(l: Element, db: DatabaseSync, returnListinginfo?: boolean): HeadfiListing | undefined {
    const listingId: number = Number(l.getAttributeNode("href")?.textContent.replaceAll('/', '').split(".").at(-1));
    const listingName: string | undefined =  l.getElementsByClassName(titleClassName).item(0)?.textContent.trim();
    const listingPrice: string | undefined = l.getElementsByClassName(priceClassName).item(0)?.textContent.replaceAll("\n", "").trim().split(' ').map(o => o.trim()).at(-1)?.split(' ').at(0);
    const currency: string | undefined = l.getElementsByClassName(priceClassName).item(0)?.textContent.replaceAll("\n", "").trim().split(' ').map(o => o.trim()).at(-1)?.split(' ').at(-1);
    const listingType: string | undefined = l.getElementsByClassName(priceClassName).item(0)?.textContent.replaceAll("\n", "").trim().split(' ').map(o => o.trim()).at(0);
    const listingStatus: string | undefined = l.getElementsByClassName("hfcOverlayGlobal--content").item(0)?.textContent.trim();
    const listedDate: string | undefined = l.getElementsByClassName(listingDateClassName).item(0)?.textContent.replaceAll('\n', '').split(':').at(-1)?.trim();

    if(!listingId || !listingName || !listingPrice || !currency || !listingType || !listedDate) {
        const stuff = [listingId, listingName, listingPrice, currency, listingType, listedDate];
        throw new Error(`One or more of the following fields are null when it shouldn't be: ${
            stuff.map(s => `${Object.keys({s})[0]}: ${s}`).join(", ")
        }`);
    }

    const insertListing = db.
    prepare(`
        INSERT INTO classifieds 
        (listingId, name, price, currency, listingType, listingStatus, listingDate) 
        VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertListing.run(listingId, listingName, listingPrice, currency, listingType, listingStatus ?? null, listedDate);
    if (result.changes === 0) {
        console.log(`Listing with id ${listingId} already exists in the database.`);
        return;
    }

    if(!returnListinginfo) return;

    return new HeadfiListing(listingId, listingName, listingPrice, currency, listingType, listedDate, listingStatus);
}

// Refreshes the new listings page and adds new listings to the listings table. Refresh on a 2min(?) timer
export async function checkForNewHeadfiListings(database: DatabaseSync): Promise<number> {
    const sql = database.createTagStore();

    const response = await fetchWithRetry(headfiClassifiedUrlBase);

    const htmlText = await response!.text();
    const dom = new JSDOM(htmlText);

    let listingsAddedCount: number = 0;
    const listings = dom.window.document.getElementsByClassName(listingClassName);
    for (const l of listings) {
        const listingId: number = Number(l.getAttributeNode("href")?.textContent.replaceAll('/', '').split(".").at(-1));
        const listing = sql.get`SELECT * FROM classifieds WHERE listingId = ${listingId}`;

        // If listing does not exist in database, add it and notify user if it matches any of their watch terms
        if (!listing) {
            const newListingInfo = insertHeadfiListing(l, database, true);
            listingsAddedCount++;
            //check if listing name contains any watch terms for any user, if it does return array of discord user ids that are watching thoes terms, if not return undefined
            //if listing currency is not in USD return undefined
            if (newListingInfo?.currencySymbol.includes("USD") && newListingInfo?.Type.includes("Sale")) {
                const matchedUserIds = checkIfListingMatchesWatchTerms(newListingInfo!.Name, database);
                matchedUserIds?.forEach(id => {
                    notifyUserOfNewListing(newListingInfo!.listingUrl, id);
                });
            }
        }
    }
    return listingsAddedCount;
}