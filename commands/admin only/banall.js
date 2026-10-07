const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand, getOwnerIds, hasCommandPermission } = require('../../utils/owner');
const { getProtectedGuildIds } = require('../../utils/safety');

const CONFIRMATION = 'CONFIRM';

function getProtectedGuildId(message) {
  return process.env.PROTECTED_GUILD_ID || process.env.MAIN_GUILD_ID || process.env.HOME_GUILD_ID || null;
}

function parseBanallArguments(args) {
  const targetGuildId = String(args[0] || '').trim();
  const confirmation = String(args.at(-1) || '').trim().toUpperCase();
  const reasonTokens = args.slice(1, -1);
  const firstReasonToken = reasonTokens[0] || '';
  const reason = [firstReasonToken.replace(/^reason:?/i, ''), ...reasonTokens.slice(1)].join(' ').trim();

  return { targetGuildId, reason, confirmation };
}

module.exports = {
  name: 'banall',
  aliases: ['baneveryone'],
  description: 'Ban every bannable member from a specified server',
  ownerOnly: true,
  usage: '~banall <guild-id> <reason> confirm',
  requiredPermissions: [PermissionFlagsBits.BanMembers],

  async execute(message, args = []) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    const protectedGuildIds = getProtectedGuildIds(process.env);
    if (protectedGuildIds.length === 0) {
      return message.reply('🛡️ Ban-all is disabled because no protected guild is configured.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'banall', requiredPermissions: [PermissionFlagsBits.BanMembers], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.BanMembers])) {
      return message.reply('❌ You do not have permission to ban members.');
    }

    const { targetGuildId, reason, confirmation } = parseBanallArguments(args);
    if (!/^\d{17,20}$/.test(targetGuildId) || !reason || confirmation !== CONFIRMATION) {
      return message.reply('❌ Usage: `~banall <guild-id> <reason> confirm`\nA reason and the exact confirmation word are required.');
    }

    if (targetGuildId === getProtectedGuildId(message)) {
      return message.reply('🛡️ I will not ban everyone from the protected server.');
    }

    const targetGuild = message.client.guilds.cache.get(targetGuildId);
    if (!targetGuild) {
      return message.reply('❌ I am not currently in a server with that ID. Use `~serverlist` first.');
    }

    if (!targetGuild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply('❌ I need the Ban Members permission in the target server.');
    }

    const protectedUserIds = new Set([message.client.user?.id, ...getOwnerIds()].filter(Boolean));
    let members;
    try {
      members = await targetGuild.members.fetch();
    } catch (error) {
      console.error(`Failed to fetch members for ${targetGuildId}:`, error);
      return message.reply('❌ I could not fetch the members of that server.');
    }

    const banned = [];
    let dmFailed = 0;
    let skipped = 0;
    for (const member of members.values()) {
      if (protectedUserIds.has(member.id) || !member.bannable) {
        skipped += 1;
        continue;
      }

      try {
        await member.send(`You were banned from **${targetGuild.name}**.\n\n**Reason:** ${reason}`).catch(() => {
          dmFailed += 1;
        });
        await member.ban({ reason: reason.slice(0, 512) });
        banned.push(member.id);
      } catch (error) {
        skipped += 1;
        console.error(`Failed to ban ${member.id} in ${targetGuildId}:`, error);
      }
    }

    const embed = new EmbedBuilder()
      .setColor('#B71C1C')
      .setTitle('🔨 Ban Everyone Complete')
      .setDescription(`Processed **${targetGuild.name}**.`)
      .addFields(
        { name: 'Banned', value: String(banned.length), inline: true },
        { name: 'Skipped or Failed', value: String(skipped), inline: true },
        { name: 'DMs Not Delivered', value: String(dmFailed), inline: true },
        { name: 'Reason', value: reason.slice(0, 1024), inline: false }
      )
      .setFooter({ text: 'The bot and configured owners were protected.' })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};