import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { addWatchTerm, checkForNewlistings, deleteAllWatchTerms, HeadfiListing, listWatchTerms, removeWatchTerm } from "../commands/utility/headfiScraper.ts";
import { addInitTracksToDB, getTracksByArtistFromDB, getTracksFromDB, populateDBWithSpotifyPlaylistSongs, SpotifyStuff } from "../commands/utility/songCommands.ts";
import { Database } from "../commands/utility/SQLiteDatabase.ts";
import config from "../config.json" with { type: "json" };

const spotifyDB = new Database();
spotifyDB.initDB("musicLeague");
const spotifyStuff = new SpotifyStuff();

const headfiDB = new Database();
headfiDB.initDB("headfi");

// As of 12:34 pm on 5/22, I have to wait 10 hours because too many requests
addInitTracksToDB(spotifyDB.getDB(), spotifyStuff);

const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
] });

client.on(Events.ClientReady, readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}!`)
});

function replyTrimmer(message: string): string {
    if(message.length > 2000) {
        return message.slice(0, 1997) + "...";
    }
    return message;
}

const eventEmit = client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    console.log(`${interaction.user.displayName} used ${interaction.commandName}!`);

    if (interaction.commandName === "songcheck") {    
        const songname = interaction.options.getString("songname");
        if(!songname) {
            const reply = "No song name submitted."
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
        else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const reply = getTracksFromDB(spotifyDB.getDB(), songname);
            await interaction.editReply({content: replyTrimmer(reply)});
        }
    }

    if (interaction.commandName === "artistcheck") {    
        const artistname = interaction.options.getString("artistname");
        if(!artistname) {
            const reply = "No artist name submitted."
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
        else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const reply = getTracksByArtistFromDB(spotifyDB.getDB(), artistname);
            await interaction.editReply({content: replyTrimmer(reply)});
        }
    }
    
    if (interaction.commandName === "addplaylist") {
        const playlistId = interaction.options.getString("playlistid");
        if(!playlistId) {
            const reply = "No playlist ID submitted."
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
        else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const reply = await populateDBWithSpotifyPlaylistSongs(spotifyDB.getDB(), playlistId, spotifyStuff);
            await interaction.editReply({content: replyTrimmer(reply)});
        }
    }

    if (interaction.commandName === "addwatchterm") {
        const watchTerm = interaction.options.getString("watchterm");
        if(!watchTerm) {
            const reply = "No watch term submitted."
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
        else {
            addWatchTerm(interaction.user.id, watchTerm, headfiDB.getDB());
            const reply = `Added watch term: ${watchTerm}`;
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
    }

    if (interaction.commandName === "listwatchterms") {
        const watchTerms = listWatchTerms(interaction.user.id, headfiDB.getDB());
        await interaction.reply({content: replyTrimmer(watchTerms), flags: MessageFlags.Ephemeral});
    }

    if (interaction.commandName === "removewatchterm") {
        const watchTerm = interaction.options.getString("watchterm");
        if(!watchTerm) {
            const reply = "No watch term submitted."
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
        else {
            const reply = removeWatchTerm(interaction.user.id, watchTerm, headfiDB.getDB());
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
    }

    if (interaction.commandName === "removeallwatchterms") {
        const reply = deleteAllWatchTerms(interaction.user.id, headfiDB.getDB());
        await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
    }
});


//addNewListings will be running here
setInterval(() => {
    checkForNewlistings(headfiDB.getDB());
}, 5000)

export function notifyUserOfNewListing(newListing: HeadfiListing, discordUserId: string) {
    client.users.send(discordUserId, `A new listing that matches your watch terms has been added:\n ${newListing.listingUrl}`);
}

client.login(config.token);