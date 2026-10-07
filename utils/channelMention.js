const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { hasCommandPermission } = require('./owner');

function normalizeName(value) {
  return String(value || '').trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
}

function resolveChannel(guild, value) {
  const input = String(value || '').trim();
  const mentionedId = input.match(/^<#(\d+)>$/)?.[1];
  const directId = mentionedId || input;
  const byId = guild.channels.cache.get(directId);
  if (byId) return byId;

  const normalizedName = normalizeName(input);
  return guild.channels.cache.find((channel) => normalizeName(channel.name) === normalizedName) || null;
}

async function handleChannelCategoryRequest(message, client) {
  const botId = client?.user?.id;
  if (!botId || !message?.guild) return false;

  const mention = new RegExp(`<@!?${botId}>`, 'g');
  if (!mention.test(String(message.content || ''))) return false;

  const request = String(message.content || '').replace(mention, '').trim();
  const match = request.match(/^put\s+(.+)\s+in\s+(.+)$/i);
  if (!match) return false;

  const [, channelInput, categoryInput] = match;
  const targetChannel = resolveChannel(message.guild, channelInput);
  const category = resolveChannel(message.guild, categoryInput);

  if (!targetChannel) {
    await message.reply('❌ I could not find that channel in this server.');
    return true;
  }
  if (!category || category.type !== ChannelType.GuildCategory) {
    await message.reply('❌ I could not find that category in this server.');
    return true;
  }
  if (targetChannel.type === ChannelType.GuildCategory || targetChannel.isThread?.() || typeof targetChannel.setParent !== 'function') {
    await message.reply('❌ That channel cannot be moved into a category.');
    return true;
  }
  if (!hasCommandPermission(message, [PermissionFlagsBits.ManageChannels])) {
    await message.reply('❌ You need the Manage Channels permission to move channels.');
    return true;
  }
  if (!message.guild.members.me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
    await message.reply('❌ I need the Manage Channels permission to move channels.');
    return true;
  }

  try {
    await targetChannel.setParent(category.id, {
      lockPermissions: false,
      reason: `Channel moved by ${message.author?.tag || message.author?.id || 'user'}`
    });
    await message.reply(`✅ Moved <#${targetChannel.id}> into **${category.name}**.`);
  } catch (error) {
    console.error('Failed to move channel into category:', error);
    await message.reply('❌ Failed to move that channel. Check my permissions and try again.');
  }

  return true;
}

module.exports = { handleChannelCategoryRequest, resolveChannel };