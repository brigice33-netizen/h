const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const channelCommand = require('../commands/channel');
const slashSchemas = require('../utils/slashCommandSchemas');
const { buildApplicationCommand } = require('../utils/applicationCommands');
const { isTrueOwner } = require('../utils/owner');

test('channel command exposes create and rename actions with cr and cc aliases', () => {
  assert.equal(channelCommand.name, 'channel');
  assert.deepEqual(channelCommand.aliases, ['cr', 'cc']);
  assert.equal(channelCommand.usage, '~channel create <name> | ~cc <name> | ~channel rename <new-name> | ~cr <new-name>');
  assert.deepEqual(slashSchemas.channel[0].choices, ['create', 'rename']);
  assert.equal(buildApplicationCommand({ ...channelCommand }).data.toJSON().name, 'channel');
});

test('channel names are normalized and limited to Discord channel-name length', () => {
  assert.equal(channelCommand.normalizeChannelName('  My New Channel  '), 'my-new-channel');
  assert.equal(channelCommand.normalizeChannelName('---'), null);
  assert.equal(channelCommand.normalizeChannelName('a'.repeat(101)), 'a'.repeat(100));
});

test('channel rename calls setName when both user and bot have Manage Channels', async () => {
  const replies = [];
  const renamed = [];
  const message = {
    guild: { members: { me: { permissions: { has: (permission) => permission === PermissionFlagsBits.ManageChannels } } } },
    member: { permissions: { has: (permission) => permission === PermissionFlagsBits.ManageChannels } },
    author: { id: 'user-id' },
    channel: {
      setName: async (name) => renamed.push(name)
    },
    reply: async (content) => replies.push(content)
  };

  await channelCommand.execute(message, ['rename', 'New', 'Channel']);

  assert.deepEqual(renamed, ['new-channel']);
  assert.match(replies[0], /Channel renamed to `new-channel`/);
});

test('channel rename rejects users without Manage Channels', async () => {
  let renamed = false;
  let reply;
  const message = {
    guild: { members: { me: { permissions: { has: () => true } } } },
    member: { permissions: { has: () => false } },
    channel: { setName: async () => { renamed = true; } },
    reply: async (content) => { reply = content; }
  };

  await channelCommand.execute(message, ['rename', 'new-name']);

  assert.equal(renamed, false);
  assert.match(reply, /Manage Channels/);
});

test('cr alias renames directly without a rename subcommand', async () => {
  const renamed = [];
  const message = {
    commandName: 'cr',
    guild: { members: { me: { permissions: { has: () => true } } } },
    member: { permissions: { has: () => true } },
    channel: { setName: async (name) => renamed.push(name) },
    reply: async () => {}
  };

  await channelCommand.execute(message, ['New', 'Name']);

  assert.deepEqual(renamed, ['new-name']);
});

test('cc alias creates a text channel without requiring the true owner to have a role', async () => {
  const previousTrueOwnerId = process.env.TRUE_OWNER_ID;
  process.env.TRUE_OWNER_ID = 'true-owner-id';
  const created = [];
  const replies = [];
  const message = {
    commandName: 'cc',
    author: { id: 'true-owner-id', tag: 'Owner' },
    guild: {
      members: { me: { permissions: { has: () => true } } },
      channels: { create: async (options) => { created.push(options); return { id: 'new-channel-id' }; } }
    },
    member: { permissions: { has: () => false } },
    channel: {},
    reply: async (content) => replies.push(content)
  };

  try {
    assert.equal(isTrueOwner(message.author.id), true);
    await channelCommand.execute(message, ['My', 'Channel']);
  } finally {
    if (previousTrueOwnerId === undefined) delete process.env.TRUE_OWNER_ID;
    else process.env.TRUE_OWNER_ID = previousTrueOwnerId;
  }

  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'my-channel');
  assert.equal(created[0].type, require('discord.js').ChannelType.GuildText);
  assert.match(replies[0], /Created text channel/);
});