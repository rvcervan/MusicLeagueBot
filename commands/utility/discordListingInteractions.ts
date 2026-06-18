import { DatabaseSync } from "node:sqlite";
export const US = '␟';

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

//TODO: make this universal
export function checkIfListingMatchesWatchTerms(listingName: string, db: DatabaseSync): string[] | undefined {
    const usersWatching = db.prepare("SELECT discordUserId, watchTerms FROM watchList").all();
    if (!usersWatching || usersWatching.length === 0) return;

    const matches: string[] = [];
    const listingNameLower = listingName.toLowerCase();

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

export async function fetchWithRetry(url: string, maxRetries: number = 10, baseDelay: number = 1000): Promise<Response> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Response status: ${response.status} from URL ${url}`);
            }
            return response;
        } catch (error) {
            if (attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                console.warn(`Fetch attempt ${attempt + 1} failed from URL ${url},\nretrying in ${delay}ms...`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`Fetch failed after ${maxRetries} attempts from URL ${url}:`, error);
                throw error;
            }
        }
    }
    return Promise.reject(new Error(`Failed to fetch after maximum retries from URL ${url}`));
}