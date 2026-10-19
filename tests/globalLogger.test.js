const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GLOBAL_LOG_ENABLED_KEY,
  GLOBAL_LOG_GUILD_ID,
  GLOBAL_LOG_CHANNEL_NAME,
  formatDeletedChannelDetails,
  formatDeletedMessageDetails,
  chunkLogLines,
  sendGlobalAuditLog
} = require('../utils/globalLogger');
const { ChannelType } = require('discord.js');

test('deleted channel details identify voice channels and their IDs', () => {
  const details = formatDeletedChannelDetails({
    type: ChannelType.GuildVoice,
    name: 'Team Voice',
    id: 'voice-channel',
    parent: { name: 'Games' }
  });

  assert.match(details, /Voice channel: Team Voice/);
  assert.match(details, /voice-channel/);
  assert.match(details, /Category: Games/);
});

test('deleted message details include source channel, author, content, embeds, and attachments', () => {
  const details = formatDeletedMessageDetails({
    author: { tag: 'Member#1234' },
    channel: { type: ChannelType.GuildVoice, name: 'Team Voice', id: 'voice-channel' },
    content: 'deleted text',
    embeds: [{ title: 'Deleted embed', description: 'Embed body', fields: [] }],
    attachments: new Map([['file', { url: 'https://example.test/image.png' }]])
  });

  assert.match(details, /Author: Member#1234/);
  assert.match(details, /Voice channel: #Team Voice/);
  assert.match(details, /deleted text/);
  assert.match(details, /Deleted embed/);
  assert.match(details, /https:\/\/example\.test\/image\.png/);
});

test('bulk deleted-message details are chunked without dropping long entries', () => {
  const lines = ['first deleted message', 'x'.repeat(8000), 'last deleted message'];
  const chunks = chunkLogLines(lines, 1000);

  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
  assert.equal(chunks.join('').includes('first deleted message'), true);
  assert.equal(chunks.join('').includes('last deleted message'), true);
  assert.equal(chunks.map((chunk) => chunk.length).reduce((sum, length) => sum + length, 0) >= 8000, true);
});

test('global audit logger does not deliver logs when disabled', async () => {
  let resolveChannelCount = 0;
  const sentPayloads = [];
  const result = await sendGlobalAuditLog(
    {},
    { id: 'source-guild', name: 'Source Server' },
    'Message deleted',
    'Deleted message',
    '#ED4245',
    {
      readConfig: async (key) => {
        assert.equal(key, GLOBAL_LOG_ENABLED_KEY);
        return 'false';
      },
      resolveChannel: async () => {
        resolveChannelCount += 1;
        return { send: async (payload) => sentPayloads.push(payload) };
      }
    }
  );

  assert.equal(result, false);
  assert.equal(resolveChannelCount, 0);
  assert.equal(sentPayloads.length, 0);
});

test('global audit entries include the originating server and are sent to the configured global channel', async () => {
  let sentPayload;
  const result = await sendGlobalAuditLog(
    {},
    { id: 'source-guild', name: 'Source Server' },
    'Message deleted',
    'Deleted message',
    '#ED4245',
    {
      readConfig: async () => 'true',
      resolveChannel: async () => {
        assert.equal(GLOBAL_LOG_GUILD_ID, '1544646139163185243');
        assert.equal(GLOBAL_LOG_CHANNEL_NAME, 'global-logs');
        return { send: async (payload) => { sentPayload = payload; } };
      }
    }
  );

  assert.equal(result, true);
  assert.equal(sentPayload.embeds[0].data.fields[0].name, 'Origin Server');
  assert.match(sentPayload.embeds[0].data.fields[0].value, /Source Server/);
  assert.match(sentPayload.embeds[0].data.fields[0].value, /source-guild/);
});
