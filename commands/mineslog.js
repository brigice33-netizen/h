const { PermissionFlagsBits } = require('discord.js');
const { getConfig, setConfig } = require('../database');
const { hasCommandPermission } = require('../utils/owner');
const { getMineLogConfigKey, isMineLoggingEnabled } = require('../utils/mineLogger');

module.exports = {
  name: 'mineslog',
  aliases: ['ml'],
  description: 'Enable or disable logging of Owo Mines games in this server',
  usage: '~mineslog [on|off|status]',
  requiredPermissions: [PermissionFlagsBits.ManageGuild],

  async execute(message, args = []) {
    if (!message.guild) return message.reply('This command can only be used in a server.');
    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageGuild])) {
      return message.reply('You need Manage Server permission to configure Mines logging.');
    }

    const action = String(args[0] || 'on').toLowerCase();
    if (!['on', 'enable', 'off', 'disable', 'status'].includes(action)) {
      return message.reply('Usage: `~mineslog [on|off|status]`.');
    }

    try {
      const configKey = getMineLogConfigKey(message.guild.id);
      if (action === 'status') {
        const enabled = isMineLoggingEnabled(await getConfig(configKey));
        return message.reply(`Owo Mines logging is **${enabled ? 'enabled' : 'disabled'}** in this server.`);
      }

      const enabled = action === 'on' || action === 'enable';
      await setConfig(configKey, enabled ? 'true' : 'false');
      return message.reply(`Owo Mines logging is now **${enabled ? 'enabled' : 'disabled'}** in this server.`);
    } catch (error) {
      console.error(`Failed to update Owo Mines logging for guild ${message.guild.id}:`, error);
      return message.reply('Failed to update Owo Mines logging. Please try again later.');
    }
  }
};
