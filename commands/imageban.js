const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  addBannedImage,
  getBannedImages,
  removeBannedImage,
  getConfig
} = require('../database');
const { createImageHash, isImageAttachment } = require('../utils/imageBan');
const { hasCommandPermission } = require('../utils/owner');

const LIST_PAGE_SIZE = 5;

function getImageAttachment(message) {
  return [...(message.attachments?.values?.() || [])].find(isImageAttachment) || null;
}

function getBanReason(args = []) {
  return args.slice(1).join(' ').trim();
}

function formatBannedImageEmbed(image) {
  const addedAt = image.createdAt
    ? new Date(`${image.createdAt.replace(' ', 'T')}Z`).toLocaleString()
    : 'Unknown';
  return new EmbedBuilder()
    .setColor('#D32F2F')
    .setTitle(`Banned image #${image.id}`)
    .setDescription(`**Reason:** ${image.reason || 'No reason recorded (legacy entry)'}\n**Added:** ${addedAt}\n**Added by:** ${image.addedBy ? `<@${image.addedBy}>` : 'Unknown'}`)
    .setImage(image.imageUrl);
}

module.exports = {
  name: 'imageban',
  aliases: ['bannedimage'],
  description: 'Add, list, or remove banned images with their reasons',
  usage: '~imageban <add|list|remove> [id] (attach image and give a reason for add)',
  requiredPermissions: [PermissionFlagsBits.ManageGuild],
  getImageAttachment,
  getBanReason,
  formatBannedImageEmbed,

  async execute(message, args = []) {
    if (!message.guild) return message.reply('This command can only be used in a server.');
    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageGuild])) {
      return message.reply('You need Manage Server permission to manage banned images.');
    }

    const action = String(args[0] || '').toLowerCase();
    try {
      if (action === 'add') {
        const attachment = getImageAttachment(message);
        if (!attachment) return message.reply('Attach an image to `~imageban add`.');
        const reason = getBanReason(args);
        if (!reason) {
          return message.reply('Provide a reason, for example: `~imageban add Repeatedly posted prohibited content`.');
        }
        if (reason.length > 500) return message.reply('Keep the image-ban reason to 500 characters or fewer.');
        const roleId = await getConfig(`imageban:${message.guild.id}:role`);
        if (!roleId || !message.guild.roles.cache.has(roleId)) {
          return message.reply('Run `~mikuset setup` first to configure image-ban enforcement.');
        }

        const response = await fetch(attachment.url);
        if (!response.ok) throw new Error(`Image download failed with status ${response.status}`);
        const imageHash = await createImageHash(Buffer.from(await response.arrayBuffer()));
        const record = await addBannedImage(
          message.guild.id,
          attachment.url,
          imageHash,
          message.author.id,
          reason
        );
        return message.reply({
          content: `Banned image #${record.id} added. Reason: **${reason}**. Similar uploads will be removed.`,
          allowedMentions: { parse: [] }
        });
      }

      if (action === 'list') {
        const images = await getBannedImages(message.guild.id);
        if (!images.length) return message.reply('No banned images are configured.');

        const page = Math.max(1, Number.parseInt(args[1], 10) || 1);
        const pageCount = Math.ceil(images.length / LIST_PAGE_SIZE);
        if (page > pageCount) return message.reply(`Choose a page from 1 to ${pageCount}.`);
        const pageImages = images.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE);
        return message.reply({
          embeds: pageImages.map(formatBannedImageEmbed),
          content: `Banned images — page ${page}/${pageCount}`,
          allowedMentions: { parse: [] }
        });
      }

      if (action === 'remove') {
        const id = Number.parseInt(args[1], 10);
        if (!Number.isInteger(id) || id < 1) return message.reply('Provide the banned image ID to remove.');
        const removed = await removeBannedImage(message.guild.id, id);
        return message.reply(removed ? `Removed banned image #${id}.` : 'That banned image was not found.');
      }

      return message.reply('Usage: `~imageban add <reason>` (attach image), `~imageban list [page]`, or `~imageban remove <id>`.');
    } catch (error) {
      console.error(`Image ban command failed in guild ${message.guild.id}:`, error);
      return message.reply('Image ban command failed. Check the image URL and bot permissions, then try again.');
    }
  }
};
