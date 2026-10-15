const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { getCommandDetails, getAdminCommands, isKingflexCommand, isCmdhelpVisibleCommand, getHelpCategory } = require('../utils/helpMenus');
const { getProtectedGuildIds, validateBotSafetyConfig } = require('../utils/safety');
const { isBotCommandAllowedWhileDisabled, isCoinEconomyEnabled, isCoinCommandAllowedWhileDisabled } = require('../utils/commandAccess');
const { isTrueOwner, getTrueOwnerId, getTrustedUserIds, isTrustedUser, hasCommandPermission, authorizeOwnerCommand } = require('../utils/owner');
const banCommand = require('../commands/admin only/ban');
const kickCommand = require('../commands/admin only/kick');
const banallCommand = require('../commands/admin only/banall');
const disableCommand = require('../commands/admin only/disable');
const grantAccessCommand = require('../commands/admin only/grantaccess');
const revokeAccessCommand = require('../commands/admin only/revokeaccess');
const { deleteMessagesInBatches, deleteFilteredMessages, parseAuthorFilter, data: purgeSlashCommand, buildPurgeTranscript, sendResponse, execute: executePurge } = require('../commands/admin only/purge');
const { deleteAllMessages } = require('../commands/admin only/nuke');
const balanceCommand = require('../commands/onepiece fun/coins');
const coinToggleCommand = require('../commands/admin only/coin');
const messageCommand = require('../commands/admin only/message');
const slashSchemas = require('../utils/slashCommandSchemas');

test('getCommandDetails surfaces usage and requirements for a command', () => {
  const details = getCommandDetails({
    name: 'ban',
    description: 'Ban a member',
    usage: '~ban @user',
    ownerOnly: true,
    aliases: ['b']
  }, '~');

  assert.equal(details.name, 'ban');
  assert.equal(details.usage, '~ban @user');
  assert.ok(details.requirements.includes('Owner-only'));
  assert.ok(details.aliases.includes('b'));
});

test('getAdminCommands includes banall', () => {
  const client = {
    commands: new Map([
      ['banall', { name: 'banall', ownerOnly: true }],
      ['ping', { name: 'ping' }]
    ])
  };

  assert.deepEqual(getAdminCommands(client).map((command) => command.name), ['banall']);
});

test('KingFlex excludes standard moderation commands', () => {
  const excluded = ['ban', 'kick', 'mute', 'purge', 'softban', 'timeout', 'setnick', 'warn', 'warnings', 'unmute'];
  for (const name of excluded) {
    assert.equal(isKingflexCommand({ name, ownerOnly: true }), false);
  }
  assert.equal(isKingflexCommand({ name: 'banall', ownerOnly: true }), true);
});

test('cmdhelp hides power and owner-management commands', () => {
  const hidden = ['snapshot', 'serverlist', 'reset', 'restore', 'revokeaccess', 'paste', 'nuke', 'mikuset', 'leaveserver', 'massban', 'lockdown', 'lockchannel', 'grantaccess', 'givecontainers', 'givecoin', 'copy', 'banall', 'backup', 'antinuke', 'adminusage'];
  for (const name of hidden) {
    assert.equal(isCmdhelpVisibleCommand({ name }), false);
  }
  assert.equal(isCmdhelpVisibleCommand({ name: 'ping' }), true);
});

test('mikuset uses the current Discord role color option', () => {
  const mikusetSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'commands', 'admin only', 'mikuset.js'), 'utf8');
  assert.equal(mikusetSource.includes('color:'), false);
  assert.equal(mikusetSource.includes('primaryColor:'), true);
});

test('server management commands use the Server Managing module', () => {
  assert.equal(getHelpCategory({ name: 'role', category: 'Moderation' }), 'Server Managing');
  assert.equal(getHelpCategory({ name: 'lockchannel', category: 'Moderation' }), 'Server Managing');
  assert.equal(getHelpCategory({ name: 'ticket', category: 'General' }), 'Server Managing');
  assert.equal(getHelpCategory({ name: 'ping', category: 'General' }), 'General');
});

test('moderation commands declare their own required permission bits', () => {
  assert.deepEqual(banCommand.requiredPermissions, [PermissionFlagsBits.BanMembers]);
  assert.deepEqual(kickCommand.requiredPermissions, [PermissionFlagsBits.KickMembers]);
  assert.deepEqual(banallCommand.requiredPermissions, [PermissionFlagsBits.BanMembers]);
  assert.deepEqual(grantAccessCommand.requiredPermissions, [PermissionFlagsBits.ManageGuild]);
  assert.deepEqual(revokeAccessCommand.requiredPermissions, [PermissionFlagsBits.ManageGuild]);
});

test('grantaccess all includes every non-restricted command', () => {
  const selection = grantAccessCommand.getRequestedGrantCommands(['all']);

  assert.equal(selection.grantAll, true);
  assert.ok(selection.grantCommands.includes('ping'));
  assert.ok(selection.grantCommands.includes('execute'));
  assert.ok(selection.grantCommands.includes('setprefix'));
  assert.ok(selection.grantCommands.includes('grantaccess'));
  for (const commandName of [
    'lockdown', 'nuke', 'paste', 'reset', 'restore', 'serverlist', 'snapshot', 'leaveserver', 'copy',
    'banall', 'antinuke', 'massban', 'ls', 'resetserver', 'raidguard'
  ]) {
    assert.ok(!selection.grantCommands.includes(commandName), `${commandName} should remain restricted`);
  }

  const explicitSelection = grantAccessCommand.getRequestedGrantCommands(['ping', 'nuke', 'ls']);
  assert.deepEqual(explicitSelection.grantCommands, ['ping']);
  assert.deepEqual(explicitSelection.unsupportedCommands, ['nuke', 'ls']);
});

test('protected guild config and safety validation are enforced', () => {
  assert.deepEqual(getProtectedGuildIds({ PROTECTED_GUILD_ID: '123456789012345678,987654321098765432' }), ['123456789012345678', '987654321098765432']);
  assert.deepEqual(getProtectedGuildIds({ PROTECTED_GUILD_IDS: '1502005946698825789,1510642739476168934' }), ['1502005946698825789', '1510642739476168934']);
  assert.equal(validateBotSafetyConfig({ DISCORD_TOKEN: 'token', OWNER_IDS: '101,202', PROTECTED_GUILD_ID: '123456789012345678' }).ok, true);
  assert.equal(validateBotSafetyConfig({ DISCORD_TOKEN: 'token', OWNER_IDS: '101,202' }).ok, false);
});

test('banall usage requires a reason and confirmation phrase', () => {
  assert.equal(banallCommand.usage, '~banall <guild-id> <reason> confirm');
});

test('raidwho is not registered as a command alias schema', () => {
  const schemas = require('../utils/slashCommandSchemas');
  assert.equal(Object.prototype.hasOwnProperty.call(schemas, 'raidwho'), false);
});

test('coin toggle command exists for admin control', () => {
  const coinCommand = require('../commands/admin only/coin');
  assert.equal(coinCommand.name, 'coin');
  assert.ok(Array.isArray(coinCommand.aliases));
});

test('coin balance and coin toggle do not share the same alias namespace', () => {
  assert.ok(!balanceCommand.aliases.includes('coin'));
  assert.ok(!coinToggleCommand.aliases.includes('coins'));
  assert.ok(!coinToggleCommand.aliases.includes('balance'));
});

test('purge falls back to individual deletions when bulk delete hits the 14-day limit', async () => {
  const messageA = { deletable: true, delete: async () => {} };
  const messageB = { deletable: true, delete: async () => {} };

  const channel = {
    bulkDelete: async () => {
      throw new Error('You can only bulk delete messages that are under 14 days old.');
    },
    messages: {
      fetch: async () => new Map([[1, messageA], [2, messageB]])
    }
  };

  const deleted = await deleteMessagesInBatches(channel, 2);
  assert.equal(deleted.deletedCount, 2);
  assert.deepEqual(deleted.deletedMessages, [messageA, messageB]);
  assert.match(buildPurgeTranscript(deleted.deletedMessages), /No text content/);
});

test('purge author filters accept bot and user selectors', () => {
  assert.equal(parseAuthorFilter('bot'), 'bots');
  assert.equal(parseAuthorFilter('bots'), 'bots');
  assert.equal(parseAuthorFilter('user'), 'users');
  assert.equal(parseAuthorFilter('users'), 'users');
  assert.equal(parseAuthorFilter(undefined), 'all');
  assert.equal(parseAuthorFilter('unknown'), null);
});

test('purge slash command offers all, bot, and user author choices', () => {
  const authorOption = purgeSlashCommand.toJSON().options.find((option) => option.name === 'author');
  assert.deepEqual(authorOption.choices.map((choice) => choice.value), ['all', 'bots', 'users']);
});

test('purge deletes only messages matching the selected author filter', async () => {
  const botMessage = { id: 'bot-message', author: { bot: true } };
  const userMessage = { id: 'user-message', author: { bot: false } };
  let deletedMessages;
  const channel = {
    bulkDelete: async (messages) => {
      deletedMessages = messages;
      return new Map(messages.map((message) => [message.id, message]));
    },
    messages: {
      fetch: async () => new Map([
        [botMessage.id, botMessage],
        [userMessage.id, userMessage]
      ])
    }
  };

  const deleted = await deleteFilteredMessages(channel, 1, 'bots');
  assert.deepEqual(deletedMessages, [botMessage]);
  assert.deepEqual(deleted.deletedMessages, [botMessage]);
  assert.equal(deleted.deletedCount, 1);
});

test('purge sends the result to the channel when its command message was deleted', async () => {
  const sent = [];
  const message = {
    reply: async () => {
      const error = new Error('Unknown message');
      error.code = 10008;
      throw error;
    },
    channel: {
      send: async (payload) => {
        sent.push(payload);
        return payload;
      }
    }
  };

  await sendResponse(message, { content: 'Deleted **26** messages.' });
  assert.deepEqual(sent, [{ content: 'Deleted **26** messages.', ephemeral: undefined, allowedMentions: undefined }]);
});

test('purge sends its success response to the channel if the command message was deleted', async () => {
  const previousTrueOwnerId = process.env.TRUE_OWNER_ID;
  const previousOwnerIds = process.env.OWNER_IDS;
  process.env.TRUE_OWNER_ID = '123456789012345678';
  process.env.OWNER_IDS = '123456789012345678';

  const sent = [];
  const deletedMessage = {
    author: { id: 'author-id', tag: 'TestUser#1234' },
    createdAt: new Date('2026-10-07T12:00:00.000Z'),
    content: 'Deleted message body',
    attachments: new Map()
  };
  const message = {
    author: { id: '123456789012345678' },
    guild: { id: 'guild-id', members: { me: { permissions: { has: () => true } } } },
    channel: {
      bulkDelete: async () => new Map([['message-id', deletedMessage]]),
      send: async (payload) => {
        sent.push(payload);
        return payload;
      }
    },
    reply: async () => {
      const error = new Error('Invalid Form Body: MESSAGE_REFERENCE_UNKNOWN_MESSAGE');
      error.code = 50035;
      throw error;
    }
  };

  try {
    await executePurge(message, ['1']);
  } finally {
    if (previousTrueOwnerId === undefined) delete process.env.TRUE_OWNER_ID;
    else process.env.TRUE_OWNER_ID = previousTrueOwnerId;
    if (previousOwnerIds === undefined) delete process.env.OWNER_IDS;
    else process.env.OWNER_IDS = previousOwnerIds;
  }

  assert.equal(sent.length, 1);
  assert.equal(sent[0].embeds[0].data.title, '🧹 Channel Purged');
  assert.equal(sent[0].files.length, 1);
  assert.match(sent[0].files[0].attachment.toString(), /TestUser#1234/);
  assert.match(sent[0].files[0].attachment.toString(), /Deleted message body/);
});

test('nuke falls back to individual deletions when bulk delete hits the 14-day limit', async () => {
  const messageA = { id: '1', createdTimestamp: Date.now(), deletable: true, delete: async () => {} };
  const messageB = { id: '2', createdTimestamp: Date.now(), deletable: true, delete: async () => {} };

  const collection = {
    size: 2,
    filter: (predicate) => {
      const result = [];
      for (const value of [messageA, messageB]) {
        if (predicate(value)) result.push(value);
      }
      return { size: result.length, values: () => result.values(), last: () => result[result.length - 1] };
    },
    values: () => [messageA, messageB].values(),
    last: () => messageB
  };

  const channel = {
    bulkDelete: async () => {
      throw new Error('You can only bulk delete messages that are under 14 days old.');
    },
    messages: {
      fetch: async () => collection,
      last: () => messageB
    }
  };

  const deleted = await deleteAllMessages(channel);
  assert.equal(deleted, 2);
});

test('command toggle command exists for all command control', () => {
  const commandToggle = require('../commands/admin only/command');
  assert.equal(commandToggle.name, 'command');
  assert.ok(Array.isArray(commandToggle.aliases));
});

test('bot command remains usable while global bot shutdown is active', () => {
  assert.equal(isBotCommandAllowedWhileDisabled({ name: 'bot', aliases: ['botcontrol'] }), true);
  assert.equal(isBotCommandAllowedWhileDisabled({ name: 'ping', aliases: ['p'] }), false);
  assert.equal(isBotCommandAllowedWhileDisabled({ name: 'ban', aliases: ['b'] }), false);
});

test('coin economy is disabled for coin commands while the coin controller stays available', () => {
  assert.equal(isCoinEconomyEnabled('true'), true);
  assert.equal(isCoinEconomyEnabled('false'), false);
  assert.equal(isCoinCommandAllowedWhileDisabled({ name: 'coin', aliases: ['coins', 'coincontrol'] }), true);
  assert.equal(isCoinCommandAllowedWhileDisabled({ name: 'daily', aliases: ['d'] }), false);
  assert.equal(isCoinCommandAllowedWhileDisabled({ name: 'coinflip', aliases: ['cf'] }), false);
  assert.equal(isCoinCommandAllowedWhileDisabled({ name: 'ping', aliases: ['p'] }), true);
});

test('scheduled message parser accepts user content and relative or date-based times', () => {
  assert.ok(slashSchemas.message);

  const relative = messageCommand.parseScheduledMessage(['<@123456789012345678>', 'hello', '10m']);
  assert.ok(relative);
  assert.equal(relative.userId, '123456789012345678');
  assert.equal(relative.content, 'hello');
  assert.ok(relative.sendAtMs > Date.now());

  const absolute = messageCommand.parseScheduledMessage(['<@123456789012345678>', 'hello', 'there', '2026-09-27', '18:00']);
  assert.ok(absolute);
  assert.equal(absolute.content, 'hello there');
  assert.ok(absolute.sendAtMs > Date.now());

  assert.equal(messageCommand.parseScheduledMessage(['<@123456789012345678>', 'hello']), null);
});

test('only the configured true owner can authorize privileged commands', () => {
  process.env.TRUE_OWNER_ID = '1203862285874110486';
  process.env.OWNER_IDS = '1203862285874110486,999999999999999999';
  process.env.TRUSTED_USER_IDS = '1364628748695240847';
  assert.equal(getTrueOwnerId(), '1203862285874110486');
  assert.equal(isTrueOwner('1203862285874110486'), true);
  assert.equal(isTrueOwner('999999999999999999'), false);
  assert.equal(isTrustedUser('1364628748695240847'), true);
  assert.equal(getTrustedUserIds().includes('1364628748695240847'), true);
});

test('true owner bypasses member role permissions for message and slash commands', async () => {
  const previousTrueOwnerId = process.env.TRUE_OWNER_ID;
  const previousOwnerIds = process.env.OWNER_IDS;
  process.env.TRUE_OWNER_ID = '1203862285874110486';
  process.env.OWNER_IDS = '1203862285874110486,1364628748695240847';
  const member = { permissions: { has: () => false } };

  try {
    const message = { author: { id: '1203862285874110486' }, member };
    const otherUser = { author: { id: '1364628748695240847' }, member };
    const slashInteraction = { user: { id: '1203862285874110486' }, guild: { id: 'guild-id' } };

    assert.equal(hasCommandPermission(message, [PermissionFlagsBits.BanMembers]), true);
    assert.equal(hasCommandPermission(otherUser, [PermissionFlagsBits.BanMembers]), false);
    assert.equal(await authorizeOwnerCommand(slashInteraction, { commandName: 'ban' }), true);
  } finally {
    if (previousTrueOwnerId === undefined) delete process.env.TRUE_OWNER_ID;
    else process.env.TRUE_OWNER_ID = previousTrueOwnerId;
    if (previousOwnerIds === undefined) delete process.env.OWNER_IDS;
    else process.env.OWNER_IDS = previousOwnerIds;
  }
});

test('two-item owner list defaults to first owner and second trusted user', () => {
  delete process.env.TRUE_OWNER_ID;
  delete process.env.TRUSTED_USER_IDS;
  delete process.env.TRUSTED_USER_ID;
  process.env.OWNER_IDS = '1203862285874110486,1364628748695240847';

  assert.equal(getTrueOwnerId(), '1203862285874110486');
  assert.equal(isTrueOwner('1203862285874110486'), true);
  assert.equal(isTrueOwner('1364628748695240847'), false);
  assert.equal(isTrustedUser('1364628748695240847'), true);
  assert.deepEqual(getTrustedUserIds(), ['1364628748695240847']);
});

test('disable command accepts slash-prefixed command names', () => {
  const client = {
    commands: new Map([
      ['say', { name: 'say', aliases: ['s'] }],
      ['ping', { name: 'ping', aliases: ['p'] }]
    ])
  };

  assert.equal(disableCommand.getTargetCommand(client, '/say')?.name, 'say');
  assert.equal(disableCommand.getTargetCommand(client, 'say')?.name, 'say');
  assert.equal(disableCommand.getTargetCommand(client, '~ping')?.name, 'ping');
  assert.equal(disableCommand.getTargetCommand(client, 'unknown'), null);
});

test('all configured owners can use grantaccess', async () => {
  process.env.TRUE_OWNER_ID = '1203862285874110486';
  process.env.OWNER_IDS = '1203862285874110486,1364628748695240847';

  const authorized = await authorizeOwnerCommand({
    author: { id: '1364628748695240847' },
    guild: { id: 'guild-id' }
  }, {
    commandName: 'grantaccess',
    requiredPermissions: [PermissionFlagsBits.ManageGuild],
    requireApproval: true,
    allowAllOwners: true
  });

  assert.equal(authorized, true);
});
