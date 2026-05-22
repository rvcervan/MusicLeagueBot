import { REST, Routes, SlashCommandStringOption } from 'discord.js';
import config from "../config.json" with { type: "json" };

const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const USER = 6;
const CHANNEL = 7;
const ROLE = 8;
const MENTIONABLE = 9;
const NUMBER = 10;
const ATTACHMENT = 11;

const commands = [
  {
    name: "songcheck",
    description: "Checks if song title has been previously submitted to MusicLeague",
    options: [
        {
          type: STRING,
          name: "songname",
          description: "The name of the song to search for",
          required: true,
        },
    ],
  },
  {
    name: "artistcheck",
    description: "Checks if artist has been previously submitted to MusicLeague",
    options: [
        {
          type: STRING,
          name: "artistname",
          description: "The name of the artist to search for",
          required: true,
        },
    ],
  },
  {
    name: "addplaylist",
    description: "Populate new submitted songs to search against using a spotify playlist id",
    options: [
        {
          type: STRING,
          name: "playlistid",
          description: "The ID of the Spotify playlist to populate",
          required: true,
        },
    ],
  },
  {
    name: "addwatchterm",
    description: "Add new watch term for user. A DM is sent when a new listing is added that matches the term.",
    options: [
        {
          type: STRING,
          name: "watchterm",
          description: "The term to watch for",
          required: true,
        },
    ],
  },
  {
    name: "listwatchterms",
    description: "List all watch terms for the current user.",
    options: [],
  },
  {
    name: "removewatchterm",
    description: "Remove a watch term for the current user.",
    options: [
        {
          type: STRING,
          name: "watchterm",
          description: "The term to watch for",
          required: true,
        },
    ],
  },
  {
    name: "removeallwatchterms",
    description: "Remove all watch terms for the current user.",
    options: [],
  },
];

const rest = new REST({ version: '10' }).setToken(config.token);

try {
  console.log('Started refreshing application (/) commands.');

  await rest.put(Routes.applicationCommands(config.client_id), { body: commands });

  console.log('Successfully reloaded application (/) commands.');
} catch (error) {
  console.error(error);
}