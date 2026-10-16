const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MINE_LOG_CHANNEL_NAME,
  getMineLogConfigKey,
  getMineLogSourceConfigKey,
  isMineLoggingEnabled,
  isOwoMinesMessage,
  getMineBoardText,
  buildMineLogPayload,
  handleMineLogMessage
} = require('../utils/mineLogger');
const { ChannelType } = require('discord.js');
const minesLogCommand = require('../commands/mineslog');

function makeMessage(overrides = {}) {
  return {
    id: 'source-message',
    guild: {},
    author: { bot: true, username: 'OwO' },
    content: '💎 <@123> cashed out! **Mines**: `3`',
    channel: { name: 'games' },
    url: 'https://discord.com/channels/guild/channel/source-message',
    embeds: [],
    ...overrides
  };
}

test('mine logger recognizes Owo Mines messages', () => {
  assert.equal(isOwoMinesMessage(makeMessage()), true);
});

test('mine logger is disabled until explicitly enabled per guild', () => {
  assert.equal(getMineLogConfigKey('guild-123'), 'mineslog:guild-123');
  assert.equal(getMineLogSourceConfigKey('guild-123'), 'mineslog:source:guild-123');
  assert.equal(isMineLoggingEnabled(null), false);
  assert.equal(isMineLoggingEnabled('false'), false);
  assert.equal(isMineLoggingEnabled('true'), true);
  assert.equal(minesLogCommand.name, 'mineslog');
  assert.deepEqual(minesLogCommand.aliases, ['ml']);
});

test('mine logger ignores non-Owo messages and unrelated Owo messages', () => {
  assert.equal(isOwoMinesMessage(makeMessage({ author: { bot: false, username: 'OwO' } })), false);
  assert.equal(isOwoMinesMessage(makeMessage({ author: { bot: true, username: 'OwO' }, content: 'hello' })), false);
  assert.equal(isOwoMinesMessage(makeMessage({ author: { bot: true, username: 'OtherBot' } })), false);
});

test('mine log payload links to the source and suppresses mentions', () => {
  const payload = buildMineLogPayload(makeMessage());

  assert.match(payload.content, /cashed out/);
  assert.match(payload.content, /Source: https:\/\/discord\.com\/channels/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('mine log payload records the three-by-three button board without copying interactive buttons', () => {
  const message = makeMessage({
    components: [
      { components: [1, 2, 3].map((n) => ({ type: 2, emoji: { name: `tile${n}` } })) },
      { components: [4, 5, 6].map((n) => ({ type: 2, emoji: { name: `tile${n}` } })) },
      { components: [7, 8, 9].map((n) => ({ type: 2, emoji: { name: `tile${n}` } })) },
      { components: [{ type: 2, label: 'Cash Out' }] }
    ]
  });
  const payload = buildMineLogPayload(message);

  assert.equal(getMineBoardText(message), 'Board state (top to bottom):\ntile1 | tile2 | tile3\ntile4 | tile5 | tile6\ntile7 | tile8 | tile9');
  assert.match(payload.content, /tile1 \| tile2 \| tile3/);
  assert.equal(payload.components, undefined);
});

test('mine logger does not create a channel or log before the guild enables it', async () => {
  let createCount = 0;
  const message = makeMessage({
    guild: {
      channels: {
        cache: { find: () => null },
        create: async () => {
          createCount += 1;
        }
      }
    }
  });

  assert.equal(await handleMineLogMessage(message, { readConfig: async () => null }), false);
  assert.equal(createCount, 0);
});

test('mine logger ignores games outside the configured source channel', async () => {
  let createCount = 0;
  const message = makeMessage({
    channel: { id: 'wrong-channel', name: 'games' },
    guild: {
      id: 'guild-123',
      channels: {
        cache: { find: () => null },
        create: async () => {
          createCount += 1;
        }
      }
    }
  });
  const readConfig = async (key) => {
    if (key === getMineLogConfigKey('guild-123')) return 'true';
    if (key === getMineLogSourceConfigKey('guild-123')) return 'mines-channel';
    return null;
  };

  assert.equal(await handleMineLogMessage(message, { readConfig }), false);
  assert.equal(createCount, 0);
});

test('mine logger creates the log channel and updates its entry when the source message changes', async () => {
  const channels = new Map();
  const sentPayloads = [];
  const editedPayloads = [];
  let createdChannelCount = 0;
  const guild = {
    channels: {
      cache: {
        find: (predicate) => Array.from(channels.values()).find(predicate)
      },
      create: async ({ name, type }) => {
        createdChannelCount += 1;
        const channel = {
          name,
          type,
          send: async (payload) => {
            sentPayloads.push(payload);
            return {
              edit: async (updatedPayload) => editedPayloads.push(updatedPayload)
            };
          }
        };
        channels.set(name, channel);
        return channel;
      }
    }
  };
  const message = makeMessage({
    id: 'editable-source-message',
    guild,
    components: [
      { components: [1, 2, 3].map((n) => ({ type: 2, emoji: { name: `tile${n}` } })) },
      { components: [4, 5, 6].map((n) => ({ type: 2, emoji: { name: `tile${n}` } })) },
      { components: [7, 8, 9].map((n) => ({ type: 2, emoji: { name: `tile${n}` } })) }
    ]
  });

  const readConfig = async () => 'true';
  const channelId = 'games-channel';
  message.guild.id = 'guild-123';
  message.channel.id = channelId;
  const sourceAwareReadConfig = async (key) => {
    if (key === getMineLogSourceConfigKey('guild-123')) return channelId;
    return readConfig();
  };
  assert.equal(await handleMineLogMessage(message, { readConfig: sourceAwareReadConfig }), true);
  assert.equal(createdChannelCount, 1);
  assert.equal(channels.has(MINE_LOG_CHANNEL_NAME), true);
  assert.equal(sentPayloads.length, 1);

  message.content = '💎 <@123> cashed out! **Mines**: `3` **Winnings**: `45,119`';
  message.components[2].components[1].emoji.name = 'revealed';
  assert.equal(await handleMineLogMessage(message, { readConfig: sourceAwareReadConfig }), true);
  assert.equal(createdChannelCount, 1);
  assert.equal(editedPayloads.length, 1);
  assert.match(editedPayloads[0].content, /45,119/);
  assert.match(editedPayloads[0].content, /tile7 \| revealed \| tile9/);
});
