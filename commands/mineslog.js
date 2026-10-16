const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getConfig, setConfig } = require('../database');
const { hasCommandPermission } = require('../utils/owner');
const {
  getMineLogConfigKey,
  getMineLogSourceConfigKey,
  isMineLoggingEnabled,
  ensureMineLogChannel
} = require('../utils/mineLogger');

function resolveTextChannel(guild, input) {
  const value = String(input || '').trim();
  const channelId = value.match(/^<#(\d+)>$/)?.[1] || value;
  const byId = guild.channels.cache.get(channelId);
  if (byId?.type === ChannelType.GuildText) return byId;

  const name = value.replace(/^#/, '').toLowerCase();
  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name.toLowerCase() === name
  ) || null;
}

module.exports = {
  name: 'mineslog',
  aliases: ['ml'],
  description: 'Enable or disable logging of Owo Mines games in this server',
  usage: '~mineslog <channel #source-channel|on|off|status>',
  requiredPermissions: [PermissionFlagsBits.ManageGuild],

  async execute(message, args = []) {
    if (!message.guild) return message.reply('This command can only be used in a server.');
    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageGuild])) {
      return message.reply('You need Manage Server permission to configure Mines logging.');
    }

    const action = String(args[0] || 'on').toLowerCase();
    if (!['channel', 'on', 'enable', 'off', 'disable', 'status'].includes(action)) {
      return message.reply('Usage: `~mineslog channel #source-channel`, then `~mineslog on|off|status`.');
    }

    try {
      const configKey = getMineLogConfigKey(message.guild.id);
      const sourceConfigKey = getMineLogSourceConfigKey(message.guild.id);
      if (action === 'channel') {
        const sourceChannel = resolveTextChannel(message.guild, args[1]);
        if (!sourceChannel) {
          return message.reply('Provide a text channel in this server, such as `~mineslog channel #mines`.');
        }
        await setConfig(sourceConfigKey, sourceChannel.id);
        return message.reply(`Owo Mines logging will watch ${sourceChannel}. Run \`~mineslog on\` to enable logging.`);
      }

      if (action === 'status') {
        const enabled = isMineLoggingEnabled(await getConfig(configKey));
        const sourceChannelId = await getConfig(sourceConfigKey);
        const sourceChannel = sourceChannelId ? message.guild.channels.cache.get(sourceChannelId) : null;
        const sourceStatus = sourceChannel ? `${sourceChannel}` : 'not configured';
        return message.reply(`Owo Mines logging is **${enabled ? 'enabled' : 'disabled'}**. Source channel: ${sourceStatus}.`);
      }

      const enabled = action === 'on' || action === 'enable';
      if (enabled) {
        const sourceChannelId = await getConfig(sourceConfigKey);
        const sourceChannel = sourceChannelId ? message.guild.channels.cache.get(sourceChannelId) : null;
        if (!sourceChannel || sourceChannel.type !== ChannelType.GuildText) {
          return message.reply('Set a valid source channel first with `~mineslog channel #channel-name`.');
        }
        const logChannel = await ensureMineLogChannel(message.guild);
        await setConfig(configKey, 'true');
        return message.reply(`Owo Mines logging is enabled. Watching ${sourceChannel}; logs go to ${logChannel}.`);
      }

      await setConfig(configKey, 'false');
      return message.reply('Owo Mines logging is now **disabled** in this server.');
    } catch (error) {
      console.error(`Failed to update Owo Mines logging for guild ${message.guild.id}:`, error);
      return message.reply('Failed to update Owo Mines logging. Make sure I have Manage Channels and can view and send messages in `#mine-logs`, then try again.');
    }
  }
};
