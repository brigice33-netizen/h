const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

module.exports = {
  name: 'ban',
  description: 'Ban a member from the server',
  usage: '~ban @user reason:<reason text>',
  requiredPermissions: [PermissionFlagsBits.BanMembers],

  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'ban', requiredPermissions: [PermissionFlagsBits.BanMembers], requireApproval: true }))) {
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
      return message.reply('❌ Please mention a member or provide their ID to ban.');
    }

    if (!target.bannable) {
      return message.reply('❌ I cannot ban that member.');
    }

    // Parse reason: support `reason:...` token or plain text after the user
    let reason = '';
    const reasonTokenIndex = args.findIndex((a) => /^reason:?/i.test(a));
    if (reasonTokenIndex >= 0) {
      const token = args[reasonTokenIndex];
      const after = args.slice(reasonTokenIndex + 1).join(' ').trim();
      // token may be like 'reason:some text' or 'reason:'
      const inline = token.replace(/^reason:?/i, '').trim();
      reason = (inline || after).trim();
    } else {
      // fallback: everything after first arg
      reason = args.slice(1).join(' ').trim();
    }

    if (!reason) {
      return message.reply('❌ A reason is required to ban a member. Usage: `~ban @user reason:<reason text>`');
    }

    try {
      // Ask for confirmation before banning
      const confirmPrompt = await message.reply(`Are you sure you want to ban ${target.user.tag} for: "${reason}"? Reply with \`yes\` to confirm within 30 seconds.`).catch(() => null);
      try {
        const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id && /^y(?:es)?$/i.test(m.content), max: 1, time: 30000, errors: ['time'] });
        if (!collected || !collected.first()) {
          return message.reply('❌ Ban cancelled (no confirmation).');
        }
      } catch (err) {
        return message.reply('❌ Ban cancelled (no confirmation).');
      }

      await target.ban({ reason });
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🔨 Member Banned')
        .addFields(
          { name: 'User', value: `${target.user.tag}`, inline: true },
          { name: 'Reason', value: reason, inline: true }
        )
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await message.reply('❌ Failed to ban the member.');
    }
  }
};
