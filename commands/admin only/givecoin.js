const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addCoins, ensureUser } = require('../../database');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

module.exports = {
  name: 'givecoin',
  ownerOnly: true,
  description: 'Admin: give coins to a user (max 500 per command)',
  usage: '~givecoin @user <amount>',

  async execute(message, args) {
    if (!(await authorizeOwnerCommand(message, { commandName: 'givecoin', requiredPermissions: [PermissionFlagsBits.ManageGuild], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageGuild])) {
      return message.reply('❌ You do not have permission to give coins.');
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]?.replace(/[^0-9]/g, ''));
    if (!target) return message.reply('❌ Please mention a member or provide their ID to give coins to.');

    const amount = parseInt(args[1], 10);
    if (!Number.isFinite(amount) || amount <= 0) return message.reply('❌ Invalid amount.');
    if (amount > 500) return message.reply('❌ Limit exceeded. Maximum 500 coins per command.');

    try {
      await ensureUser(target.id);
      await addCoins(target.id, amount, 'admin_give');

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('💰 Coins Given')
        .addFields(
          { name: 'User', value: `${target.user.tag}`, inline: true },
          { name: 'Amount', value: `${amount}`, inline: true }
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      return message.reply('❌ Failed to give coins.');
    }
  }
};
