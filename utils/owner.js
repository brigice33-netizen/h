const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { PermissionFlagsBits } = require('discord.js');
const { getConfig, setConfig, deleteConfig } = require('../database');

const REQUEST_TTL_MS = 5 * 60 * 1000;
const PENDING_ACCESS_REQUESTS = new Map();
const TEMP_ACCESS_GRANTS = new Map();
const TEMP_ACCESS_CONFIG_PREFIX = 'owner_access';

function getOwnerIds() {
  const ids = process.env.OWNER_IDS?.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids && ids.length > 0) return ids;
  return process.env.OWNER_ID ? [process.env.OWNER_ID.trim()] : [];
}

function getTrueOwnerId() {
  return (process.env.TRUE_OWNER_ID || process.env.OWNER_ID || getOwnerIds()[0] || null)?.trim() || null;
}

function getTrustedUserIds() {
  const explicitIds = process.env.TRUSTED_USER_IDS?.split(',').map((id) => id.trim()).filter(Boolean);
  if (explicitIds && explicitIds.length > 0) return explicitIds;

  const explicitSingle = process.env.TRUSTED_USER_ID?.trim();
  if (explicitSingle) return [explicitSingle];

  const ownerIds = getOwnerIds();
  if (ownerIds.length > 1) {
    return ownerIds.slice(1);
  }

  return [];
}

function isOwner(userId) {
  if (!userId) return false;
  const ownerIds = getOwnerIds();
  return ownerIds.includes(userId.toString());
}

function isTrustedUser(userId) {
  if (!userId) return false;
  const trustedIds = getTrustedUserIds();
  return trustedIds.includes(userId.toString());
}

function isTrueOwner(userId) {
  if (!userId) return false;
  const trueOwnerId = getTrueOwnerId();
  return Boolean(trueOwnerId) && userId.toString() === trueOwnerId.toString();
}

function describePermissionFlag(permission) {
  if (permission == null) return 'unknown permission';

  const normalized = typeof permission === 'bigint' ? permission : BigInt(permission);
  const match = Object.entries(PermissionFlagsBits).find(([, value]) => value === normalized);
  if (match) {
    return match[0];
  }

  if (typeof permission === 'string') {
    return permission.trim() || 'unknown permission';
  }

  return String(permission);
}

function getPermissionLabel(requiredPermissions = []) {
  if (!Array.isArray(requiredPermissions) || requiredPermissions.length === 0) {
    return 'the required permissions';
  }

  return requiredPermissions.map((permission) => describePermissionFlag(permission)).join(', ');
}

function hasRequiredPermissions(member, requiredPermissions = []) {
  if (!member?.permissions) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (!Array.isArray(requiredPermissions) || requiredPermissions.length === 0) return false;
  return requiredPermissions.some((permission) => member.permissions.has(permission));
}

function hasCommandPermission(message, requiredPermissions = []) {
  const userId = message?.author?.id || message?.user?.id;
  return isTrueOwner(userId) || hasRequiredPermissions(message?.member, requiredPermissions);
}

function getGrantKey(userId, commandName) {
  return `${userId}:${String(commandName || '').toLowerCase()}`;
}

function getAccessConfigKey(userId) {
  return `${TEMP_ACCESS_CONFIG_PREFIX}:${userId}`;
}

function getCachedAccessList(userId) {
  const cached = TEMP_ACCESS_GRANTS.get(String(userId));
  return Array.isArray(cached) ? cached : null;
}

async function loadAccessList(userId) {
  const cached = getCachedAccessList(userId);
  if (cached) {
    return cached;
  }

  const raw = await getConfig(getAccessConfigKey(userId));
  if (!raw) {
    TEMP_ACCESS_GRANTS.set(String(userId), []);
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed.map((commandName) => String(commandName).trim().toLowerCase()).filter(Boolean)
      : [];
    TEMP_ACCESS_GRANTS.set(String(userId), list);
    return list;
  } catch {
    TEMP_ACCESS_GRANTS.set(String(userId), []);
    return [];
  }
}

async function saveAccessList(userId, commandNames) {
  const normalized = [...new Set((commandNames || []).map((commandName) => String(commandName).trim().toLowerCase()).filter(Boolean))];
  TEMP_ACCESS_GRANTS.set(String(userId), normalized);

  if (normalized.length === 0) {
    await deleteConfig(getAccessConfigKey(userId));
    return normalized;
  }

  await setConfig(getAccessConfigKey(userId), JSON.stringify(normalized));
  return normalized;
}

async function isTempAccessGranted(userId, commandName) {
  const list = await loadAccessList(userId);
  return list.includes(String(commandName || '').toLowerCase());
}

async function grantTempAccess(userId, commandName) {
  const list = await loadAccessList(userId);
  const normalizedCommand = String(commandName || '').trim().toLowerCase();
  if (!normalizedCommand) return false;
  const alreadyGranted = list.includes(normalizedCommand);
  if (!alreadyGranted) {
    list.push(normalizedCommand);
    await saveAccessList(userId, list);
  }
  return !alreadyGranted;
}

async function grantAllTempAccess(userId, commandNames = []) {
  let grantedCount = 0;
  const list = await loadAccessList(userId);

  for (const commandName of commandNames) {
    const normalizedCommand = String(commandName || '').trim().toLowerCase();
    if (!normalizedCommand) continue;
    if (!list.includes(normalizedCommand)) {
      grantedCount += 1;
      list.push(normalizedCommand);
    }
  }

  await saveAccessList(userId, list);
  return grantedCount;
}

async function revokeTempAccess(userId, commandName) {
  const list = await loadAccessList(userId);
  const normalizedCommand = String(commandName || '').trim().toLowerCase();
  const nextList = list.filter((value) => value !== normalizedCommand);
  const removed = nextList.length !== list.length;
  await saveAccessList(userId, nextList);
  return removed;
}

async function revokeAllTempAccess(userId) {
  const list = await loadAccessList(userId);
  if (list.length === 0) {
    return false;
  }

  await saveAccessList(userId, []);
  return true;
}

function clearExpiredRequests() {
  const now = Date.now();
  for (const [requestId, request] of PENDING_ACCESS_REQUESTS.entries()) {
    if (request.expiresAt <= now) {
      PENDING_ACCESS_REQUESTS.delete(requestId);
    }
  }
}

function buildDisabledRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('owner_access_grant').setLabel('Give Access').setStyle(ButtonStyle.Success).setDisabled(true),
    new ButtonBuilder().setCustomId('owner_access_deny').setLabel('Deny Access').setStyle(ButtonStyle.Danger).setDisabled(true)
  );
}

async function requestOwnerAccess(message, { commandName, requiredPermissions = [] }) {
  const trueOwnerId = getTrueOwnerId();
  if (!trueOwnerId || !message?.channel?.send) {
    return false;
  }

  clearExpiredRequests();

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`owner_access_grant:${requestId}`).setLabel('Give Access').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`owner_access_deny:${requestId}`).setLabel('Deny Access').setStyle(ButtonStyle.Danger)
  );

  const requestMessage = await message.channel.send({
    content: `<@${trueOwnerId}> ${message.author} tried to use \`${commandName}\` but is missing ${getPermissionLabel(requiredPermissions)}.`,
    components: [row]
  }).catch(() => null);

  if (requestMessage) {
    PENDING_ACCESS_REQUESTS.set(requestId, {
      requestId,
      commandName: String(commandName || '').toLowerCase(),
      requesterId: message.author.id,
      guildId: message.guild?.id || null,
      channelId: message.channel?.id || null,
      messageId: requestMessage.id,
      expiresAt: Date.now() + REQUEST_TTL_MS,
      requiredPermissions
    });
  }

  await message.reply({ content: '❌ You do not have permission to use `' + commandName + '`. I asked <@' + trueOwnerId + '> for access.', allowedMentions: { parse: [] } }).catch(() => {});
  return false;
}

async function authorizeOwnerCommand(message, { commandName, requiredPermissions = [], requireApproval = false, allowAllOwners = false }) {
  clearExpiredRequests();

  const userId = message?.author?.id || message?.user?.id;
  if (!userId) return false;

  const trueOwnerId = getTrueOwnerId();
  if (userId === trueOwnerId) {
    return true;
  }

  if (allowAllOwners && isOwner(userId)) {
    return true;
  }

  if (await isTempAccessGranted(userId, commandName)) {
    return true;
  }

  if (!isTrueOwner(userId)) {
    if (!message.guild) {
      await message.reply('❌ This command can only be used in a server.').catch(() => {});
      return false;
    }

    await requestOwnerAccess(message, { commandName, requiredPermissions });
    return false;
  }

  if (!message.guild) {
    await message.reply('❌ This command can only be used in a server.').catch(() => {});
    return false;
  }

  if (!requireApproval && hasRequiredPermissions(message.member, requiredPermissions)) {
    return true;
  }

  await requestOwnerAccess(message, { commandName, requiredPermissions });
  return false;
}

async function handleOwnerAccessInteraction(interaction) {
  if (!interaction?.isButton?.()) {
    return false;
  }

  clearExpiredRequests();

  const match = String(interaction.customId || '').match(/^owner_access_(grant|deny):(.+)$/);
  if (!match) {
    return false;
  }

  const trueOwnerId = getTrueOwnerId();
  if (interaction.user.id !== trueOwnerId) {
    await interaction.reply({ content: '❌ Only the true owner can approve access requests.', ephemeral: true }).catch(() => {});
    return true;
  }

  const action = match[1];
  const requestId = match[2];
  const request = PENDING_ACCESS_REQUESTS.get(requestId);

  if (!request) {
    await interaction.reply({ content: '❌ That access request has expired or was already handled.', ephemeral: true }).catch(() => {});
    return true;
  }

  PENDING_ACCESS_REQUESTS.delete(requestId);

  if (action === 'grant') {
    await grantTempAccess(request.requesterId, request.commandName);
  }

  const disabledRow = buildDisabledRow();
  const statusText = action === 'grant'
    ? `✅ Access granted to <@${request.requesterId}> for \`${request.commandName}\` permanently.`
    : `⛔ Access denied for <@${request.requesterId}> on \`${request.commandName}\`.`;

  await interaction.update({ content: `${interaction.message.content}\n\n${statusText}`, components: [disabledRow] }).catch(async () => {
    await interaction.followUp({ content: statusText, ephemeral: true }).catch(() => {});
  });

  return true;
}

module.exports = {
  getOwnerIds,
  getTrueOwnerId,
  getTrustedUserIds,
  isOwner,
  isTrustedUser,
  isTrueOwner,
  hasCommandPermission,
  authorizeOwnerCommand,
  handleOwnerAccessInteraction,
  isTempAccessGranted,
  grantTempAccess,
  grantAllTempAccess,
  revokeTempAccess,
  revokeAllTempAccess
};
