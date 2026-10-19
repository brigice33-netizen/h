const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('../database');

const GLOBAL_LOG_GUILD_ID = '1544646139163185243';
const GLOBAL_LOG_CHANNEL_NAME = 'global-logs';
const GLOBAL_LOG_ENABLED_KEY = 'glogs:enabled';

function formatDeletedChannelDetails(channel) {
  const channelKind = channel.type === ChannelType.GuildVoice
    ? 'Voice channel'
    : channel.type === ChannelType.GuildCategory
      ? 'Category'
      : channel.type === ChannelType.GuildText
        ? 'Text channel'
        : 'Channel';
  const parentName = channel.parent?.name || null;
  return [
    `${channelKind}: ${channel.name || 'unknown'} (\`${channel.id}\`)`,
    parentName ? `Category: ${parentName}` : null
  ].filter(Boolean).join('\n');
}

function formatDeletedMessageDetails(message) {
  const channel = message.channel;
  const channelKind = channel?.type === ChannelType.GuildVoice ? 'Voice channel' : 'Channel';
  const author = message.author?.tag || message.author?.username || message.authorId || 'Unknown user';
  const embeds = (message.embeds || []).map((embed) => [
    embed.title,
    embed.description,
    ...(embed.fields || []).flatMap((field) => [field.name, field.value])
  ].filter(Boolean).join('\n')).filter(Boolean);
  const attachments = [...(message.attachments?.values?.() || [])]
    .map((attachment) => attachment.url || attachment.name)
    .filter(Boolean);

  return [
    `Author: ${author}`,
    `${channelKind}: #${channel?.name || 'unknown'} (\`${channel?.id || 'unknown'}\`)`,
    `Content:\n${String(message.content || '').trim() || '*empty or unavailable*'}`,
    embeds.length ? `Embeds:\n${embeds.join('\n\n')}` : null,
    attachments.length ? `Attachments:\n${attachments.join('\n')}` : null
  ].filter(Boolean).join('\n');
}

function chunkLogLines(lines, maxLength = 3500) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    let remaining = String(line || '');
    if (current && current.length + 2 + remaining.length > maxLength) {
      chunks.push(current);
      current = '';
    }

    while (remaining.length > maxLength) {
      chunks.push(current ? `${current}\n\n${remaining.slice(0, maxLength - current.length - 2)}` : remaining.slice(0, maxLength));
      remaining = remaining.slice(current ? maxLength - current.length - 2 : maxLength);
      current = '';
    }

    current = current ? `${current}\n\n${remaining}` : remaining;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function ensureGlobalLogChannel(client, { configurePermissions = false } = {}) {
  const guild = client.guilds.cache.get(GLOBAL_LOG_GUILD_ID);
  if (!guild) {
    throw new Error(`Global log server ${GLOBAL_LOG_GUILD_ID} is not available to the bot.`);
  }

  const botMember = guild.members.me;
  if (!botMember) {
    throw new Error(`Bot member is unavailable in global log server ${GLOBAL_LOG_GUILD_ID}.`);
  }
  let channel = guild.channels.cache.find(
    (entry) => entry.name === GLOBAL_LOG_CHANNEL_NAME && entry.type === ChannelType.GuildText
  );
  if (!channel) {
    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      ...guild.roles.cache
        .filter((role) => roleCanManageGuild(role))
        .map((role) => ({
          id: role.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages]
        })),
      {
        id: botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels
        ]
      }
    ];
    channel = await guild.channels.create({
      name: GLOBAL_LOG_CHANNEL_NAME,
      type: ChannelType.GuildText,
      permissionOverwrites,
      reason: 'Created for centralized server audit logs'
    });
  }

  if (configurePermissions) {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false
    }, { reason: 'Keep centralized audit logs private' });
    for (const role of guild.roles.cache.filter(roleCanManageGuild).values()) {
      await channel.permissionOverwrites.edit(role, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false
      }, { reason: 'Allow server managers to view centralized audit logs' });
    }
    await channel.permissionOverwrites.edit(botMember, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      ManageChannels: true
    }, { reason: 'Allow the bot to write centralized audit logs' });
  }
  return channel;
}

function roleCanManageGuild(role) {
  return role.permissions.has(PermissionFlagsBits.ManageGuild)
    || role.permissions.has(PermissionFlagsBits.Administrator);
}

async function sendGlobalAuditLog(client, sourceGuild, title, description, color = '#5865F2', {
  readConfig = getConfig,
  resolveChannel = ensureGlobalLogChannel
} = {}) {
  if (!sourceGuild || await readConfig(GLOBAL_LOG_ENABLED_KEY) !== 'true') return false;

  const channel = await resolveChannel(client);
  const sourceName = String(sourceGuild.name || 'Unknown server').slice(0, 100);
  const safeDescription = String(description || '*empty*').slice(0, 3900);
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(String(title || 'Audit log').slice(0, 256))
    .setDescription(safeDescription)
    .addFields({ name: 'Origin Server', value: `${sourceName}\n\`${sourceGuild.id}\`` })
    .setTimestamp();
  await channel.send({ embeds: [embed] });
  return true;
}

module.exports = {
  GLOBAL_LOG_GUILD_ID,
  GLOBAL_LOG_CHANNEL_NAME,
  GLOBAL_LOG_ENABLED_KEY,
  formatDeletedChannelDetails,
  formatDeletedMessageDetails,
  chunkLogLines,
  ensureGlobalLogChannel,
  sendGlobalAuditLog
};
