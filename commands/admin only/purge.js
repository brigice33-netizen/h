const { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { authorizeOwnerCommand } = require('../../utils/owner');

const MAX_PURGE_COUNT = 10000;
const PURGE_CONFIRM_THRESHOLD = 1000;
const PENDING_PURGES = new Map();

function parseCount(value) {
  const count = Number.parseInt(value, 10);
  if (!Number.isInteger(count) || count < 1 || count > MAX_PURGE_COUNT) {
    return null;
  }

  return count;
}

async function deleteMessagesInBatches(channel, count) {
  let remaining = count;
  let deletedTotal = 0;
  const deletedMessages = [];

  while (remaining > 0) {
    const batchSize = Math.min(remaining, 100);

    try {
      const deletedBatch = await channel.bulkDelete(batchSize, true);
      const deletedCount = deletedBatch?.size || 0;
      deletedMessages.push(...Array.from(deletedBatch?.values?.() || []));
      deletedTotal += deletedCount;
      remaining -= deletedCount;

      if (deletedCount === 0) {
        break;
      }
      continue;
    } catch (error) {
      const errorText = String(error?.message || error || '');
      const isTooOldForBulkDelete = /14 days|older than|too old|bulk delete/i.test(errorText);
      if (!isTooOldForBulkDelete) {
        throw error;
      }

      const messages = await channel.messages.fetch({ limit: batchSize }).catch(() => new Map());
      const messageList = Array.from(messages?.values?.() || []);
      let manualDeleted = 0;

      for (const message of messageList) {
        if (!message?.deletable) continue;
        await message.delete().catch(() => {});
        deletedMessages.push(message);
        manualDeleted += 1;
      }

      deletedTotal += manualDeleted;
      remaining -= manualDeleted;

      if (manualDeleted === 0) {
        break;
      }
    }
  }

  return { deletedCount: deletedTotal, deletedMessages };
}

function buildPurgeTranscript(messages) {
  if (!messages.length) {
    return 'Message contents were unavailable from Discord\'s deletion response.\n';
  }

  return messages.map((message) => {
    const author = message.author?.tag || message.author?.username || message.author?.id || 'Unknown author';
    const timestamp = message.createdAt?.toISOString?.()
      || (message.createdTimestamp ? new Date(message.createdTimestamp).toISOString() : 'Unknown time');
    const content = String(message.content || '').trim() || '[No text content]';
    const attachmentUrls = Array.from(message.attachments?.values?.() || []).map((attachment) => attachment.url).filter(Boolean);
    const attachmentText = attachmentUrls.length ? `\nAttachments:\n${attachmentUrls.join('\n')}` : '';
    return `[${timestamp}] ${author} (${message.author?.id || 'unknown ID'})\n${content}${attachmentText}`;
  }).join('\n\n---\n\n');
}

async function sendResponse(target, payload) {
  if (target?.isChatInputCommand?.()) {
    if (target.deferred) return target.editReply(payload);
    if (target.replied) return target.followUp(payload);
    return target.reply(payload);
  }

  if (typeof target?.reply === 'function') {
    try {
      return await target.reply(payload);
    } catch (error) {
      const errorText = String(error?.message || error?.rawError?.message || error || '');
      const deletedReference = error?.code === 10008 || /UNKNOWN_MESSAGE|MESSAGE_REFERENCE_UNKNOWN_MESSAGE|message_reference/i.test(errorText);
      if (!deletedReference || typeof target.channel?.send !== 'function') {
        throw error;
      }

      const fallbackPayload = typeof payload === 'string'
        ? payload
        : { ...payload, ephemeral: undefined, allowedMentions: payload.allowedMentions };
      return target.channel.send(fallbackPayload);
    }
  }

  throw new Error('Unsupported response target.');
}

function getPendingKey(guildId, channelId, userId) {
  return `${guildId}:${channelId}:${userId}`;
}

function clearPendingPurge(guildId, channelId, userId) {
  PENDING_PURGES.delete(getPendingKey(guildId, channelId, userId));
}

function setPendingPurge(guildId, channelId, userId, count) {
  const key = getPendingKey(guildId, channelId, userId);
  const expiresAt = Date.now() + 60 * 1000;
  PENDING_PURGES.set(key, { count, expiresAt });
  return key;
}

function getPendingPurge(guildId, channelId, userId) {
  const key = getPendingKey(guildId, channelId, userId);
  const pending = PENDING_PURGES.get(key);
  if (!pending) return null;
  if (pending.expiresAt <= Date.now()) {
    PENDING_PURGES.delete(key);
    return null;
  }
  return pending;
}

module.exports = {
  name: 'purge',
  aliases: ['p'],
  description: 'Bulk delete recent messages from a channel',
  usage: `~purge <1-${MAX_PURGE_COUNT}>`,
  deleteMessagesInBatches,
  buildPurgeTranscript,
  sendResponse,
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete recent messages from a channel')
    .addIntegerOption((option) => option
      .setName('count')
      .setDescription(`Number of recent messages to delete (1-${MAX_PURGE_COUNT})`)
      .setMaxValue(MAX_PURGE_COUNT)
      .setRequired(true))
    .addBooleanOption((option) => option
      .setName('confirm')
      .setDescription(`Confirm purging more than ${PURGE_CONFIRM_THRESHOLD} messages`)),

  async execute(target, args = []) {
    const isInteraction = typeof target?.isChatInputCommand === 'function' && target.isChatInputCommand();
    const guild = target?.guild;

    if (!guild) {
      return sendResponse(target, '❌ This command can only be used in a server.');
    }

    const botMember = guild.members.me;

    if (!(await authorizeOwnerCommand(target, { commandName: 'purge', requiredPermissions: [PermissionFlagsBits.ManageMessages], requireApproval: true }))) {
      return;
    }

    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
      return sendResponse(target, '❌ I need the Manage Messages permission.');
    }

    if (isInteraction && !target.deferred && !target.replied) {
      await target.deferReply({ ephemeral: true });
    }

    const rawAction = String(args[0] || '').toLowerCase();
    if (rawAction === 'stop' || rawAction === 'cancel') {
      clearPendingPurge(guild.id, target.channel.id, target.author?.id || target.user?.id);
      return sendResponse(target, '✅ Pending purge canceled.');
    }

    const countInput = isInteraction ? target.options.getInteger('count') : parseCount(args[0]);
    const count = parseCount(countInput);
    if (!count) {
      return sendResponse(target, `❌ Usage: \`~purge <1-${MAX_PURGE_COUNT}>\``);
    }

    const userId = target.author?.id || target.user?.id;
    const confirmInput = isInteraction ? Boolean(target.options.getBoolean('confirm')) : ['confirm', 'yes', '--confirm'].includes(String(args[1] || '').toLowerCase());

    if (count > PURGE_CONFIRM_THRESHOLD) {
      const pending = getPendingPurge(guild.id, target.channel.id, userId);
      if (!confirmInput || !pending || pending.count !== count) {
        setPendingPurge(guild.id, target.channel.id, userId, count);
        const confirmationText = `⚠️ Are you sure to do this? This will delete **${count.toLocaleString()}** messages. Run \`~purge ${count} confirm\` to continue or \`~purge stop\` to cancel.`;
        return sendResponse(target, isInteraction ? { content: confirmationText, ephemeral: true } : confirmationText);
      }

      clearPendingPurge(guild.id, target.channel.id, userId);
    }

    if (typeof target.channel?.bulkDelete !== 'function') {
      return sendResponse(target, '❌ I can only purge messages in a text-based channel.');
    }

    try {
      const { deletedCount, deletedMessages } = await deleteMessagesInBatches(target.channel, count);
      const embed = new EmbedBuilder()
        .setColor('#F59E0B')
        .setTitle('🧹 Channel Purged')
        .setDescription(`Deleted **${deletedCount}** recent messages. Their contents are attached.`)
        .setTimestamp();
      const transcript = new AttachmentBuilder(Buffer.from(buildPurgeTranscript(deletedMessages), 'utf8'), { name: 'purged-messages.txt' });

      return sendResponse(target, { embeds: [embed], files: [transcript] });
    } catch (error) {
      console.error('Failed to purge messages:', error);
      return sendResponse(target, '❌ Failed to purge messages.');
    }
  }
};