const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand } = require('../../utils/owner');

module.exports = {
  name: 'setprefix',
  aliases: ['prefix'],
  description: 'Change the bot prefix (owner only)',
  ownerOnly: true,
  usage: '~setprefix <new prefix>',

  async execute(message, args, client) {
    if (!(await authorizeOwnerCommand(message, { commandName: 'setprefix', requiredPermissions: [PermissionFlagsBits.ManageGuild], requireApproval: true }))) {
      return;
    }

    const newPrefix = args[0];
    if (!newPrefix) {
      return message.reply('❌ Please provide a new prefix.');
    }

    if (newPrefix.length > 5) {
      return message.reply('❌ Prefix must be 1-5 characters.');
    }

    if (/\s/.test(newPrefix)) {
      return message.reply('❌ Prefix cannot contain spaces.');
    }

    const envPath = path.join(__dirname, '..', '..', '.env');
    try {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (/^PREFIX=.*$/m.test(envContent)) {
        envContent = envContent.replace(/^PREFIX=.*$/m, () => `PREFIX=${newPrefix}`);
      } else {
        envContent += `\nPREFIX=${newPrefix}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');

      process.env.PREFIX = newPrefix;
      if (client) {
        client.prefix = newPrefix;
      }

      const embed = new EmbedBuilder()
        .setColor('#F2C94C')
        .setTitle('✅ Prefix Updated')
        .setDescription(`Bot prefix has been changed to \`${newPrefix}\`.`)
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to update prefix:', error);
      await message.reply('❌ Unable to update the prefix right now.');
    }
  }
};
