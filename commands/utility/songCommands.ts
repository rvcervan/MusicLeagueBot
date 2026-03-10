import fs from "fs";
import MLJSON from "../../MusicLeagueJSON/MusicLeagueSubmittedSongs.json" with { type: "json" }

const jsonFilePath = "MusicLeagueSubmittedSongs.json";
const jsonFolderPath = "../MusicLeagueJSON";
const path = `${jsonFolderPath}/${jsonFilePath}`;

/**
 * Checks if song name string exists in json file
 * @returns some song object if exists, else undefined
 * @param songTitle: song title string
 */
export type Header = "Track name" | "Artist name" | "Album" | "Playlist name" | "Type" | "ISRC" | "Spotify - id";
export function trackChecker(trackSearch: string | null, header: Header): string {
    if(!trackSearch) return "No search term submitted.";
    const trackResultString: Set<string> = new Set();
    for (const [key, value] of Object.entries(MLJSON)) {
        const trackValue = value[header].toUpperCase();
        const upperTrackSearch = trackSearch.toUpperCase();
        
        if (trackValue.includes(upperTrackSearch)){
            switch (header) {
                case "Track name":
                    trackResultString.add(
                        `"${value[header]}" by "${value["Artist name"]}" in album "${value["Album"]}".\nFrom playlist: ${value["Playlist name"]}\nhttps://open.spotify.com/track/${value["Spotify - id"]}`
                    );        
                    break;
                case "Artist name":
                    trackResultString.add(
                        `"${value["Track name"]}" by "${value[header]}" in album "${value["Album"]}".\nFrom playlist: ${value["Playlist name"]}\nhttps://open.spotify.com/track/${value["Spotify - id"]}`
                    )
                    break;
            }
        };
    };
        
    if (trackResultString.size == 0) {
        return `No tracks using search term: "${trackSearch}" were found.`;
    }
    else if (trackResultString.size > 10) {
        return `Found ${trackResultString.size} match(es) using term "${trackSearch}" (showing 10):\n\n${Array.from(trackResultString).slice(0, 10).join('\n\n')}`;
    }
    else {
        return `Found ${trackResultString.size} match(es) using term "${trackSearch}":\n\n${Array.from(trackResultString).join('\n\n')}`;
    }
}

/**
 * Reads a csv file and creates and populates a json file with songs
 * @returns some success string
 * @param fileAttachment: some file attachment somehow
 */
export async function populateJsonWithSongs(fileUrl: string): Promise<string> {
    const promise = fetch(fileUrl);
    const contents = await promise;

    const textContents = (await contents.text()); //csv string
    const textArray = textContents.split("\n");

    const musicObj: Record<string, Record<string, string>> = fs.existsSync(path) ? MLJSON : {};
    const headers: string[] = [];
    let spotifyIdHeaderIndex: number = -1;
    const currentEntriesCount = Object.keys(musicObj).length;
    let addedEntriesCount = 0;
    textArray.forEach((line, i) => {
        if(i == 0) {
            const splitLine = line.split(',');
            splitLine.forEach((sl, i) => {
                const header = cleanString(sl);
                if(header.toUpperCase().includes("SPOTIFY")) spotifyIdHeaderIndex = i; //only header that has the word "Spotify" would be "Spotify Id"
                headers.push(header); 
            });
            return;
        }
        
        const obj: Record<string, string> = {};
        headers.forEach((header, i) => {
            const splitLine = line.split(',');
            obj[header] = cleanString(splitLine[i]);
        });

        const spotifyId = cleanString(line.split(',')[spotifyIdHeaderIndex]);
        if(!(spotifyId in musicObj)){
            addedEntriesCount++;
            musicObj[spotifyId] = obj;
        }

    });
    
    fs.writeFileSync(path, JSON.stringify(musicObj), "utf8");
    const newEntriesCount = Object.keys(musicObj).length;
    return `JSON has been populated with ${addedEntriesCount} new track entries:\n${currentEntriesCount} -> ${newEntriesCount}`;
}

function cleanString(str: string): string {
    return str.replaceAll("\"", "").replaceAll("\r", "");
}