const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

const CONFIRMATION_TTL_MS = 60 * 1000;
const PENDING_NUKES = new Map();
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function getPendingKey(guildId, channelId, userId) {
  return `${guildId}:${channelId}:${userId}`;
}

function setPendingNuke(guildId, channelId, userId) {
  PENDING_NUKES.set(getPendingKey(guildId, channelId, userId), Date.now() + CONFIRMATION_TTL_MS);
}

function hasPendingNuke(guildId, channelId, userId) {
  const key = getPendingKey(guildId, channelId, userId);
  const expiresAt = PENDING_NUKES.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    PENDING_NUKES.delete(key);
    return false;
  }
  return true;
}

function clearPendingNuke(guildId, channelId, userId) {
  PENDING_NUKES.delete(getPendingKey(guildId, channelId, userId));
}

async function deleteAllMessages(channel) {
  let deletedCount = 0;
  let before;

  while (true) {
    const messages = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 });
    if (messages.size === 0) break;

    const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
    const recentMessages = messages.filter((message) => message.createdTimestamp >= cutoff);
    const oldMessages = messages.filter((message) => message.createdTimestamp < cutoff);

    if (recentMessages.size > 0) {
      try {
        const deleted = await channel.bulkDelete(recentMessages, true);
        deletedCount += deleted.size;
      } catch (error) {
        const errorText = String(error?.message || error || '');
        if (!/14 days|older than|too old|bulk delete/i.test(errorText)) {
          throw error;
        }

        for (const message of recentMessages.values()) {
          if (!message?.deletable) continue;
          await message.delete().catch(() => {});
          deletedCount += 1;
        }
      }
    }

    for (const message of oldMessages.values()) {
      await message.delete().catch(() => {});
      deletedCount += 1;
    }

    const oldestMessage = messages.last();
    if (!oldestMessage || messages.size < 100) break;
    before = oldestMessage.id;
  }

  return deletedCount;
}

module.exports = {
  name: 'nuke',
  description: 'Delete every message in the current channel',
  ownerOnly: true,
  usage: '~nuke [fast] confirm',
  requiredPermissions: [PermissionFlagsBits.ManageMessages],
  deleteAllMessages,

  async execute(message, args = []) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'nuke', requiredPermissions: [PermissionFlagsBits.ManageMessages], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageMessages])) {
      return message.reply('❌ You do not have permission to delete messages.');
    }

    if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply('❌ I need the Manage Messages permission.');
    }

    const fast = String(args[0] || '').toLowerCase() === 'fast';
    const confirmationIndex = fast ? 1 : 0;
    const confirmed = String(args[confirmationIndex] || '').toLowerCase() === 'confirm';

    if (fast) {
      if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return message.reply('❌ Fast nuke requires the Manage Channels permission.');
      }

      if (!confirmed) {
        return message.reply('⚠️ Fast nuke deletes and recreates this channel, removing all messages immediately. Run `~nuke fast confirm` to continue.');
      }

      try {
        const oldChannel = message.channel;
        const newChannel = await oldChannel.clone({ reason: `Fast nuke requested by ${message.author.tag}` });
        await newChannel.setPosition(oldChannel.position).catch(() => {});
        await oldChannel.delete(`Fast nuke requested by ${message.author.tag}`);
        return newChannel.send('✅ Fast nuke complete. This channel was recreated and all previous messages were removed.');
      } catch (error) {
        console.error('Failed to fast nuke channel:', error);
        return message.reply('❌ Fast nuke failed. Check that I have Manage Channels permission.');
      }
    }

    if (typeof message.channel?.messages?.fetch !== 'function' || typeof message.channel?.bulkDelete !== 'function') {
      return message.reply('❌ I can only nuke messages in a text-based channel.');
    }

    const userId = message.author.id;
    if (!confirmed || !hasPendingNuke(message.guild.id, message.channel.id, userId)) {
      setPendingNuke(message.guild.id, message.channel.id, userId);
      return message.reply('⚠️ This will delete every message in this channel, including this prompt. Old messages may take a while. Run `~nuke confirm` within 60 seconds, or use `~nuke fast confirm` to recreate the channel immediately.');
    }

    clearPendingNuke(message.guild.id, message.channel.id, userId);

    try {
      const deletedCount = await deleteAllMessages(message.channel);
      const embed = new EmbedBuilder()
        .setColor('#F44336')
        .setTitle('🧨 Channel Nuked')
        .setDescription(`Deleted **${deletedCount.toLocaleString()}** message(s) from <#${message.channel.id}>.`)
        .setTimestamp();

      return message.channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to nuke channel:', error);
      return message.channel.send('❌ Failed to delete every message in this channel.');
    }
  }
};