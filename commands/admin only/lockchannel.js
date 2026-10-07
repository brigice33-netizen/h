const { EmbedBuilder, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { hasCommandPermission } = require('../../utils/owner');

const STATES_PATH = path.join(__dirname, '..', '..', 'data', 'lockchannel_states.json');
let savedStates = {};
try {
  if (fs.existsSync(STATES_PATH)) {
    savedStates = JSON.parse(fs.readFileSync(STATES_PATH, 'utf8') || '{}') || {};
  }
} catch (e) {
  console.error('Failed to load lockchannel states:', e);
  savedStates = {};
}

function persistStates() {
  try {
    const folder = path.dirname(STATES_PATH);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(STATES_PATH, JSON.stringify(savedStates, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to persist lockchannel states:', e);
  }
}

module.exports = {
  name: 'lockchannel',
  aliases: ['lockc', 'lockchan', 'lock'],
  description: 'Lock or unlock a single channel (affects only that channel)',
  usage: '~lockchannel <lock|unlock|status> [#channel|channelId|here]',
  requiredPermissions: [PermissionFlagsBits.ManageChannels],

  async execute(message, args = []) {
    if (!message.guild) return message.reply('❌ This command can only be used in a server.');

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageChannels])) {
      return message.reply('❌ You do not have permission to use this command.');
    }

    const sub = (args[0] || '').toLowerCase();
    if (!sub || !['lock', 'unlock', 'status'].includes(sub)) {
      return message.reply('❌ Usage: `~lockchannel <lock|unlock|status> [#channel|channelId|here]`');
    }

    const channelArg = args[1];
    let targetChannel = null;
    if (!channelArg || channelArg === 'here') {
      targetChannel = message.channel;
    } else {
      targetChannel = message.mentions.channels.first() || message.guild.channels.cache.get(channelArg) || message.channel;
    }

    if (!targetChannel) {
      return message.reply('❌ Could not resolve the target channel.');
    }

    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply('❌ I need the Manage Channels permission to change channel overwrites.');
    }

    const reason = `${sub} requested by ${message.author.tag}`;

    try {
      const everyoneRole = message.guild.roles.everyone;
      const currentOverwrite = targetChannel.permissionOverwrites.cache.get(everyoneRole.id);

      if (sub === 'status') {
        const denied = currentOverwrite ? currentOverwrite.deny.has(PermissionFlagsBits.SendMessages) : false;
        const embed = new EmbedBuilder()
          .setColor(denied ? '#FB8C00' : '#43A047')
          .setTitle(denied ? '🔒 Channel Locked' : '🔓 Channel Unlocked')
          .setDescription(`${targetChannel} is currently **${denied ? 'locked' : 'unlocked'}** for @everyone.`)
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      }

      // Confirmation prompt
      const confirmMsg = await message.reply(`⚠️ Please confirm by replying \`yes\` within 30 seconds to ${sub} ${targetChannel}.`);
      const filter = (m) => m.author.id === message.author.id && /^yes$/i.test(m.content.trim());
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);
      if (!collected || collected.size === 0) {
        return message.reply('❌ Confirmation not received — cancelled.');
      }

      if (sub === 'lock') {
        // Save current overwrites for full restore later
        const saves = [];
        for (const ow of targetChannel.permissionOverwrites.cache.values()) {
          saves.push({ id: ow.id, type: ow.type, allow: ow.allow.toArray(), deny: ow.deny.toArray() });
        }
        savedStates[`${message.guild.id}-${targetChannel.id}`] = { savedAt: Date.now(), overwrites: saves };
        persistStates();

        // Apply lock: explicitly deny SendMessages and AddReactions for @everyone
        await targetChannel.permissionOverwrites.edit(everyoneRole, { SendMessages: false, AddReactions: false }, { reason });
        const embed = new EmbedBuilder()
          .setColor('#FB8C00')
          .setTitle('🔒 Channel Locked')
          .setDescription(`${targetChannel} has been locked for @everyone.`)
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      }

      if (sub === 'unlock') {
        const key = `${message.guild.id}-${targetChannel.id}`;
        const saved = savedStates[key];
        if (saved && Array.isArray(saved.overwrites)) {
          // Restore saved overwrites fully
          const toSet = saved.overwrites.map((o) => ({ id: o.id, allow: o.allow || [], deny: o.deny || [] }));
          await targetChannel.permissionOverwrites.set(toSet, reason);
          delete savedStates[key];
          persistStates();

          const embed = new EmbedBuilder()
            .setColor('#43A047')
            .setTitle('🔓 Channel Unlocked')
            .setDescription(`${targetChannel} permissions have been restored to their previous state.`)
            .setTimestamp();
          return message.reply({ embeds: [embed] });
        }

        // Fallback: clear explicit denies for @everyone
        await targetChannel.permissionOverwrites.edit(everyoneRole, { SendMessages: null, AddReactions: null }, { reason });
        const embed = new EmbedBuilder()
          .setColor('#43A047')
          .setTitle('🔓 Channel Unlocked')
          .setDescription(`${targetChannel} has been unlocked for @everyone.`)
          .setTimestamp();
        return message.reply({ embeds: [embed] });
      }
    } catch (err) {
      console.error('Failed to change channel lock:', err);
      return message.reply('❌ Failed to change channel lock — ensure I have Manage Channels permission and the channel is valid.');
    }
  }
};
