const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createImageHash, isImageAttachment } = require('../../utils/imageBan');
const { addBannedImage, getBannedImages, removeBannedImage, getAuditLogs, setConfig } = require('../../database');
const { ensureTicketLogChannel } = require('../../utils/ticketSystem');
const { hasCommandPermission } = require('../../utils/owner');

const ROLE_NAME = 'Hazardous';
const CHANNEL_NAME = 'hazardous-only';
const LOG_CHANNEL_NAME = 'miku-logs';
const AUTO_ROLE_NAME = 'Member';

async function ensureHazardousSetup(guild) {
  let role = guild.roles.cache.find((entry) => entry.name === ROLE_NAME);
  if (!role) role = await guild.roles.create({ name: ROLE_NAME, colors: { primaryColor: 0xD32F2F }, reason: 'Image ban hazardous access setup' });

  let channel = guild.channels.cache.find((entry) => entry.name === CHANNEL_NAME && entry.type === ChannelType.GuildText);
  if (!channel) {
    channel = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      permissionOverwrites: []
    });
  }

  await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }, { reason: 'Hazardous channel isolation' });
  await channel.permissionOverwrites.edit(role, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { reason: 'Hazardous channel access' });

  let logChannel = guild.channels.cache.find((entry) => entry.name === LOG_CHANNEL_NAME && entry.type === ChannelType.GuildText);
  if (!logChannel) {
    logChannel = await guild.channels.create({ name: LOG_CHANNEL_NAME, type: ChannelType.GuildText, permissionOverwrites: [] });
  }

  await logChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }, { reason: 'Miku audit log privacy' });
  for (const managerRole of guild.roles.cache.filter((entry) => entry.permissions.has(PermissionFlagsBits.ManageGuild)).values()) {
    await logChannel.permissionOverwrites.edit(managerRole, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, { reason: 'Miku audit log access' }).catch(() => {});
  }

  for (const currentChannel of guild.channels.cache.values()) {
    if (!currentChannel.permissionOverwrites?.edit || currentChannel.id === channel.id) continue;
    await currentChannel.permissionOverwrites.edit(role.id, { ViewChannel: false }, { reason: 'Hazardous role isolation' }).catch(() => {});
  }

  await setConfig(`imageban:${guild.id}:role`, role.id);
  await setConfig(`imageban:${guild.id}:channel`, channel.id);
  await setConfig(`imageban:${guild.id}:logs`, logChannel.id);
  return { role, channel, logChannel };
}

async function ensureAutoRole(guild) {
  let role = guild.roles.cache.find((entry) => entry.name === AUTO_ROLE_NAME && !entry.managed);
  if (!role) {
    role = await guild.roles.create({ name: AUTO_ROLE_NAME, colors: { primaryColor: 0x5865F2 }, reason: 'Configured automatic member role' });
  }
  await setConfig(`autorole:${guild.id}`, role.id);
  return role;
}

function getAttachment(message) {
  return [...(message.attachments?.values?.() || [])].find(isImageAttachment);
}

module.exports = {
  name: 'mikuset',
  aliases: ['imageban', 'bannedimage', 'hazardsetup', 'miku'],
  description: 'Set up hazardous image isolation and manage banned images',
  usage: '~mikuset <setup|add|list|remove> [id] (attach an image for add)',
  requiredPermissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels],

  async execute(message, args = []) {
    if (!message.guild) return message.reply('This command can only be used in a server.');
    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageGuild])) return message.reply('You need Manage Server to use this command.');
    const action = String(args[0] || 'setup').toLowerCase();

    try {
      if (action === 'set') {
        const ticketLogChannel = await ensureTicketLogChannel(message.guild);
        return message.reply(`✅ Ticket log channel is ready: ${ticketLogChannel}`);
      }
      if (action === 'setup') {
        const { role, channel, logChannel } = await ensureHazardousSetup(message.guild);
        const autoRole = await ensureAutoRole(message.guild);
        return message.reply({ embeds: [new EmbedBuilder().setColor('#D32F2F').setTitle('Miku protection ready').setDescription(`Hazardous role: <@&${role.id}>\nPrivate channel: ${channel}\nAudit logs: ${logChannel}\nAuto role: <@&${autoRole.id}>\nUse \`~mikuset add\` with an attached image to ban it.`)] });
      }

      if (action === 'autorole') {
        const roleArg = args[1];
        if (/^(off|disable|none)$/i.test(roleArg || '')) {
          await setConfig(`autorole:${message.guild.id}`, '');
          return message.reply('Automatic member role disabled.');
        }
        const roleId = roleArg?.match(/^<@&?(\d+)>$/)?.[1] || roleArg;
        const autoRole = message.guild.roles.cache.get(roleId) || await ensureAutoRole(message.guild);
        if (!autoRole || autoRole.managed) return message.reply('Please provide a normal, assignable role.');
        if (autoRole.position >= message.guild.members.me.roles.highest.position) return message.reply('That role is above my highest role, so I cannot assign it.');
        await setConfig(`autorole:${message.guild.id}`, autoRole.id);
        return message.reply(`Automatic member role set to ${autoRole}.`);
      }

      if (action === 'add') {
        const attachment = getAttachment(message);
        if (!attachment) return message.reply('Attach an image to `mikuset add`.');
        await ensureHazardousSetup(message.guild);
        const response = await fetch(attachment.url);
        if (!response.ok) return message.reply('I could not download that image.');
        const imageHash = await createImageHash(Buffer.from(await response.arrayBuffer()));
        const record = await addBannedImage(message.guild.id, attachment.url, imageHash, message.author.id);
        return message.reply(`Banned image #${record.id} added. Similar uploads will receive the hazardous role.`);
      }

      const images = await getBannedImages(message.guild.id);
      if (action === 'list') {
        return message.reply(images.length ? images.map((image) => `#${image.id} - ${image.imageUrl}`).join('\n') : 'No banned images are configured.');
      }

      if (action === 'remove') {
        const id = Number.parseInt(args[1], 10);
        if (!Number.isInteger(id)) return message.reply('Provide the banned image id to remove.');
        const removed = await removeBannedImage(message.guild.id, id);
        return message.reply(removed ? `Removed banned image #${id}.` : 'That banned image was not found.');
      }

      if (action === 'logs') {
        const logs = await getAuditLogs(message.guild.id, 20);
        if (!logs.length) return message.reply('No persisted audit logs found.');
        const description = logs.map((log) => `**${log.title}** - ${log.createdAt}\n${log.description || '*empty*'}`).join('\n\n').slice(0, 3900);
        return message.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('Recent Miku audit logs').setDescription(description)] });
      }

      return message.reply('Usage: `~mikuset <setup|autorole|add|list|remove|logs> [role|id]`');
    } catch (error) {
      console.error('Image ban setup failed:', error);
      return message.reply('Image ban setup failed. Check that I have Manage Roles and Manage Channels permissions.');
    }
  }
};
