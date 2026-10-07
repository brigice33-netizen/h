const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

function parseDuration(duration) {
  const match = duration?.toString().match(/^(\d+)([smhd])$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

module.exports = {
  name: 'timeout',
  aliases: ['tm'],
  description: 'Temporarily timeout a member',
  usage: '~timeout @user <duration> [reason]',
  requiredPermissions: [PermissionFlagsBits.ModerateMembers],

  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'timeout', requiredPermissions: [PermissionFlagsBits.ModerateMembers], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ModerateMembers])) {
      return message.reply('❌ You do not have permission to timeout members.');
    }

    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('❌ I need the Moderate Members permission.');
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]?.replace(/[^0-9]/g, ''));
    if (!target) {
      return message.reply('❌ Please mention a member or provide their ID to timeout.');
    }

    const durationArg = args[1];
    const durationMs = parseDuration(durationArg) || parseDuration('10m');
    if (!durationMs) {
      return message.reply('❌ Invalid duration. Use `10s`, `10m`, `1h`, or `1d`.');
    }

    if (!target.moderatable) {
      return message.reply('❌ I cannot timeout that member.');
    }

    const reason = args.slice(2).join(' ') || 'No reason provided';
    try {
      await target.timeout(durationMs, reason);
      const embed = new EmbedBuilder()
        .setColor('#8A2BE2')
        .setTitle('⏱️ Member Timed Out')
        .addFields(
          { name: 'User', value: `${target.user.tag}`, inline: true },
          { name: 'Duration', value: durationArg || '10m', inline: true },
          { name: 'Reason', value: reason, inline: true }
        )
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await message.reply('❌ Failed to timeout the member.');
    }
  }
};
