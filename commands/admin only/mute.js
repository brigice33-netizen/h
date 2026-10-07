const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

function parseDuration(duration) {
  const match = duration?.toString().match(/^(\d+)([smhd])$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

module.exports = {
  name: 'mute',
  description: 'Mute a member by applying a Muted role or using timeout',
  usage: '~mute @user <duration|permanent> [reason]',
  requiredPermissions: [PermissionFlagsBits.ManageRoles],

  async execute(message, args) {
    if (!message.guild) return message.reply('❌ This command can only be used in a server.');

    if (!(await authorizeOwnerCommand(message, { commandName: 'mute', requiredPermissions: [PermissionFlagsBits.ManageRoles], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ModerateMembers])) {
      return message.reply('❌ You do not have permission to mute members.');
    }

    const botHasManageRoles = message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles);
    const botHasModerate = message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers);
    if (!botHasManageRoles && !botHasModerate) {
      return message.reply('❌ I need either Manage Roles or Moderate Members permission to mute members.');
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]?.replace(/[^0-9]/g, ''));
    if (!target) return message.reply('❌ Please mention a member or provide their ID to mute.');

    const durationArg = args[1];
    const durationMs = parseDuration(durationArg);
    const reason = args.slice(durationArg ? 2 : 1).join(' ') || 'No reason provided';

    try {
      if (durationMs && botHasModerate) {
        if (!target.moderatable) return message.reply('❌ I cannot timeout that member.');
        await target.timeout(durationMs, reason);
        const embed = new EmbedBuilder()
          .setColor('#8A2BE2')
          .setTitle('🔇 Member Muted (timeout)')
          .addFields(
            { name: 'User', value: `${target.user.tag}`, inline: true },
            { name: 'Duration', value: durationArg, inline: true },
            { name: 'Reason', value: reason, inline: true }
          )
          .setTimestamp();
        return await message.reply({ embeds: [embed] });
      }

      // Apply or create Muted role
      let mutedRole = message.guild.roles.cache.find(r => r.name === 'Muted');
      if (!mutedRole && botHasManageRoles) {
        try {
          mutedRole = await message.guild.roles.create({ name: 'Muted', permissions: [] });

          // Configure channel overwrites for Muted role if bot can manage channels
          if (message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            for (const channel of message.guild.channels.cache.values()) {
              // Only apply to common guild channel types
              if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildCategory].includes(channel.type)) continue;

              try {
                if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(channel.type)) {
                  await channel.permissionOverwrites.edit(mutedRole.id, {
                    SendMessages: false,
                    AddReactions: false,
                    CreatePublicThreads: false,
                    CreatePrivateThreads: false,
                    SendMessagesInThreads: false
                  }, { reason: 'Configure Muted role' }).catch(() => {});
                } else if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
                  await channel.permissionOverwrites.edit(mutedRole.id, {
                    Speak: false,
                    Connect: false
                  }, { reason: 'Configure Muted role' }).catch(() => {});
                } else if (channel.type === ChannelType.GuildCategory) {
                  await channel.permissionOverwrites.edit(mutedRole.id, {
                    SendMessages: false,
                    AddReactions: false
                  }, { reason: 'Configure Muted role' }).catch(() => {});
                }
              } catch (err) {
                // ignore per-channel errors
              }
            }
          }
        } catch (err) {
          console.error('Failed to create Muted role:', err);
        }
      }

      if (mutedRole) {
        if (!target.roles.cache.has(mutedRole.id)) {
          await target.roles.add(mutedRole, reason);
        } else {
          return message.reply('❌ That member is already muted (has Muted role).');
        }

        const embed = new EmbedBuilder()
          .setColor('#8A2BE2')
          .setTitle('🔇 Member Muted')
          .addFields(
            { name: 'User', value: `${target.user.tag}`, inline: true },
            { name: 'Reason', value: reason, inline: true }
          )
          .setTimestamp();

        return await message.reply({ embeds: [embed] });
      }

      // Fallback: if no Muted role and cannot create, try timeout without duration
      if (botHasModerate) {
        await target.timeout(24 * 60 * 60 * 1000, reason); // 1 day
        const embed = new EmbedBuilder()
          .setColor('#8A2BE2')
          .setTitle('🔇 Member Muted (1 day timeout fallback)')
          .addFields(
            { name: 'User', value: `${target.user.tag}`, inline: true },
            { name: 'Reason', value: reason, inline: true }
          )
          .setTimestamp();

        return await message.reply({ embeds: [embed] });
      }

      return message.reply('❌ Could not mute the member (missing permissions).');
    } catch (error) {
      console.error(error);
      return message.reply('❌ Failed to mute the member.');
    }
  }
};
