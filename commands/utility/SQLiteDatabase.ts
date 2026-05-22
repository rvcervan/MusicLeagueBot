import { existsSync, writeFileSync, mkdirSync } from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

type DbType = "headfi" | "musicLeague";
export class Database{
    database?: DatabaseSync;
    
    initDB(dbType: DbType) {
        if(!this.database) {
            const __dirname = path.dirname(fileURLToPath(import.meta.url));
            const dbDir = path.join(__dirname, '..', '..', 'databases');
            const dbPath = path.join(dbDir, `${dbType}.db`);

            if (!existsSync(dbDir)) {
                mkdirSync(dbDir, { recursive: true });
            }

            if (!existsSync(dbPath)) {
                console.log(`${dbType} database file does not exist, creating...`);
                writeFileSync(dbPath, "");
            }

            this.database = new DatabaseSync(dbPath);
            if(dbType === "headfi") {
                this.#setupHeadfiDB();
            } else if(dbType === "musicLeague") {
                this.#setupMusicLeagueDB();
            }
            console.log(`${dbType} database initialized successfully.`);
        }
    }

    getDB(): DatabaseSync {
        if(!this.database) {
            throw Error("database not initialized");
        }
        return this.database;
    }

    #useDBRequired(): DatabaseSync {
        if(!this.database) {
            throw Error("database not initialized");
        }
        return this.database;
    }

    #setupHeadfiDB() {
        const database = this.#useDBRequired();
        
        /**
         * id: id number of the classifieds listing on headfi
         * name: name of the item listing on headfi
         * price: price of the item separated by '␟' 
         * currency: currency symbol
         * listingType: For Sale, For Sale / Trade, For Trade, Want To Buy, Free To Good Home
         * listingStatus?: Closed, Sold (if null listing assumed to be open)
         * listingDate: Date when initially listed
         */
        database.exec(`
            CREATE TABLE IF NOT EXISTS classifieds(
                listingId INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                price TEXT NOT NULL,
                currency TEXT NOT NULL,
                listingType TEXT NOT NULL,
                listingStatus TEXT,
                listingDate TEXT NOT NULL
            ) STRICT
        `);
        
        /**
         * discordUserId: id number of the classifieds listing on headfi
         * watchStrings: list of strings (seperated by '␟') that a user is currently watching. If new listing that contains a match to any string, notify user of new listing
         */
        database.exec(`
            CREATE TABLE IF NOT EXISTS watchList(
                discordUserId TEXT PRIMARY KEY,
                watchTerms TEXT
            ) STRICT
        `);
    }

    #setupMusicLeagueDB() {
        const database = this.#useDBRequired();
        /**
         * Spotify - id: Spotify id of the track, unique identifier for the track and primary key for the table
         * Track name: name of the track
         * Artist name: name of the artist
         * Album: name of the album the track is from
         * Playlist name: name of the playlist the track is from, multiple playlists containing the same track are seperated by '␟'
         * Playlist ids: list of playlist ids (seperated by '␟')
         * Type: Not sure yet, but type "playlist" seems to be the constant
         * ISRC: ISRC code of the track
         * Count: number of times the track has been submitted to music league
         */
        database.exec(`
            CREATE TABLE IF NOT EXISTS musicLeagueSubmittedSongs(
                spotifyId TEXT PRIMARY KEY,
                trackName TEXT NOT NULL,
                artistName TEXT NOT NULL,
                albumName TEXT,
                playlistName TEXT,
                playlistIds TEXT,
                type TEXT,
                isrc TEXT,
                count INTEGER
            ) STRICT
        `);
    }
}