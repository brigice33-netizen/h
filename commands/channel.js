const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { hasCommandPermission } = require('../utils/owner');

function normalizeChannelName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || null;
}

module.exports = {
  name: 'channel',
  aliases: ['cr', 'cc'],
  description: 'Create or rename a channel',
  usage: '~channel create <name> | ~cc <name> | ~channel rename <new-name> | ~cr <new-name>',
  requiredPermissions: [PermissionFlagsBits.ManageChannels],
  normalizeChannelName,

  async execute(message, args = []) {
    if (!message.guild || !message.channel) {
      return message.reply('❌ This command can only be used in a server channel.');
    }

    const invokedAsAlias = String(message.commandName || '').toLowerCase();
    const action = invokedAsAlias === 'cc' ? 'create' : invokedAsAlias === 'cr' ? 'rename' : String(args[0] || '').toLowerCase();
    if (!['create', 'rename'].includes(action)) {
      return message.reply('❌ Usage: `~channel create <name>` or `~channel rename <new-name>`.');
    }

    const nameArgs = invokedAsAlias === 'cc' || invokedAsAlias === 'cr'
      ? ['create', 'rename'].includes(String(args[0] || '').toLowerCase()) ? args.slice(1) : args
      : args.slice(1);
    const newName = normalizeChannelName(nameArgs.join(' '));
    if (!newName) {
      return message.reply('❌ Provide a valid new channel name.');
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageChannels])) {
      return message.reply(`❌ You need the Manage Channels permission to ${action} a channel.`);
    }

    if (!message.guild.members.me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply('❌ I need the Manage Channels permission to rename this channel.');
    }

    try {
      if (action === 'create') {
        const createdChannel = await message.guild.channels.create({
          name: newName,
          type: ChannelType.GuildText,
          reason: `Text channel created by ${message.author?.tag || message.author?.id || 'user'}`
        });
        return message.reply(`✅ Created text channel <#${createdChannel.id}>.`);
      }

      if (typeof message.channel.setName !== 'function') {
        return message.reply('❌ This channel cannot be renamed.');
      }

      await message.channel.setName(newName, `Channel renamed by ${message.author?.tag || message.author?.id || 'user'}`);
      return message.reply(`✅ Channel renamed to \`${newName}\`.`);
    } catch (error) {
      console.error('Failed to rename channel:', error);
      return message.reply('❌ Failed to rename this channel. Check my permissions and try again.');
    }
  }
};