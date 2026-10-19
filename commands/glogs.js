const { PermissionFlagsBits } = require('discord.js');
const { getConfig, setConfig } = require('../database');
const { hasCommandPermission } = require('../utils/owner');
const {
  GLOBAL_LOG_GUILD_ID,
  GLOBAL_LOG_CHANNEL_NAME,
  GLOBAL_LOG_ENABLED_KEY,
  ensureGlobalLogChannel
} = require('../utils/globalLogger');

module.exports = {
  name: 'glogs',
  aliases: [],
  description: "Configure centralized audit logging for the bot's servers",
  usage: '~glogs <on|off|status>',
  requiredPermissions: [PermissionFlagsBits.ManageGuild],

  async execute(message, args = [], client) {
    if (!message.guild || message.guild.id !== GLOBAL_LOG_GUILD_ID) {
      return message.reply('This command can only be configured in the designated global log server.');
    }
    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageGuild])) {
      return message.reply('You need Manage Server permission to configure global logs.');
    }

    const action = String(args[0] || '').toLowerCase();
    try {
      if (action === 'status') {
        const enabled = await getConfig(GLOBAL_LOG_ENABLED_KEY) === 'true';
        const channel = message.guild.channels.cache.find(
          (entry) => entry.name === GLOBAL_LOG_CHANNEL_NAME
        );
        return message.reply(`Global audit logging is **${enabled ? 'enabled' : 'disabled'}**. Log channel: ${channel || 'not created'}.`);
      }

      if (!['on', 'off'].includes(action)) {
        return message.reply('Usage: `~glogs <on|off|status>`.');
      }

      if (action === 'on') {
        const channel = await ensureGlobalLogChannel(client || message.client, { configurePermissions: true });
        await setConfig(GLOBAL_LOG_ENABLED_KEY, 'true');
        return message.reply(`Global audit logging is now **enabled**. Logs from all servers will be sent to ${channel}.`);
      }

      await setConfig(GLOBAL_LOG_ENABLED_KEY, 'false');
      return message.reply('Global audit logging is now **disabled**.');
    } catch (error) {
      console.error('Failed to configure global audit logging:', error);
      return message.reply('Failed to configure global audit logging. Check that I have Manage Channels and Send Messages in the global log server.');
    }
  }
};
