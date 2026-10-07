const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

module.exports = {
  name: 'unmute',
  description: 'Unmute a member by removing the Muted role or timeout',
  usage: '~unmute @user [reason]',
  requiredPermissions: [PermissionFlagsBits.ManageRoles],

  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'unmute', requiredPermissions: [PermissionFlagsBits.ManageRoles], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ModerateMembers])) {
      return message.reply('❌ You do not have permission to unmute members.');
    }

    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply('❌ I need the Manage Roles permission to unmute members.');
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]?.replace(/[^0-9]/g, ''));
    if (!target) {
      return message.reply('❌ Please mention a member or provide their ID to unmute.');
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';
    let removed = false;

    const mutedRole = message.guild.roles.cache.find(role => role.name === 'Muted');
    if (mutedRole && target.roles.cache.has(mutedRole.id)) {
      try {
        await target.roles.remove(mutedRole, reason);
        removed = true;
      } catch (error) {
        console.error(error);
      }
    }

    if (target.isCommunicationDisabled()) {
      try {
        await target.timeout(null, reason);
        removed = true;
      } catch (error) {
        console.error(error);
      }
    }

    if (!removed) {
      return message.reply('❌ That member is not muted or timed out.');
    }

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🔊 Member Unmuted')
      .addFields(
        { name: 'User', value: `${target.user.tag}`, inline: true },
        { name: 'Reason', value: reason, inline: true }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
};
