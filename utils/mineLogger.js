const { ChannelType } = require('discord.js');
const { getConfig } = require('../database');

const MINE_LOG_CHANNEL_NAME = 'mine-logs';
const MINE_LOG_CONFIG_PREFIX = 'mineslog:';
const MINE_LOG_SOURCE_CONFIG_PREFIX = 'mineslog:source:';
const loggedMessages = new Map();
const MAX_CACHED_LOG_MESSAGES = 500;

function getMineLogConfigKey(guildId) {
  return `${MINE_LOG_CONFIG_PREFIX}${guildId}`;
}

function getMineLogSourceConfigKey(guildId) {
  return `${MINE_LOG_SOURCE_CONFIG_PREFIX}${guildId}`;
}

function isMineLoggingEnabled(value) {
  return value === 'true';
}

function getMessageText(message) {
  const embedText = (message.embeds || [])
    .flatMap((embed) => [
      embed.title,
      embed.description,
      ...(embed.fields || []).flatMap((field) => [field.name, field.value])
    ])
    .filter(Boolean)
    .join('\n');
  return `${message.content || ''}\n${embedText}`;
}

function isOwoMinesMessage(message) {
  if (!message?.guild || !message.author?.bot) return false;

  const authorName = `${message.author.username || ''} ${message.author.globalName || ''}`.toLowerCase();
  return authorName.includes('owo') && /\bmines?\b/i.test(getMessageText(message));
}

function getMineBoardText(message) {
  const rows = (message.components || [])
    .map((row) => (row.components || []).filter((component) => component.type === 2))
    .filter((buttons) => buttons.length === 3);

  if (rows.length < 3) return '';

  const board = rows.slice(0, 3).map((buttons) => buttons
    .map((button) => button.emoji?.name || button.label || '[blank]')
    .join(' | '));
  return `Board state (top to bottom):\n${board.join('\n')}`;
}

function buildMineLogPayload(message) {
  const sourceUrl = message.url || '';
  const sourceLabel = sourceUrl ? `Source: ${sourceUrl}` : `Source channel: #${message.channel?.name || 'unknown'}`;
  const originalContent = String(message.content || '').trim();
  const boardText = getMineBoardText(message);
  const suffix = [boardText, sourceLabel].filter(Boolean).join('\n');
  const separatorLength = originalContent && suffix ? 1 : 0;
  const contentLimit = Math.max(0, 2000 - suffix.length - separatorLength);
  const content = [originalContent.slice(0, contentLimit), suffix].filter(Boolean).join('\n');

  return {
    content,
    embeds: (message.embeds || []).map((embed) => embed.toJSON()),
    allowedMentions: { parse: [] }
  };
}

async function ensureMineLogChannel(guild) {
  let channel = guild.channels.cache.find(
    (entry) => entry.name === MINE_LOG_CHANNEL_NAME && entry.type === ChannelType.GuildText
  );
  if (!channel) {
    channel = await guild.channels.create({
      name: MINE_LOG_CHANNEL_NAME,
      type: ChannelType.GuildText,
      reason: 'Created to record Owo Mines game messages'
    });
  }
  return channel;
}

async function handleMineLogMessage(message, { readConfig = getConfig } = {}) {
  if (!isOwoMinesMessage(message)) return false;

  try {
    const loggingEnabled = await readConfig(getMineLogConfigKey(message.guild.id));
    if (!isMineLoggingEnabled(loggingEnabled)) return false;
    const sourceChannelId = await readConfig(getMineLogSourceConfigKey(message.guild.id));
    if (!sourceChannelId || message.channel?.id !== sourceChannelId) return false;

    const channel = await ensureMineLogChannel(message.guild);
    const payload = buildMineLogPayload(message);
    const previousLog = loggedMessages.get(message.id);

    if (previousLog) {
      await previousLog.edit(payload);
      return true;
    }

    const logMessage = await channel.send(payload);
    loggedMessages.set(message.id, logMessage);
    if (loggedMessages.size > MAX_CACHED_LOG_MESSAGES) {
      loggedMessages.delete(loggedMessages.keys().next().value);
    }
    return true;
  } catch (error) {
    console.error(`Failed to record Owo Mines message ${message.id || '(unknown id)'}:`, error);
    return false;
  }
}

module.exports = {
  MINE_LOG_CHANNEL_NAME,
  getMineLogConfigKey,
  getMineLogSourceConfigKey,
  isMineLoggingEnabled,
  isOwoMinesMessage,
  getMineBoardText,
  buildMineLogPayload,
  ensureMineLogChannel,
  handleMineLogMessage
};
