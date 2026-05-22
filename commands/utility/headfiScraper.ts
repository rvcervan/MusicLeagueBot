import { JSDOM } from "jsdom";
import { DatabaseSync } from 'node:sqlite';
import { notifyUserOfNewListing } from '../../bot/MusicLeagueSongChecker_Bot.ts';

const US = '␟';
const headfiClassifiedUrlBase = "https://www.head-fi.org/classifieds/"; 
const pageBase = "page-"; //probably get the first 10 pages of items. url looks like this "https://www.head-fi.org/classifieds/page-1"
const listingClassName = "hfcUserListing";
const titleClassName = "hfcListingTitle";
const priceClassName = "hfcPrice";
const listingDateClassName = "hfcListingDate";

export class HeadfiListing {
    Id: number; // Listing Id
    Name: string; // Listing Name
    Price: string; // Listing Price
    currencySymbol: string; // Listing Price's currency symbol
    Type: string; // Listing type (For Sale, Want To Buy, etc)
    Date: string; // Date Listed
    Status?: string; // Listing Status (Closed, Sold)

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


function insertListing(l: Element, db: DatabaseSync, returnListinginfo?: boolean): HeadfiListing | undefined {
    const listingId: number = Number(l.getAttributeNode("href")?.textContent.replaceAll('/', '').split(".").at(-1));
    const listingName: string | undefined =  l.getElementsByClassName(titleClassName).item(0)?.textContent.trim();
    const listingPrice: string | undefined = l.getElementsByClassName(priceClassName).item(0)?.textContent.replaceAll("\n", "").trim().split(' ').map(o => o.trim()).at(-1)?.split(' ').at(0);
    const currency: string | undefined = l.getElementsByClassName(priceClassName).item(0)?.textContent.replaceAll("\n", "").trim().split(' ').map(o => o.trim()).at(-1)?.split(' ').at(-1);
    const listingType: string | undefined = l.getElementsByClassName(priceClassName).item(0)?.textContent.replaceAll("\n", "").trim().split(' ').map(o => o.trim()).at(0);
    const listingStatus: string | undefined = l.getElementsByClassName("hfcOverlayGlobal--content").item(0)?.textContent.trim();
    const listedDate: string | undefined = l.getElementsByClassName(listingDateClassName).item(0)?.textContent.replaceAll('\n', '').split(':').at(-1)?.trim();

    if(!listingId || !listingName || !listingPrice || !currency || !listingType || !listedDate) {
        const stuff = [listingId, listingName, listingPrice, currency, listingType, listedDate];
        throw Error(`One or more of the following fields are null when it shouldn't be: ${
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
    console.log(`Attempted to insert listing ${listingName}. Changes: ${result.changes}`);
    if (result.changes === 0) {
        console.log(`Listing with id ${listingId} already exists in the database.`);
        return;
    }

    if(!returnListinginfo) return;

    return new HeadfiListing(listingId, listingName, listingPrice, currency, listingType, listedDate, listingStatus);
}

//The reason we scrape listings is because we want cross reference with new listings posted on the site.
//Do we need this?
async function scrapeHeadfiListings(db: DatabaseSync) {
    const numOfPagesToIterate = 10;
    for(const i of Array.from(Array(numOfPagesToIterate).keys()).map(i => i+1)) {
        const url = headfiClassifiedUrlBase+pageBase+i;
        
        const response =  await fetch(url);
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`)
        }
    
        const htmlText = await response.text();
        const dom = new JSDOM(htmlText);
    
        const listings = dom.window.document.getElementsByClassName(listingClassName);
    
        for(const l of listings) {
            insertListing(l, db);
        }
    }
}

// Refreshes the new listings page and adds new listings to the listings table. Refresh on a 2min(?) timer
export async function checkForNewlistings(database: DatabaseSync) {
    const sql = database.createTagStore();

    const response =  await fetch(headfiClassifiedUrlBase);
    if (!response.ok) {
        throw new Error(`Response status: ${response.status}`)
    }

    const htmlText = await response.text();
    const dom = new JSDOM(htmlText);

    const listings = dom.window.document.getElementsByClassName(listingClassName);
    for (const l of listings) {
        const listingId: number = Number(l.getAttributeNode("href")?.textContent.replaceAll('/', '').split(".").at(-1));
        const listing = sql.get`SELECT * FROM classifieds WHERE listingId = ${listingId}`;

        // If listing does not exist in database, add it and notify user if it matches any of their watch terms
        if (!listing) {
            const newListingInfo = insertListing(l, database, true);
            const matchedUserIds = checkIfListingMatchesWatchTerms(newListingInfo!, database);
            matchedUserIds?.forEach(id => {
                notifyUserOfNewListing(newListingInfo!, id);
            });
        }
    }
}

// Adds discord user to table "watchList" if not already added with the watch term they are watching for. If already added, append the term to the watchTerms string using seperator
export function addWatchTerm(discordUserId: string, watchTerm: string, database: DatabaseSync) {

    //check if user already exists in table, if not add them with watch term, if they do exist append watch term to existing watch terms
    const userExists = database.prepare("SELECT * FROM watchList WHERE discordUserId = ?").get(discordUserId);
    if (!userExists) {
        database.prepare("INSERT INTO watchList (discordUserId, watchTerms) VALUES (?, ?)").run(discordUserId, watchTerm);
    } else {
        const existingWatchTerms = userExists.watchTerms;
        if (!existingWatchTerms) return "Existing user has null watch terms, this should not be possible";
        const updatedWatchTerms = existingWatchTerms + US + watchTerm;
        database.prepare("UPDATE watchList SET watchTerms = ? WHERE discordUserId = ?").run(updatedWatchTerms, discordUserId);
    }
}

// Lists watch terms discord users have
export function listWatchTerms(discordUserId: string, database: DatabaseSync): string {
    //check if user exists in table, if not return empty array, if they do return array of watch terms by splitting watchTerms string using seperator
    const userExists = database.prepare("SELECT * FROM watchList WHERE discordUserId = ?").get(discordUserId);
    if (!userExists) {
        return "User does not have any watch terms.";
    }
    const existingWatchTerms = userExists.watchTerms;
    if (!existingWatchTerms || typeof existingWatchTerms !== "string") return "Existing user has null or non-string watch terms, this should not be possible";
    return existingWatchTerms.split(US).join(", ");
}

// Deletes a specified watch term, maybe this can be used after listWatchTerms()
export function removeWatchTerm(discorduserId: string, watchTerm: string, database: DatabaseSync) {
    //check if user exists in table, if not return "User does not have any watch terms.", if they do check if they have the watch term they want to remove, if they do remove it from their watch terms and update table, if they don't return "User is not watching that term".
    const userExists = database.prepare("SELECT * FROM watchList WHERE discordUserId = ?").get(discorduserId);
    if (!userExists) {
        return "User does not have any watch terms.";
    }
    const existingWatchTerms = userExists.watchTerms;
    if (!existingWatchTerms || typeof existingWatchTerms !== "string") return "Existing user has null or non-string watch terms, this should not be possible";
    const watchTermsArray = existingWatchTerms.split(US);
    if (!watchTermsArray.includes(watchTerm)) {
        return "User is not watching that term.";
    }
    const updatedWatchTerms = existingWatchTerms.split(US).filter((t: string) => t !== watchTerm).join(US);
    database.prepare("UPDATE watchList SET watchTerms = ? WHERE discordUserId = ?").run(updatedWatchTerms, discorduserId);
    return "Watch term removed successfully.";
}

// Deletes all watch terms by removing discord user from table
export function deleteAllWatchTerms(discordUserId: string, database: DatabaseSync) {
    //remove user from table
    const userExists = database.prepare("SELECT * FROM watchList WHERE discordUserId = ?").get(discordUserId);
    if (!userExists) {
        return "User does not have any watch terms.";
    }
    database.prepare("DELETE FROM watchList WHERE discordUserId = ?").run(discordUserId);
    return "All watch terms deleted successfully.";
}

export function checkIfListingMatchesWatchTerms(listing: HeadfiListing, db: DatabaseSync): string[] | undefined {
    //check if listing name contains any watch terms for any user, if it does return array of discord user ids that are watching thoes terms, if not return undefined
    const usersWatching = db.prepare("SELECT discordUserId, watchTerms FROM watchList").all();
    if (!usersWatching || usersWatching.length === 0) return;

    const matches: string[] = [];
    const listingNameLower = listing.Name.toLowerCase();

    for (const u of usersWatching) {
        if (!u.watchTerms || typeof u.watchTerms !== 'string') continue;
        const terms = u.watchTerms.split(US).map((t: string) => t.trim()).filter((t: string) => t.length > 0);
        for (const term of terms) {
            if (listingNameLower.includes(term.toLowerCase())) {
                matches.push(String(u.discordUserId));
                break;
            }
        }
    }

    return matches.length ? matches : undefined;
}