const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

const MAX_MASSBAN_COUNT = 25;

function normalizeUserId(value) {
  const match = String(value || '').match(/\d{17,20}/);
  return match ? match[0] : null;
}

function getReason(args, targetTokens) {
  const reasonTokenIndex = args.findIndex((value) => /^reason:?/i.test(value));
  if (reasonTokenIndex >= 0) {
    const token = args[reasonTokenIndex];
    const inlineReason = token.replace(/^reason:?/i, '').trim();
    const followingReason = args.slice(reasonTokenIndex + 1).join(' ').trim();
    return (inlineReason || followingReason).trim();
  }

  return args.slice(targetTokens.length + 1).join(' ').trim();
}

module.exports = {
  name: 'massban',
  description: 'Ban multiple members after explicit confirmation',
  ownerOnly: true,
  usage: '~massban <@user|user-id> [user...] reason:<reason> confirm',
  requiredPermissions: [PermissionFlagsBits.BanMembers],

  async execute(message, args = []) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'massban', requiredPermissions: [PermissionFlagsBits.BanMembers], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.BanMembers])) {
      return message.reply('❌ You do not have permission to ban members.');
    }

    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply('❌ I need the Ban Members permission.');
    }

    const confirmed = args.some((value) => ['confirm', 'yes', '--confirm'].includes(String(value).toLowerCase()));
    const targetTokens = args.filter((value) => normalizeUserId(value) && !['confirm', 'yes', '--confirm'].includes(String(value).toLowerCase()));
    const targetIds = [...new Set(targetTokens.map(normalizeUserId).filter(Boolean))];

    if (targetIds.length === 0 || targetIds.length > MAX_MASSBAN_COUNT || !confirmed) {
      return message.reply(`❌ Usage: \`~massban <@user|user-id> [user...] reason:<reason> confirm\`\nProvide 1-${MAX_MASSBAN_COUNT} unique member IDs, a reason, and \`confirm\`.`);
    }

    const reason = getReason(args, targetTokens);
    if (!reason || reason.toLowerCase() === 'confirm') {
      return message.reply('❌ A reason is required. Usage: `~massban <@user|user-id> [user...] reason:<reason> confirm`');
    }

    const successes = [];
    const failures = [];

    for (const userId of targetIds) {
      try {
        const member = await message.guild.members.fetch(userId).catch(() => null);
        if (!member) {
          failures.push(`${userId}: not a member`);
          continue;
        }

        if (!member.bannable) {
          failures.push(`${member.user.tag}: not bannable`);
          continue;
        }

        await member.ban({ reason });
        successes.push(member.user.tag);
      } catch (error) {
        console.error(`Failed to mass-ban ${userId}:`, error);
        failures.push(`${userId}: ban failed`);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(successes.length > 0 ? '#FF0000' : '#FF9800')
      .setTitle('🔨 Mass Ban Complete')
      .addFields(
        { name: 'Banned', value: String(successes.length), inline: true },
        { name: 'Failed or Skipped', value: String(failures.length), inline: true },
        { name: 'Reason', value: reason.slice(0, 1024), inline: false }
      )
      .setTimestamp();

    if (successes.length > 0) {
      embed.addFields({ name: 'Successful', value: successes.join('\n').slice(0, 1024), inline: false });
    }

    if (failures.length > 0) {
      embed.addFields({ name: 'Failures', value: failures.join('\n').slice(0, 1024), inline: false });
    }

    return message.reply({ embeds: [embed] });
  }
};