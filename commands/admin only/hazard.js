const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('../../database');
const { hasCommandPermission } = require('../../utils/owner');

const HAZARDOUS_ROLE_NAME = 'Hazardous';

module.exports = {
  name: 'hazard',
  aliases: ['hazardous', 'hazardrole'],
  description: 'Give a member the Hazardous role and restrict them to the hazardous channel',
  usage: '~hazard @user',
  requiredPermissions: [PermissionFlagsBits.ManageRoles],

  async execute(message, args = []) {
    if (!message.guild) return message.reply('This command can only be used in a server.');
    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageRoles])) return message.reply('You need Manage Roles to use this command.');

    const target = message.mentions.members.first() || message.guild.members.cache.get(String(args[0] || '').replace(/\D/g, ''));
    if (!target) return message.reply('Usage: `~hazard @user`');
    if (target.id === message.guild.ownerId) return message.reply('The server owner cannot be given the Hazardous role.');
    if (target.id === message.client.user?.id) return message.reply('I cannot give the Hazardous role to myself.');

    const configuredRoleId = await getConfig(`imageban:${message.guild.id}:role`);
    const hazardousRole = (configuredRoleId && message.guild.roles.cache.get(configuredRoleId))
      || message.guild.roles.cache.find((role) => role.name === HAZARDOUS_ROLE_NAME && !role.managed);
    const botMember = message.guild.members.me;

    if (!hazardousRole) return message.reply('The Hazardous role is not configured. Run `~mikuset setup` first.');
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('I need Manage Roles permission to apply the Hazardous role.');
    if (hazardousRole.position >= botMember.roles.highest.position) return message.reply('The Hazardous role is above my highest role, so I cannot apply it.');
    if (target.roles.cache.has(hazardousRole.id)) return message.reply(`${target} already has the Hazardous role.`);

    try {
      await target.roles.add(hazardousRole, `Hazardous role applied by ${message.author.tag}`);
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor('#D32F2F')
          .setTitle('Hazardous role applied')
          .setDescription(`${target} can now only access the hazardous channel.`)
          .setTimestamp()]
      });
    } catch (error) {
      console.error('Failed to apply Hazardous role:', error);
      return message.reply('I could not apply the Hazardous role. Check my role position and permissions.');
    }
  }
};
