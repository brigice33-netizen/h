const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

module.exports = {
  name: 'softban',
  aliases: ['sb'],
  description: 'Softban a member to remove recent messages',
  usage: '~softban @user [reason]',
  requiredPermissions: [PermissionFlagsBits.BanMembers],

  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'softban', requiredPermissions: [PermissionFlagsBits.BanMembers], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.BanMembers])) {
      return message.reply('❌ You do not have permission to ban members.');
    }

    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply('❌ I need the Ban Members permission.');
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]?.replace(/[^0-9]/g, ''));
    if (!target) {
      return message.reply('❌ Please mention a member or provide their ID to softban.');
    }

    if (!target.bannable) {
      return message.reply('❌ I cannot softban that member.');
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';
    try {
      await target.ban({ reason, deleteMessageDays: 1 });
      await message.guild.bans.remove(target.id, reason);
      const embed = new EmbedBuilder()
        .setColor('#FF4500')
        .setTitle('🚫 Member Softbanned')
        .addFields(
          { name: 'User', value: `${target.user.tag}`, inline: true },
          { name: 'Reason', value: reason, inline: true }
        )
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await message.reply('❌ Failed to softban the member.');
    }
  }
};
