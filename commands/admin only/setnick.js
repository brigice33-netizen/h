const { EmbedBuilder } = require('discord.js');
const { setLockedNickname } = require('../../database');
const { PermissionFlagsBits } = require('discord.js');
const { isProtectedNicknameTarget } = require('../../utils/protectedNicknames');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

module.exports = {
  name: 'setnick',
  aliases: ['sn'],
  description: 'Set and lock a member nickname so they cannot change it',
  usage: '~setnick @user <nickname>',
  requiredPermissions: [PermissionFlagsBits.ManageNicknames],

  async execute(message, args) {
    if (!(await authorizeOwnerCommand(message, { commandName: 'setnick', requiredPermissions: [PermissionFlagsBits.ManageNicknames] }))) {
      return;
    }

    if (!message.guild) {
      return message.reply('❌ This command must be used in a server.');
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageNicknames])) {
      return message.reply('❌ You need Manage Nicknames to use this command.');
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]?.replace(/[^0-9]/g, ''));
    if (!target) {
      return message.reply('❌ Please mention a member or provide their ID to lock a nickname for.');
    }

    if (isProtectedNicknameTarget(target.id)) {
      return message.reply('❌ This member cannot be managed with setnick.');
    }

    const nickname = args.slice(1).join(' ').trim();
    if (!nickname) {
      return message.reply('❌ Please provide a nickname. Use `clear` to remove the lock.');
    }

    if (nickname.toLowerCase() === 'clear') {
      await setLockedNickname(message.guild.id, target.id, null);
      return message.reply(`✅ Removed nickname lock for ${target}. Their current nickname has been left intact.`);
    }

    try {
      await target.setNickname(nickname);
      await setLockedNickname(message.guild.id, target.id, nickname);

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('👑 Nickname Locked')
        .addFields(
          { name: 'User', value: `${target}`, inline: true },
          { name: 'Locked Nickname', value: `${nickname}`, inline: true }
        )
        .setFooter({ text: 'This nickname is now locked and cannot be changed by the member.' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Failed to set locked nickname:', error);
      await message.reply('❌ Unable to set the nickname or lock it. Please ensure I have Manage Nicknames permission.');
    }
  }
};
