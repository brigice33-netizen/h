const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getWarnings, deleteWarnings, deleteWarningById } = require('../../database');
const { authorizeOwnerCommand, hasCommandPermission } = require('../../utils/owner');

function formatWarning(entry) {
  const timestamp = entry.timestamp ? ` • ${new Date(entry.timestamp).toLocaleString()}` : '';
  return `#${entry.id} • Warned by <@${entry.moderatorId}>${timestamp}\n  Reason: ${entry.reason || 'No reason provided'}`;
}

module.exports = {
  name: 'warnings',
  aliases: ['warns'],
  description: 'View warnings for a mentioned user',
  usage: '~warnings @user [limit]',
  requiredPermissions: [PermissionFlagsBits.ManageMessages],

  async execute(message, args) {
    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    if (!(await authorizeOwnerCommand(message, { commandName: 'warnings', requiredPermissions: [PermissionFlagsBits.ManageMessages], requireApproval: true }))) {
      return;
    }

    if (!hasCommandPermission(message, [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers])) {
      return message.reply('❌ You do not have permission to view warnings.');
    }

    const mentionedMember = message.mentions.members.first() || message.guild.members.cache.get(args.find((a) => /^(?:<@!?)?\d+(?:>)?$/.test(a))?.replace(/[^0-9]/g, ''));
    if (!mentionedMember) {
      return message.reply('❌ Please mention a member or provide their ID to view their warnings.');
    }

    const removeFlag = args.some((a) => /^(remove|clear)$/i.test(a));
    const idToken = args.find((a) => /^id:\d+$/i.test(a));
    let idArg = null;
    if (idToken) idArg = Number(idToken.split(':')[1]);

    // If removing and a plain digit is provided, treat it as a warning id
    const plainDigit = args.find((a) => /^\d+$/.test(a));
    if (removeFlag && !idArg && plainDigit) idArg = Number(plainDigit);

    const limit = Math.min(Math.max(parseInt([...args].reverse().find((arg) => /^\d+$/.test(arg)) || '10', 10), 1), 20);

    try {
      if (removeFlag) {
        // Fetch warnings to validate id and to show counts
        const allWarnings = await getWarnings({ guildId: message.guild.id, userId: mentionedMember.id, limit: 100 });

        if (idArg) {
          const found = allWarnings.find((w) => Number(w.id) === Number(idArg));
          if (!found) {
            await message.reply(`❌ Warning with ID ${idArg} not found for that user.`).catch(() => {});
          } else {
            const confirmMsg = await message.reply(`Are you sure you want to delete warning #${idArg} for ${mentionedMember.user.tag}? Reply with \`yes\` to confirm within 30 seconds.`).catch(() => null);
            try {
              const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id && /^y(?:es)?$/i.test(m.content), max: 1, time: 30000, errors: ['time'] });
              if (collected && collected.first()) {
                const removed = await deleteWarningById(message.guild.id, idArg);
                await message.reply(`✅ Removed ${removed} warning(s) (ID ${idArg}) for ${mentionedMember.user.tag}.`).catch(() => {});
              }
            } catch (err) {
              await message.reply('❌ Deletion cancelled (no confirmation).').catch(() => {});
            }
          }
        } else {
          const confirmMsg = await message.reply(`Are you sure you want to delete ALL warnings for ${mentionedMember.user.tag}? Reply with \`yes\` to confirm within 30 seconds.`).catch(() => null);
          try {
            const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id && /^y(?:es)?$/i.test(m.content), max: 1, time: 30000, errors: ['time'] });
            if (collected && collected.first()) {
              const removed = await deleteWarnings(message.guild.id, mentionedMember.id);
              await message.reply(`✅ Removed ${removed} warning(s) for ${mentionedMember.user.tag}.`).catch(() => {});
            }
          } catch (err) {
            await message.reply('❌ Deletion cancelled (no confirmation).').catch(() => {});
          }
        }
      }

      const warnings = await getWarnings({
        guildId: message.guild.id,
        userId: mentionedMember.id,
        limit
      });

      const warningText = warnings.length > 0
        ? warnings.map(formatWarning).join('\n')
        : 'No warnings found for this user.';

      const embed = new EmbedBuilder()
        .setColor('#FFB347')
        .setTitle(`🧾 Warnings for ${mentionedMember.user.tag}`)
        .setDescription(`Showing up to ${limit} warning(s).`)
        .addFields({ name: 'Warnings', value: warningText.slice(0, 1024), inline: false })
        .setFooter({ text: `Total warnings returned: ${warnings.length}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await message.reply('❌ Failed to load or modify warnings for that user.');
    }
  }
};
