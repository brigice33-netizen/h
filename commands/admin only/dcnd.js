const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, setConfig } = require('../../database');
const { authorizeOwnerCommand } = require('../../utils/owner');
const { COIN_DROPS_CONFIG_KEY, isDropEnabled } = require('../../utils/dropControls');

module.exports = {
  name: 'dcnd',
  description: 'Enable or disable automatic coin drops',
  ownerOnly: true,
  usage: '~dcnd [on|off|status]',
  requiredPermissions: [PermissionFlagsBits.ManageGuild],

  async execute(message, args = []) {
    if (!(await authorizeOwnerCommand(message, {
      commandName: 'dcnd',
      requiredPermissions: [PermissionFlagsBits.ManageGuild],
      requireApproval: true
    }))) {
      return;
    }

    const action = String(args[0] || 'off').toLowerCase();
    if (!['on', 'off', 'status'].includes(action)) {
      return message.reply('Usage: `~dcnd [on|off|status]`.');
    }

    const currentlyEnabled = isDropEnabled(await getConfig(COIN_DROPS_CONFIG_KEY));
    if (action === 'status') {
      return message.reply(`Automatic coin drops are **${currentlyEnabled ? 'enabled' : 'disabled'}**.`);
    }

    const enabled = action === 'on';
    if (enabled === currentlyEnabled) {
      return message.reply(`Automatic coin drops are already ${enabled ? 'enabled' : 'disabled'}.`);
    }

    await setConfig(COIN_DROPS_CONFIG_KEY, enabled ? 'true' : 'false');
    const embed = new EmbedBuilder()
      .setColor(enabled ? '#00FF00' : '#FF4500')
      .setTitle(enabled ? 'Coin Drops Enabled' : 'Coin Drops Disabled')
      .setDescription(`Automatic coin drops are now **${enabled ? 'enabled' : 'disabled'}**.`)
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};
