const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');
const { sendAdminProgressDm } = require('../../utils/adminProgress');
const { getProtectedGuildIds } = require('../../utils/safety');

const CONFIRMATION = 'RESET SERVER';

module.exports = {
  name: 'reset',
  aliases: ['resetserver'],
  description: 'Delete all deletable channels and roles from a specified server',
  ownerOnly: true,
  usage: '~reset <guild-id> RESET SERVER',

  async execute(message, args = []) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    const protectedGuildIds = getProtectedGuildIds(process.env);
    if (protectedGuildIds.length === 0) {
      return message.reply('🛡️ Reset is disabled because no protected guild is configured.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'reset', requiredPermissions: [PermissionFlagsBits.Administrator], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.Administrator])) {
      return message.reply('❌ You need Administrator permission to reset a server.');
    }

    const targetGuildId = String(args[0] || '').trim();
    const confirmation = args.slice(1).join(' ').trim().toUpperCase();
    if (!/^\d{17,20}$/.test(targetGuildId) || confirmation !== CONFIRMATION) {
      return message.reply('❌ Usage: `~reset <guild-id> RESET SERVER`\nThe guild ID and exact confirmation phrase are required.');
    }

    if (protectedGuildIds.includes(targetGuildId)) {
      return message.reply('🛡️ I will not reset the protected server.');
    }

    const targetGuild = message.client.guilds.cache.get(targetGuildId);
    if (!targetGuild) {
      return message.reply('❌ I am not currently in a server with that ID. Use `~serverlist` first.');
    }

    if (!targetGuild.members.me?.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ I need Administrator permission in the target server to reset it.');
    }

    let progressMessage;
    try {
      progressMessage = await sendAdminProgressDm(message, {
        embeds: [
          new EmbedBuilder()
            .setColor('#FF9800')
            .setTitle('⚠️ Server Reset Started')
            .setDescription(`Deleting channels and roles from **${targetGuild.name}**.`)
            .setFooter({ text: 'The protected @everyone role cannot be deleted.' })
            .setTimestamp()
        ]
      });
    } catch {
      return message.reply('❌ I could not open your DMs, so the reset was not started.');
    }

    let deletedChannels = 0;
    let deletedRoles = 0;
    let skippedChannels = 0;
    let skippedRoles = 0;
    let deletedEmojis = 0;
    let skippedEmojis = 0;
    let deletedStickers = 0;
    let skippedStickers = 0;

    try {
      const channels = await targetGuild.channels.fetch();
      for (const channel of channels.values()) {
        try {
          await channel.delete('Server reset command');
          deletedChannels += 1;
        } catch (error) {
          skippedChannels += 1;
          console.error(`Failed to delete channel ${channel.id}:`, error);
        }
      }

      const roles = await targetGuild.roles.fetch();
      for (const role of roles.values()) {
        if (role.id === targetGuild.id || role.managed || !role.editable) {
          skippedRoles += 1;
          continue;
        }

        try {
          await role.delete('Server reset command');
          deletedRoles += 1;
        } catch (error) {
          skippedRoles += 1;
          console.error(`Failed to delete role ${role.id}:`, error);
        }
      }

      const emojis = await targetGuild.emojis.fetch();
      for (const emoji of emojis.values()) {
        try {
          await emoji.delete('Server reset command');
          deletedEmojis += 1;
        } catch (error) {
          skippedEmojis += 1;
          console.error(`Failed to delete emoji ${emoji.id}:`, error);
        }
      }

      const stickers = await targetGuild.stickers.fetch();
      for (const sticker of stickers.values()) {
        try {
          await sticker.delete('Server reset command');
          deletedStickers += 1;
        } catch (error) {
          skippedStickers += 1;
          console.error(`Failed to delete sticker ${sticker.id}:`, error);
        }
      }

      const embed = new EmbedBuilder()
        .setColor('#43A047')
        .setTitle('✅ Server Reset Complete')
        .setDescription(`Reset **${targetGuild.name}**.`)
        .addFields(
          { name: 'Channels Deleted', value: String(deletedChannels), inline: true },
          { name: 'Roles Deleted', value: String(deletedRoles), inline: true },
          { name: 'Channels Skipped', value: String(skippedChannels), inline: true },
          { name: 'Roles Skipped', value: String(skippedRoles), inline: true },
          { name: 'Emojis Deleted', value: String(deletedEmojis), inline: true },
          { name: 'Emojis Skipped', value: String(skippedEmojis), inline: true },
          { name: 'Stickers Deleted', value: String(deletedStickers), inline: true },
          { name: 'Stickers Skipped', value: String(skippedStickers), inline: true }
        )
        .setTimestamp();

      await progressMessage.edit({ embeds: [embed] }).catch(async () => {
        await sendAdminProgressDm(message, { embeds: [embed] }).catch(() => {});
      });
    } catch (error) {
      console.error(`Failed to reset guild ${targetGuildId}:`, error);
      await sendAdminProgressDm(message, '❌ The server reset stopped because Discord returned an error.').catch(() => {});
    }
  }
};