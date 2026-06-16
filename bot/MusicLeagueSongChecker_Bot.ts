import { AttachmentBuilder, Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { checkForNewHeadfiListings, HeadfiListing, removeEndedHeadfiListings, updateHeadfiListingStatuses } from "../commands/utility/headfiScraper.ts";
import { addInitTracksToDB, getTracksByArtistFromDB, getTracksFromDB, populateDBWithSpotifyPlaylistSongs, SpotifyStuff } from "../commands/utility/songCommands.ts";
import { Database } from "../commands/utility/SQLiteDatabase.ts";
import config from "../config.json" with { type: "json" };
import { addWatchTerm, listWatchTerms, removeWatchTerm, deleteAllWatchTerms } from "../commands/utility/discordListingInteractions.ts";
import { checkForNewUSAMListings, removeEndedUSAMListings, updateUSAMListingStatuses } from "../commands/utility/usamScraper.ts";

const spotifyDB = new Database();
spotifyDB.initDB("musicLeague");
const spotifyStuff = new SpotifyStuff();

const audioListingsDB = new Database(); //TODO: change db file name to audioListings.db to reflect the type change
audioListingsDB.initDB("audioListings");

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
            addWatchTerm(interaction.user.id, watchTerm, audioListingsDB.getDB());
            const reply = `Added watch term: ${watchTerm}`;
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
    }

    if (interaction.commandName === "listwatchterms") {
        const watchTerms = listWatchTerms(interaction.user.id, audioListingsDB.getDB());
        await interaction.reply({content: replyTrimmer(watchTerms), flags: MessageFlags.Ephemeral});
    }

    if (interaction.commandName === "removewatchterm") {
        const watchTerm = interaction.options.getString("watchterm");
        if(!watchTerm) {
            const reply = "No watch term submitted."
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
        else {
            const reply = removeWatchTerm(interaction.user.id, watchTerm, audioListingsDB.getDB());
            await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
        }
    }

    if (interaction.commandName === "removeallwatchterms") {
        const reply = deleteAllWatchTerms(interaction.user.id, audioListingsDB.getDB());
        await interaction.reply({content: replyTrimmer(reply), flags: MessageFlags.Ephemeral})
    }

    if (interaction.commandName === "getlog" && interaction.user.id === config.discord_admin_user_id) {
        await interaction.reply({files: ['../../../scripts/nohup.out']})
    }
});

//addNewListings will be running here
let headfiListingsAddedSinceLastCheck = 0;
let usamListingsAddedSinceLastCheck = 0;
setInterval(async () => {
    try {
        const headfiCount: number = await checkForNewHeadfiListings(audioListingsDB.getDB());
        const usamCount: number = await checkForNewUSAMListings(audioListingsDB.getDB());
        headfiListingsAddedSinceLastCheck += headfiCount;
        usamListingsAddedSinceLastCheck += usamCount;
        // audiogonListingsAddedSinceLastCheck += audiogonCount;
        if (headfiListingsAddedSinceLastCheck >= 100) {
            headfiListingsAddedSinceLastCheck = 0;
            await updateHeadfiListingStatuses(audioListingsDB.getDB());
            const removedMessage = removeEndedHeadfiListings(audioListingsDB.getDB());
            client.users.send(config.discord_admin_user_id, removedMessage);
        }
        if (usamListingsAddedSinceLastCheck >= 100) {
            usamListingsAddedSinceLastCheck = 0;
            await updateUSAMListingStatuses(audioListingsDB.getDB());
            const removedMessage = removeEndedUSAMListings(audioListingsDB.getDB());
            client.users.send(config.discord_admin_user_id, removedMessage);
        }
    }
    catch (error) {
        console.error("Error occurred while checking for new listings:", error);
        client.users.send(config.discord_admin_user_id, `Error occurred while checking for new listings: ${error instanceof Error ? error.message : String(error)}`);
    }
}, 5000)

export function notifyUserOfNewListing(url: string, discordUserId: string) {
    client.users.send(discordUserId, `A new listing that matches your watch terms has been added:\n ${url}`);
}

client.login(config.token);