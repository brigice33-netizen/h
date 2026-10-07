const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { applyGuildLockdown, unlockGuildLockdown, getLockdownRemainingMs } = require('../../utils/raidLockdown');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

function parseDurationSeconds(value, fallback = 300) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed;
}

function formatSeconds(seconds) {
  return `${Math.max(1, Math.round(seconds))}s`;
}

module.exports = {
  name: 'lockdown',
  description: 'Temporarily lock the server during a raid',
  usage: '~lockdown <on|off|status> [seconds]',

  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'lockdown', requiredPermissions: [PermissionFlagsBits.ManageGuild], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageGuild])) {
      return message.reply('❌ You do not have permission to use lockdown.');
    }

    const subcommand = args[0]?.toLowerCase();
    if (!subcommand) {
      return message.reply('❌ Usage: `~lockdown <on|off|status> [seconds]`');
    }

    const reason = `Manual raid lockdown requested by ${message.author.tag}`;

    if (subcommand === 'status') {
      const remainingMs = getLockdownRemainingMs(message.guild.id);
      const active = remainingMs > 0;
      const embed = new EmbedBuilder()
        .setColor(active ? '#FFB300' : '#43A047')
        .setTitle('🧱 Server Lockdown Status')
        .setDescription(active
          ? `Lockdown is active for about **${Math.max(1, Math.ceil(remainingMs / 1000))} seconds**.`
          : 'Lockdown is currently not active.')
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    if (subcommand === 'on') {
      if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return message.reply('❌ I need Manage Channels permission to apply lockdown.');
      }

      const durationSeconds = parseDurationSeconds(args[1] || '300', 300);
      if (durationSeconds < 30 || durationSeconds > 3600) {
        return message.reply('❌ Usage: `~lockdown on <30-3600>` in seconds');
      }

      const result = await applyGuildLockdown(message.guild, reason, durationSeconds * 1000);
      if (result.alreadyActive) {
        return message.reply('⚠️ Lockdown is already active.');
      }

      const embed = new EmbedBuilder()
        .setColor('#FB8C00')
        .setTitle('🧱 Lockdown Enabled')
        .setDescription(`Server channels are now locked for **${formatSeconds(durationSeconds)}**.`)
        .addFields({ name: 'Auto-unlock', value: `${durationSeconds} seconds`, inline: true })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    if (subcommand === 'off') {
      if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return message.reply('❌ I need Manage Channels permission to remove lockdown.');
      }

      const unlocked = await unlockGuildLockdown(message.guild, `Manual unlock requested by ${message.author.tag}`);
      if (!unlocked) {
        return message.reply('ℹ️ Lockdown is not active.');
      }

      const embed = new EmbedBuilder()
        .setColor('#43A047')
        .setTitle('🧱 Lockdown Disabled')
        .setDescription('Server channel overwrites have been restored.')
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    return message.reply('❌ Usage: `~lockdown <on|off|status> [seconds]`');
  }
};