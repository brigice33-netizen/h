const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

module.exports = {
  name: 'kick',
  description: 'Kick a member from the server',
  usage: '~kick @user [reason]',
  requiredPermissions: [PermissionFlagsBits.KickMembers],

  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'kick', requiredPermissions: [PermissionFlagsBits.KickMembers], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.KickMembers])) {
      return message.reply('❌ You do not have permission to kick members.');
    }

    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply('❌ I need the Kick Members permission.');
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]?.replace(/[^0-9]/g, ''));
    if (!target) {
      return message.reply('❌ Please mention a member or provide their ID to kick.');
    }

    if (!target.kickable) {
      return message.reply('❌ I cannot kick that member.');
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';
    try {
      await target.kick(reason);
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🦵 Member Kicked')
        .addFields(
          { name: 'User', value: `${target.user.tag}`, inline: true },
          { name: 'Reason', value: reason, inline: true }
        )
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await message.reply('❌ Failed to kick the member.');
    }
  }
};
