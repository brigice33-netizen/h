const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { recordWarning } = require('../../database');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

module.exports = {
  name: 'warn',
  aliases: ['w'],
  description: 'Warn a member and send them a private warning message',
  usage: '~warn @user [reason]',
  requiredPermissions: [PermissionFlagsBits.ManageMessages],

  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'warn', requiredPermissions: [PermissionFlagsBits.ManageMessages], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers])) {
      return message.reply('❌ You do not have permission to warn members.');
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]?.replace(/[^0-9]/g, ''));
    if (!target) {
      return message.reply('❌ Please mention a member or provide their ID to warn.');
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';

    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#FFAA00')
        .setTitle('⚠️ You have been warned')
        .addFields(
          { name: 'Server', value: `${message.guild.name}`, inline: false },
          { name: 'Reason', value: reason, inline: false }
        )
        .setTimestamp();

      await target.send({ embeds: [dmEmbed] }).catch(() => {});
      await recordWarning(message.guild.id, target.id, message.author.id, reason);

      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Member Warned')
        .addFields(
          { name: 'User', value: `${target.user.tag}`, inline: true },
          { name: 'Reason', value: reason, inline: true }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await message.reply('❌ Failed to warn the member.');
    }
  }
};
