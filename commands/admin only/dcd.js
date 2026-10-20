const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, setConfig } = require('../../database');
const { authorizeOwnerCommand } = require('../../utils/owner');
const { CONTAINER_DROPS_CONFIG_KEY, isDropEnabled } = require('../../utils/dropControls');

module.exports = {
  name: 'dcd',
  description: 'Enable or disable automatic bait container drops',
  ownerOnly: true,
  usage: '~dcd [on|off|status]',
  requiredPermissions: [PermissionFlagsBits.ManageGuild],

  async execute(message, args = []) {
    if (!(await authorizeOwnerCommand(message, {
      commandName: 'dcd',
      requiredPermissions: [PermissionFlagsBits.ManageGuild],
      requireApproval: true
    }))) {
      return;
    }

    const action = String(args[0] || 'off').toLowerCase();
    if (!['on', 'off', 'status'].includes(action)) {
      return message.reply('Usage: `~dcd [on|off|status]`.');
    }

    const currentlyEnabled = isDropEnabled(await getConfig(CONTAINER_DROPS_CONFIG_KEY));
    if (action === 'status') {
      return message.reply(`Automatic bait container drops are **${currentlyEnabled ? 'enabled' : 'disabled'}**.`);
    }

    const enabled = action === 'on';
    if (enabled === currentlyEnabled) {
      return message.reply(`Automatic bait container drops are already ${enabled ? 'enabled' : 'disabled'}.`);
    }

    await setConfig(CONTAINER_DROPS_CONFIG_KEY, enabled ? 'true' : 'false');
    const embed = new EmbedBuilder()
      .setColor(enabled ? '#00FF00' : '#FF4500')
      .setTitle(enabled ? 'Container Drops Enabled' : 'Container Drops Disabled')
      .setDescription(`Automatic bait container drops are now **${enabled ? 'enabled' : 'disabled'}**.`)
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};
