const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { authorizeOwnerCommand, grantTempAccess, grantAllTempAccess, isTempAccessGranted } = require('../../utils/owner');

const RESTRICTED_COMMANDS = new Set([
  'lockdown', 'nuke', 'paste', 'reset', 'resetserver', 'restore', 'serverlist', 'sl', 'snapshot', 'economysnapshot',
  'saveeconomy', 'leaveserver', 'ls', 'copy', 'banall', 'baneveryone', 'antinuke', 'raidguard', 'antiraid', 'massban'
]);

function normalizeCommandName(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function getAllCommandAccessNames(startDir = path.join(__dirname, '..', '..', 'commands'), names = new Set()) {
  const entries = fs.readdirSync(startDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      getAllCommandAccessNames(entryPath, names);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue;
    }

    try {
      const commandModule = require(entryPath);
      if (commandModule?.name) {
        names.add(String(commandModule.name).trim().toLowerCase());
      }
      if (Array.isArray(commandModule?.aliases)) {
        for (const alias of commandModule.aliases) {
          if (alias) {
            names.add(String(alias).trim().toLowerCase());
          }
        }
      }
    } catch (error) {
      console.error(`Failed to inspect command module for grantaccess: ${entryPath}`, error);
    }
  }

  return [...names].filter(Boolean);
}

function getRequestedGrantCommands(requestedCommands) {
  const availableCommands = new Set(getAllCommandAccessNames());
  const grantAll = requestedCommands.includes('all');
  const uniqueCommands = [...new Set(requestedCommands.filter((value) => value !== 'all'))];
  const isGrantable = (commandName) => availableCommands.has(commandName) && !RESTRICTED_COMMANDS.has(commandName);

  return {
    grantAll,
    grantCommands: grantAll
      ? [...availableCommands].filter((commandName) => !RESTRICTED_COMMANDS.has(commandName))
      : uniqueCommands.filter(isGrantable),
    unsupportedCommands: uniqueCommands.filter((commandName) => !isGrantable(commandName))
  };
}

module.exports = {
  name: 'grantaccess',
  aliases: ['giveaccess', 'approveaccess', 'grantgrant'],
  description: 'Manually grant approved access for a user',
  ownerOnly: true,
  usage: '~grantaccess @user [command1] [command2] [command3...] | all',
  requiredPermissions: [PermissionFlagsBits.ManageGuild],

  async execute(message, args) {
    if (!(await authorizeOwnerCommand(message, { commandName: 'grantaccess', requiredPermissions: [PermissionFlagsBits.ManageGuild], requireApproval: true, allowAllOwners: true }))) {
      return;
    }

    if (!message.guild) {
      return message.reply('❌ This command can only be used in a server.');
    }

    const target = message.mentions.users.first();
    if (!target) {
      return message.reply('❌ Please mention a user you want to grant access to.');
    }

    const requestedCommands = args
      .slice(1)
      .flatMap((value) => String(value).split(','))
      .map((value) => normalizeCommandName(value))
      .filter(Boolean);

    if (requestedCommands.length === 0) {
      return message.reply('❌ Usage: `~grantaccess @user [command1] [command2] [command3...] | all`');
    }

    const { grantAll, grantCommands, unsupportedCommands } = getRequestedGrantCommands(requestedCommands);
    const uniqueCommands = [...new Set(requestedCommands.filter((value) => value !== 'all'))];
    if (!grantAll && uniqueCommands.length === 0) {
      return message.reply('❌ Usage: `~grantaccess @user [command1] [command2] [command3...] | all`');
    }

    if (grantCommands.length === 0) {
      return message.reply('❌ No grantable commands were found. Owner-only commands cannot be granted.');
    }

    const grantedNow = [];
    const alreadyGranted = [];

    if (grantAll) {
      const existingCount = (await Promise.all(grantCommands.map((commandName) => isTempAccessGranted(target.id, commandName))))
        .filter(Boolean).length;
      const newCount = await grantAllTempAccess(target.id, grantCommands);
      grantedNow.push(`${newCount} commands`);
      if (existingCount > 0) {
        alreadyGranted.push(`${existingCount} commands`);
      }
    } else {
      for (const commandName of grantCommands) {
        const wasAlreadyGranted = await isTempAccessGranted(target.id, commandName);
        await grantTempAccess(target.id, commandName);
        if (wasAlreadyGranted) {
          alreadyGranted.push(commandName);
        } else {
          grantedNow.push(commandName);
        }
      }
    }

    const embed = new EmbedBuilder()
      .setColor('#43A047')
      .setTitle('✅ Access Granted')
      .setDescription(
        grantedNow.length > 0 || alreadyGranted.length > 0
          ? [
              grantAll
                ? `Granted access to ${target} for all commands except restricted administrative commands.`
                : `Approved access for ${target} has been updated for the permitted commands.`,
              grantedNow.length > 0 ? `Granted: ${grantAll ? grantedNow[0] : grantedNow.map((commandName) => `\`${commandName}\``).join(', ')}.` : null,
              alreadyGranted.length > 0 ? `Already existed: ${grantAll ? alreadyGranted[0] : alreadyGranted.map((commandName) => `\`${commandName}\``).join(', ')}.` : null,
              unsupportedCommands.length > 0 ? `Ignored: ${unsupportedCommands.map((commandName) => `\`${commandName}\``).join(', ')}.` : null
            ].filter(Boolean).join(' ')
          : `No valid command names were provided for ${target}.`
      )
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};

module.exports.getAllCommandAccessNames = getAllCommandAccessNames;
module.exports.getRequestedGrantCommands = getRequestedGrantCommands;