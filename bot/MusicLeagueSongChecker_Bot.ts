import { Client, Events, GatewayIntentBits, Message, MessageFlags } from "discord.js";
import config from "../config.json" with { type: "json" }
import { populateJsonWithSongs, trackChecker } from "../commands/utility/songCommands.ts";

const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
] });

client.on(Events.ClientReady, readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}!`)
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    console.log(`${interaction.user.displayName} used ${interaction.commandName}!`)

    if (interaction.commandName === "songcheck") {    
        const songname = interaction.options.getString("songname");
        await interaction.reply({content: trackChecker(songname, "Track name"), flags: MessageFlags.Ephemeral});
    }

    if (interaction.commandName === "artistcheck") {    
        const artistname = interaction.options.getString("artistname");
        await interaction.reply({content: trackChecker(artistname, "Artist name"), flags: MessageFlags.Ephemeral});
    }
    
    if (interaction.commandName === "uploadcsv") {    
        const csv = interaction.options.getAttachment("csv");
        if(!csv) {
            const reply = "No csv file submitted."
            await interaction.reply({content: reply, flags: MessageFlags.Ephemeral})
            console.error("No csv file submitted", csv);
        }
        else if(csv.name.split('.').at(-1) != "csv") {
            const reply = "File needs to be a csv."
            await interaction.reply({content: reply, flags: MessageFlags.Ephemeral})
            console.error("File needs to be a csv", csv);
        }
        else{
            const reply = await populateJsonWithSongs(csv.url)
            await interaction.reply(reply);
        }
    }
});

client.login(config.token);