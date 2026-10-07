const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { hasCommandPermission } = require('../../utils/owner');

function resolveRole(guild, value) {
  const rawValue = String(value || '').trim();
  const roleId = rawValue.match(/^<@&(\d+)>$/)?.[1] || rawValue;
  const normalizedName = rawValue.replace(/\s+/g, ' ').toLowerCase();
  return guild.roles.cache.get(roleId) || guild.roles.cache.find((role) => role.name.trim().replace(/\s+/g, ' ').toLowerCase() === normalizedName);
}

module.exports = {
  resolveRole,
  name: 'role',
  aliases: ['r'],
  description: 'Add, remove, or inspect a member role',
  usage: '~role <add|remove|list> @user @role',
  requiredPermissions: [PermissionFlagsBits.ManageRoles],

  async execute(message, args = []) {
    if (!message.guild) return message.reply('This command can only be used in a server.');
    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageRoles])) return message.reply('You need Manage Roles to use this command.');
    const action = String(args[0] || '').toLowerCase();
    const target = message.mentions.members.first() || message.guild.members.cache.get(args[1]?.replace(/\D/g, ''));
    if (action === 'list') {
      const member = target || message.member;
      return message.reply(`${member} roles: ${member.roles.cache.filter((role) => role.id !== message.guild.id).map((role) => role.name).join(', ') || 'none'}`);
    }
    if (!['add', 'remove'].includes(action) || !target) return message.reply('Usage: `~role <add|remove|list> @user @role`');
    const roleArg = args.slice(2).join(' ') || message.mentions.roles.first()?.id;
    const role = message.mentions.roles?.first() || resolveRole(message.guild, roleArg);
    if (!role || role.managed) return message.reply('Please provide a normal, assignable role.');
    if (role.position >= message.guild.members.me.roles.highest.position) return message.reply('That role is above my highest role, so I cannot manage it.');
    if (action === 'add') await target.roles.add(role, `Role added by ${message.author.tag}`);
    else await target.roles.remove(role, `Role removed by ${message.author.tag}`);
    return message.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setDescription(`${action === 'add' ? 'Added' : 'Removed'} ${role} ${action === 'add' ? 'to' : 'from'} ${target}.`)] });
  }
};