import { DatabaseSync } from "node:sqlite";
import config from "../../config.json" with { type: "json" };
import { initSongs } from '../../MusicLeagueJSON/initSongs.ts';

const errorStatuses = Array.from({ length: 100 }, (_, i) => 400 + i);

export class SpotifyStuff {
    //It seems like the default length of the access token is 1 hour, 
    //so we can just request a new one every time we need to make a spotify api call and it should be fine.
    accessToken?: string;

    async getOrRefreshAccessToken() {
        if (!this.accessToken) {
            const response = await fetch("https://accounts.spotify.com/api/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: `grant_type=client_credentials&client_id=${config.spotify_client_id}&client_secret=${config.spotify_client_secret}`,
            });

            if (errorStatuses.includes(response.status)) {
                const errorText = await response.text().catch(() => response.statusText);
                console.error("Failed to retrieve access token:", response.status, response.statusText, errorText);
                return;
            }

            const data = await response.json();
            this.accessToken = data.access_token;
            console.log("new access token:", this.accessToken);
        }
        else {
            // refresh token
            const response = await fetch("https://accounts.spotify.com/api/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    grant_type: "refresh_token",
                    refresh_token: this.accessToken,
                    client_id: config.spotify_client_id
                }),
            });

            if (errorStatuses.includes(response.status)) {
                const errorText = await response.text().catch(() => response.statusText);
                console.error("Failed to refresh access token:", response.status, response.statusText, errorText);
                return;
            }

            const data = await response.json();
            this.accessToken = data.refresh_token ?? this.accessToken;
            console.log("refreshed access token:", this.accessToken);
        }
    }

    async getAccessToken(): Promise<string | undefined> {
        await this.getOrRefreshAccessToken();
        return this.accessToken;
    }
}

export async function populateDBWithSpotifyPlaylistSongs(db: DatabaseSync, playlistId: string, spotifyStuff: SpotifyStuff): Promise<string> {
    if (db.prepare("SELECT playlistIds FROM musicLeagueSubmittedSongs WHERE playlistIds LIKE ?").get(`%${playlistId}%`)) {
        return "Playlist already exists in the database.";
    }

    const accessToken = await spotifyStuff.getAccessToken();
    const spotifyURL = `https://api.spotify.com/v1/playlists/${playlistId}`;

    const response = await fetch(spotifyURL, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
        },
    });

    if (errorStatuses.includes(response.status)) {
        return `Spotify API error: ${response.status} ${response.statusText}`;
    }
    
    const data = await response.json();
    const playlistName = data.name;

    //playlist owner must be from MusicLeague owner.
    if (data.owner.display_name !== "Music League") {
        return "Playlist owner must be Music League.";
    }

    const tracks = data.tracks.items; //array of songs in the playlist

    let newCount = 0;
    let duplicateCount = 0;
    let body = "";
    //Maybe make a type for this later
    tracks.forEach((item: any) => {
        const track = item.track;
        const trackName = track.name;
        const artistName = track.artists[0].name; //only takes the first artist for now I guess.
        const albumName = track.album.name;
        const isrc = track.external_ids.isrc;
        const spotifyId = track.id;
        const type = "playlist";

        if (db.prepare("SELECT spotifyId FROM musicLeagueSubmittedSongs WHERE spotifyId = ?").get(spotifyId)) {
            const existingPlaylistIds = db.prepare("SELECT playlistIds FROM musicLeagueSubmittedSongs WHERE spotifyId = ?").get(spotifyId)?.playlistIds;
            const existingPlaylistNames = db.prepare("SELECT playlistName FROM musicLeagueSubmittedSongs WHERE spotifyId = ?").get(spotifyId)?.playlistName;
            const newPlaylistIds = existingPlaylistIds?.toString().includes(playlistId) ? existingPlaylistIds : existingPlaylistIds + "␟" + playlistId;
            const newPlaylistNames = existingPlaylistNames?.toString().includes(playlistName) ? existingPlaylistNames : existingPlaylistNames + "␟" + playlistName;
            db.prepare("UPDATE musicLeagueSubmittedSongs SET playlistIds = ?, playlistName = ?, count = count + 1 WHERE spotifyId = ?").run(newPlaylistIds, newPlaylistNames, spotifyId);
            const count = db.prepare("SELECT count FROM musicLeagueSubmittedSongs WHERE spotifyId = ?").get(spotifyId)?.count || 0;
            body += `"${trackName}" by "${artistName}" - Duplicate. Count: ${count}\n`;
            duplicateCount++;
            return;
        }

        db.prepare(`
            INSERT INTO musicLeagueSubmittedSongs (spotifyId, trackName, artistName, albumName, playlistName, playlistIds, type, isrc, count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(spotifyId, trackName, artistName, albumName, playlistName, playlistId, type, isrc);
        body += `"${trackName}" by "${artistName}" - New.\n`;
        newCount++;
    });

    return `Adding ${newCount+duplicateCount} songs from playlist "${playlistName}".\n${newCount} new, ${duplicateCount} duplicate.\n\n${body}`;
}

export function getTracksFromDB(db: DatabaseSync, trackName: string) {
    const rows = db.prepare("SELECT trackName, artistName, albumName, playlistName FROM musicLeagueSubmittedSongs WHERE trackName LIKE ?").all(`%${trackName}%`);
    if (rows.length === 0) {
        return "No tracks found with that name.";
    }
    let reply = `Tracks with name similar to "${trackName}":\n`;
    rows.forEach((row: any) => {
        reply += `Track name: ${row.trackName}\nArtist name: ${row.artistName}\nAlbum name: ${row.albumName}\nPlaylist name(s): ${row.playlistName.split("␟").join(", ")}\nTimes submitted: ${row.count}\n\n`;
    });
    return reply;
}

export function getTracksByArtistFromDB(db: DatabaseSync, artistName: string) {
    const rows = db.prepare("SELECT trackName, artistName, albumName, playlistName FROM musicLeagueSubmittedSongs WHERE artistName LIKE ?").all(`%${artistName}%`);
    if (rows.length === 0) {
        return "No tracks found with that artist name.";
    }
    let reply = `Tracks by artist "${artistName}":\n\n`;
    rows.forEach((row: any) => {
        reply += `Artist name: ${row.artistName}\nTrack name: ${row.trackName}\nAlbum name: ${row.albumName}\nPlaylist name(s): ${row.playlistName.split("␟").join(", ")}\nTimes submitted: ${row.count}\n\n`;
    });
    return reply;
}

async function addTrackToDB(db: DatabaseSync, playlistName: string, trackChunk: string[], spotifyStuff: SpotifyStuff) {
    //If trackChunk length is greater than 50, split it into smaller chunks
    if (trackChunk.length > 50) {
        for (let i = 0; i < trackChunk.length; i += 50) {
            const chunk = trackChunk.slice(i, i + 50);
            await addTrackToDB(db, playlistName, chunk, spotifyStuff);
        }
        return;
    }

    const accessToken = await spotifyStuff.getAccessToken();
    const spotifyURL = `https://api.spotify.com/v1/tracks?ids=${trackChunk.join(",")}`;
    const response = await fetch(spotifyURL, {
        headers: {
            "Authorization": `Bearer ${accessToken}`
        }
    });

    if (errorStatuses.includes(response.status)) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Spotify API error: ${response.status} ${response.statusText}: ${errorText}\n\n${spotifyURL}`);
    }

    const tracks = await response.json();
    const trackList = tracks.tracks;

    for (const track of trackList) {
        if (db.prepare("SELECT spotifyId FROM musicLeagueSubmittedSongs WHERE spotifyId = ?").get(track.id)) {
            const existingPlaylistIds = db.prepare("SELECT playlistIds FROM musicLeagueSubmittedSongs WHERE spotifyId = ?").get(track.id)?.playlistIds;
            const existingPlaylistNames = db.prepare("SELECT playlistName FROM musicLeagueSubmittedSongs WHERE spotifyId = ?").get(track.id)?.playlistName;
            const newPlaylistIds = existingPlaylistIds?.toString().includes("initTracks") ? existingPlaylistIds : existingPlaylistIds + "␟" + "initTracks";
            const newPlaylistNames = existingPlaylistNames?.toString().includes(playlistName) ? existingPlaylistNames : existingPlaylistNames + "␟" + playlistName;
            db.prepare("UPDATE musicLeagueSubmittedSongs SET playlistIds = ?, playlistName = ?, count = count + 1 WHERE spotifyId = ?").run(newPlaylistIds, newPlaylistNames, track.id);
        } else {
            db.prepare(`
                INSERT INTO musicLeagueSubmittedSongs (spotifyId, trackName, artistName, albumName, playlistName, playlistIds, type, isrc, count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            `).run(track.id, track.name, track.artists[0].name, track.album.name, playlistName, "initTracks", "track", track.external_ids.isrc);
        }
    }
}

type PlaylistName = string;
type trackId = string;
type PlaylistTrackChunks = Record<PlaylistName, trackId[]>;

export async function addInitTracksToDB(db: DatabaseSync, spotifyStuff: SpotifyStuff) {
    // Should only run once and only during the beginning of the db file lifetime.
    // Assuming the database of songs are empty to begin with
    const firstTrack = initSongs[0];
    if (db.prepare("SELECT spotifyId FROM musicLeagueSubmittedSongs WHERE spotifyId = ?").get(firstTrack.spotifyId)) return;
    console.log("Adding initialized tracks to the database.");
    
    //construct a 2d array from initsongs where each inner array contains 50 items
    const initSongChunks: PlaylistTrackChunks = {};
    for(const track of initSongs) {
        const playlistName = track.playlistName;
        if (!initSongChunks[playlistName]) {
            initSongChunks[playlistName] = [];
        }
        initSongChunks[playlistName].push(track.spotifyId);
    }

    for(const [playlistname, trackIds] of Object.entries(initSongChunks)) {
        console.log("10 seconds delay");
        await new Promise(resolve => setTimeout(resolve, 10000));
        await addTrackToDB(db, playlistname, trackIds, spotifyStuff);
    }
    console.log("Initialized tracks added to the database.");
}