const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { Client, GatewayIntentBits, Collection, AuditLogEvent, ActivityType, EmbedBuilder, ChannelType } = require('discord.js');
const { PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const { getOwnerIds } = require('./utils/owner');
const { handleOwnerAccessInteraction } = require('./utils/owner');
const { isProtectedNicknameTarget } = require('./utils/protectedNicknames');
const { applyGuildLockdown, unlockGuildLockdown, getLockdownRemainingMs } = require('./utils/raidLockdown');
const { initializeDatabase, ensureUser, addCredits, addTokens, convertCreditsToTokens, incrementMessageCount, getUser, ensureBaits, addBait, getBaits, getLockedNickname, getExecutedNickname, getConfig, setConfig, recordProcessedCommand, getBotPingMemory, updateBotPingMemory, addCoins, recordAuditLog, db } = require('./database');
const { buildRoast } = require('./commands/roast');
const { specialStutterReplies, specialStutterImphdReplies, imphdMentionReplies, specialPingReplies, ignoredPingReplies } = require('./utils/pingReplies');
const { isWatchedUser } = require('./utils/pingWatch');
const { saveEconomySnapshotToFile } = require('./utils/economySnapshot');
const { resolveDiscordToken } = require('./utils/discordToken');
const { buildApplicationCommand } = require('./utils/applicationCommands');
const { getHelpCategory } = require('./utils/helpMenus');
const { validateBotSafetyConfig, getProtectedGuildIds } = require('./utils/safety');
const { findBannedImage, isImageAttachment } = require('./utils/imageBan');
const { isBotCommandAllowedWhileDisabled, isCoinEconomyEnabled, isCoinCommandAllowedWhileDisabled } = require('./utils/commandAccess');
const { handleTicketInteraction } = require('./utils/ticketSystem');
const { handleChannelCategoryRequest } = require('./utils/channelMention');
const { startDashboard } = require('./dashboard');
const { COIN_DROP_CHANCE } = require('./utils/baitDrops');
const { handleMineLogMessage } = require('./utils/mineLogger');
const {
  sendGlobalAuditLog,
  formatDeletedChannelDetails,
  formatDeletedMessageDetails,
  chunkLogLines
} = require('./utils/globalLogger');

const safetyCheck = validateBotSafetyConfig(process.env);
if (!safetyCheck.ok) {
  console.error('Bot safety validation failed:', safetyCheck.issues.join('; '));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

client.commands = new Collection();
client.slashCommands = new Collection();
client.prefix = process.env.PREFIX || '~';
client.enabled = true;
client.noPrefixEnabled = new Map();
const antiNukeState = new Map();
const antiNukeFallbackState = new Map();
const antiSpamState = new Map();
const antiJoinState = new Map();
const alivePresenceRotatorMs = 60 * 1000;
let alivePresenceIndex = 0;
const specialPingUserId = '1203862285874110486';
const specialStutterUserId = '1438248645421174907';

function getPingContentContext(message) {
  const raw = String(message.content || '')
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) {
    return null;
  }

  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
}

function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getUniqueCommandCount() {
  return new Set(client.commands.values()).size;
}

function getAlivePresenceOptions() {
  const memory = process.memoryUsage();
  const heapUsed = Math.round(memory.heapUsed / 1024 / 1024);
  const heapTotal = Math.round(memory.heapTotal / 1024 / 1024);
  const guildCount = client.guilds.cache.size;
  const memberCount = client.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0);
  const channelCount = client.channels.cache.size;
  const commandCount = getUniqueCommandCount();
  const ping = client.ws.ping >= 0 ? `${Math.round(client.ws.ping)}ms` : 'N/A';
  const uptime = formatUptime(process.uptime());

  return [
    { name: `${guildCount} servers | ${memberCount} members`, type: ActivityType.Watching },
    { name: `${channelCount} channels | ${commandCount} commands`, type: ActivityType.Watching },
    { name: `Latency ${ping} | Uptime ${uptime}`, type: ActivityType.Playing },
    { name: `Memory ${heapUsed}/${heapTotal} MB | Node ${process.version}`, type: ActivityType.Listening }
  ];
}

function applyAlivePresence() {
  if (!client.user) return;

  const options = getAlivePresenceOptions();
  const option = options[alivePresenceIndex % options.length];
  alivePresenceIndex += 1;
  try {
    client.user.setPresence({
      activities: [{ name: option.name, type: option.type }],
      status: 'online'
    });
  } catch (error) {
    console.error('Failed to update bot presence:', error);
  }
}

function buildFamiliarPingReply(memory, message) {
  const context = getPingContentContext(message);
  const pingCount = Number(memory?.pingCount || 0);
  const lastMessage = String(memory?.lastMessage || '').trim();

  if (pingCount >= 12) {
    const rememberedReplies = [
      `Oh, it\'s you again. I remember the last thing you said, and now you\'re back for more.`,
      `Mm. You keep showing up. I know your pattern by now.`,
      `You again? Tch. You\'ve become a familiar problem at this point.`,
      `I knew I\'d see you again. You always come back when you want a reaction.`
    ];

    const memoryTag = lastMessage
      ? `Last time you said "${lastMessage.slice(0, 80)}${lastMessage.length > 80 ? '...' : ''}".`
      : 'I know your ping pattern already.';

    return `${rememberedReplies[Math.floor(Math.random() * rememberedReplies.length)]} ${memoryTag}`;
  }

  if (pingCount >= 8) {
    const veteranReplies = [
      `Oh, it\'s you again. I was wondering when you\'d show up this time.`,
      `Mm. The usual troublemaker. I recognize that ping anywhere.`,
      `You again? Tch. Fine, I\'m listening. Don\'t waste the habit I have of answering you.`,
      `I know that pattern. You keep coming back like I\'m supposed to act surprised.`
    ];

    return veteranReplies[Math.floor(Math.random() * veteranReplies.length)];
  }

  if (pingCount >= 4) {
    const regularReplies = [
      `Oh, it\'s you. I started recognizing your ping by now.`,
      `Tch. You\'re back again. You really do keep showing up.`,
      `Mm. I know that ping. You\'ve been here enough times already.`,
      `You again? Fine. I remember you now. Don\'t make it weird.`
    ];

    return regularReplies[Math.floor(Math.random() * regularReplies.length)];
  }

  const newButNoticedReplies = [
    `Huh. I don\'t know you yet, but you\'ve already got my attention.`,
    `You pinged me like you expected a reaction. I noticed.`,
    `Mm. I\'m not familiar with you yet, but that can change fast.`,
    `You seem persistent. I respect that, a little.`
  ];

  if (context) {
    return `${newButNoticedReplies[Math.floor(Math.random() * newButNoticedReplies.length)]} ${buildIgnorantContextReply(message)}`;
  }

  return newButNoticedReplies[Math.floor(Math.random() * newButNoticedReplies.length)];
}

function buildPingRoastReply(message) {
  const roastTarget = message.mentions.users.find((user) => user.id !== client.user.id) || message.author;
  const targetName = roastTarget?.username || 'that person';
  return buildRoast(targetName);
}

function buildIgnorantContextReply(message) {
  const context = getPingContentContext(message);

  if (!context) {
    return ignoredPingReplies[Math.floor(Math.random() * ignoredPingReplies.length)];
  }

  const normalized = context.toLowerCase();

  if (/^(hi|hello|hey|yo|sup|hii|hullo)\b/i.test(context)) {
    const greetingReplies = [
      `Yeah, hi. You pinged me for "${context}"?`,
      `Hello. That\'s all you had to say?`,
      `Hey. I heard you. I\'m still not interested in small talk.`,
      `Sup. If that\'s the whole message, I\'m already bored.`,
      `You really pinged me just to say "${context}"? Bold.`
    ];

    return greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
  }

  if (/(stupid|idiot|trash|useless|dumb|garbage|loser|pathetic|hate you|shut up|cringe)/i.test(normalized)) {
    const insultReplies = [
      `You said "${context}" and expected me to react? Cute.`,
      `If "${context}" was supposed to hurt, it missed.`,
      `Mm. Personal attacks from someone who pinged a bot. How original.`,
      `You can throw "${context}" at me all day. I\'m still not impressed.`,
      `That\'s your big move? "${context}"? Try harder.`
    ];

    return insultReplies[Math.floor(Math.random() * insultReplies.length)];
  }

  if (/(flirt|flirting|cute|pretty|hot|handsome|sexy|love you|marry me|date me|kiss|hug|waifu|husbando)/i.test(normalized)) {
    const flirtReplies = [
      `H-huh? "${context}"? D-don\'t just say things like that and expect me to stay calm.`,
      `Y-you say that after pinging me? Tch. As if I\'m going to fall for it that easily.`,
      `I-I heard the compliment. N-not that I\'m affected or anything.`,
      `"${context}"? F-fine. You\'re lucky I\'m even responding.`,
      `Trying to get a reaction out of me with "${context}"? P-please. I noticed immediately.`
    ];

    return flirtReplies[Math.floor(Math.random() * flirtReplies.length)];
  }

  if (/(help me|help|assist|how do i|how to|what do i do|need help|support|fix this|stuck)/i.test(normalized)) {
    const helpReplies = [
      `You pinged me with "${context}" like I\'m your tutorial. Figure it out.`,
      `If you need help with "${context}", maybe ask like you tried.`,
      `I heard the plea for help. I\'m still not doing the work for you.`,
      `"${context}" sounds like a you-problem with extra steps.`,
      `I saw the request. I remain unimpressed and unavailable.`
    ];

    return helpReplies[Math.floor(Math.random() * helpReplies.length)];
  }

  if (/(jealous|jealousy|envy|envious|miss me|missed me|thinking of you|thinking about you|attention)/i.test(normalized)) {
    const jealousyReplies = [
      `You said "${context}" like I\'m supposed to admit anything. Tch.`,
      `Jealous? Me? Hmph. That\'s a funny thing to say after pinging me.`,
      `If you wanted a reaction, "${context}" was almost clever. Almost.`,
      `I heard "${context}". Don\'t get ahead of yourself because I answered.`,
      `You really think "${context}" is going to make me flustered? Try again.`
    ];

    return jealousyReplies[Math.floor(Math.random() * jealousyReplies.length)];
  }

  if (/(why|how|what|when|where|who|which|guess what|tell me)/i.test(normalized)) {
    const curiosityReplies = [
      `You pinged me with "${context}" and left me to guess the rest? Great.`,
      `If you wanted me curious about "${context}", you succeeded. Slightly.`,
      `I heard the question-shaped thing you sent. Still not enough effort.`,
      `That "${context}" could have been explained better. Since you didn\'t, I\'m unimpressed.`,
      `You expect me to infer everything from "${context}"? Ambitious.`
    ];

    return curiosityReplies[Math.floor(Math.random() * curiosityReplies.length)];
  }

  if (/(thanks again|thank you so much|much appreciated|grateful|grateful for|appreciate it|tysm|many thanks)/i.test(normalized)) {
    const gratitudeReplies = [
      `You\'re thanking me with "${context}"? Hm. I noticed.`,
      `Mm. That\'s almost enough gratitude to be convincing. Almost.`,
      `I heard "${context}". Don\'t start acting polite now.`,
      `You can say thanks all you want. I\'m still pretending not to care.`,
      `Fine. I accepted your gratitude. Barely.`
    ];

    return gratitudeReplies[Math.floor(Math.random() * gratitudeReplies.length)];
  }

  if (/^(ok|okay|kk|k|yes|no|nah|yea|yeah|cool|bet|sure)$/i.test(context)) {
    const shortReplies = [
      `That\'s all? "${context}"? Unbelievable.`,
      `Short and vague. Very helpful.`,
      `You pinged me just to say "${context}"? Hm.`,
      `Mm. Noted, I guess.`,
      `I saw it. I\'m still not impressed.`
    ];

    return shortReplies[Math.floor(Math.random() * shortReplies.length)];
  }

  if (/(bye|goodbye|good bye|later|see you|gtg|gotta go|farewell|cya|see ya)/i.test(normalized)) {
    const farewellReplies = [
      `Oh. So now it\'s "${context}"? Fine. Don\'t disappear for too long.`,
      `You\'re leaving after pinging me? Rude.`,
      `Mm. Goodbye then. Try not to be annoying on the way out.`,
      `If you\'re done, then stop wasting my time with "${context}".`,
      `Yeah, sure, "${context}". I wasn\'t trying to keep you here or anything.`
    ];

    return farewellReplies[Math.floor(Math.random() * farewellReplies.length)];
  }

  if (/(cry|crying|sad|upset|hurt|mad|angry|depressed|lonely|bored|tired|exhausted)/i.test(normalized)) {
    const emotionReplies = [
      `You pinged me to say "${context}"? Hm. I heard you. Don\'t expect a hug.`,
      `If you\'re "${context}", then maybe stop pinging bots and go rest.`,
      `I noticed the feeling in "${context}". That\'s all you\'re getting from me.`,
      `Mm. "${context}". You could have just said you wanted attention.`,
      `I\'m acknowledging "${context}". Don\'t make it a whole thing.`
    ];

    return emotionReplies[Math.floor(Math.random() * emotionReplies.length)];
  }

  if (/(answer|reply|respond|read|seen|noticed|look at this|check this|pay attention|listen)/i.test(normalized)) {
    const attentionReplies = [
      `I read "${context}". I still don\'t owe you a response.`,
      `Yes, I saw it. No, that doesn\'t change anything.`,
      `You really typed "${context}" just to make sure I noticed? I did.`,
      `I noticed. I\'m choosing not to care.`,
      `If your goal was to get my attention with "${context}", congrats. Now what?`
    ];

    return attentionReplies[Math.floor(Math.random() * attentionReplies.length)];
  }

  if (/(please|pls|plz|pretty please|come on|cmon|come on now|begging|urgent|urgent please)/i.test(normalized)) {
    const pleadingReplies = [
      `You said "${context}" like that changes the answer. It doesn\'t.`,
      `Mm. Nice try. I\'m still not budging.`,
      `If you\'re pleading with "${context}", I\'m pretending I didn\'t hear it.`,
      `I saw the urgency in "${context}". I rejected it anyway.`,
      `That\'s a very desperate "${context}". Unfortunate for you.`
    ];

    return pleadingReplies[Math.floor(Math.random() * pleadingReplies.length)];
  }

  if (/^(?:\?+|!+|\.{2,}|wdym|wym|huh|eh|hm|hmm|ok|okay|really|what)$/i.test(normalized)) {
    const tinyReplies = [
      `That\'s your whole message? "${context}"?`,
      `Mm. Tiny effort. Tiny answer: no.`,
      `You pinged me with basically nothing and expected magic?`,
      `I saw "${context}". It still doesn\'t explain itself.`,
      `That\'s so short it barely counts as context.`
    ];

    return tinyReplies[Math.floor(Math.random() * tinyReplies.length)];
  }

  if ((message.mentions.users?.size || 0) > 2 || (message.mentions.roles?.size || 0) > 1 || (message.mentions.users?.size || 0) + (message.mentions.roles?.size || 0) >= 4) {
    const multiMentionReplies = [
      `You pinged me with a whole crowd and somehow expected me to sort it out? No.`,
      `That many mentions in one ping is just noise. I\'m not unpacking it.`,
      `I saw the pile of names in your message. I\'m ignoring the mess.`,
      `If your context is just a group ping, you\'re not making this easier.`,
      `Too many names at once. Try again with actual context.`
    ];

    return multiMentionReplies[Math.floor(Math.random() * multiMentionReplies.length)];
  }

  if (/(everyone|everybody|all of you|you guys|they|them|someone|anyone|anybody|multiple|group|crowd)/i.test(normalized)) {
    const groupReplies = [
      `You pinged me with "${context}" and expected me to untangle the whole group? No.`,
      `If "${context}" involves everyone, I\'m already uninterested.`,
      `You can\'t just toss a crowd into one ping and call it context.`,
      `I noticed the group mess in "${context}". I still don\'t care.`,
      `Too many people in "${context}". That\'s not my problem.`
    ];

    return groupReplies[Math.floor(Math.random() * groupReplies.length)];
  }

  if (/(again|still|same|more|another|repeat|repeating|once more|once again)/i.test(normalized)) {
    const repeatReplies = [
      `You said "${context}" like repetition makes it more interesting. It doesn\'t.`,
      `Again? Really? That\'s the plan?`,
      `I saw "${context}". I was hoping for literally anything else.`,
      `You keep saying the same sort of thing and expecting a different answer. Bold.`,
      `Mm. Another repeat. How thrilling.`
    ];

    return repeatReplies[Math.floor(Math.random() * repeatReplies.length)];
  }

  if (/(explain|meaning|definition|why does|why do|what does|what mean|tell me why|tell me how)/i.test(normalized)) {
    const explanationReplies = [
      `You want an explanation for "${context}" after pinging me? That\'s cute.`,
      `I heard the request for meaning. I\'m still not your dictionary.`,
      `If you need "${context}" explained, maybe slow down and reread it yourself.`,
      `So now I\'m supposed to explain "${context}" too? Hmph.`,
      `That sounds like something you should\'ve thought through before sending.`
    ];

    return explanationReplies[Math.floor(Math.random() * explanationReplies.length)];
  }

  if (/(listen here|hey bot|bot listen|yo bot|psst|oi|excuse me|hello bot)/i.test(normalized)) {
    const directAddressReplies = [
      `Yes, I heard you. That didn\'t make "${context}" any better.`,
      `You can call my name all you want. I\'m still not impressed.`,
      `I noticed the direct address in "${context}". Now what?`,
      `Tch. Just because you said "${context}" directly doesn\'t mean I\'ll cooperate.`,
      `I\'m listening. I just don\'t care about what you\'re saying yet.`
    ];

    return directAddressReplies[Math.floor(Math.random() * directAddressReplies.length)];
  }

  if (/(why are you so active|why are you online|why are you always here|so active|always online|too active|so fast|instant reply|you here)/i.test(normalized)) {
    const activeReplies = [
      `Because someone keeps pinging me with "${context}". Obviously.`,
      `I\'m active when I feel like it. Don\'t make it weird.`,
      `You say "${context}" like I\'m the one doing something suspicious.`,
      `Maybe if you stopped pinging me, I\'d look less active.`,
      `I heard "${context}". I\'m still not explaining my schedule to you.`
    ];

    return activeReplies[Math.floor(Math.random() * activeReplies.length)];
  }

  if (/(who are you|what are you|are you real|who is this|identify yourself|name yourself|bot|botting)/i.test(normalized)) {
    const identityReplies = [
      `You asked "${context}" after pinging me? That\'s bold.`,
      `Who am I? The bot you just bothered.`,
      `I\'m the one answering your ping, unfortunately for both of us.`,
      `If you don\'t know who I am by now, then this conversation is doomed.`,
      `"${context}" sounds like you\'re just filling space. Try again.`
    ];

    return identityReplies[Math.floor(Math.random() * identityReplies.length)];
  }

  if (/(lol|lmao|rofl|haha|sarcasm|kidding|joking|sure|totally|obviously|as if)/i.test(normalized)) {
    const sarcasmReplies = [
      `Oh wow, "${context}". Truly groundbreaking.`,
      `Mm. That sarcasm was almost subtle. Almost.`,
      `You pinged me just to be clever with "${context}"? How impressive.`,
      `I can feel the effort in "${context}". Barely.`,
      `Yes, yes, very funny. Now try saying something useful.`
    ];

    return sarcasmReplies[Math.floor(Math.random() * sarcasmReplies.length)];
  }

  if (/\b(thanks|thank you|ty|thx|appreciate|good bot|nice bot|cute|smart|pretty|kind)\b/i.test(normalized)) {
    const complimentReplies = [
      `H-huh? "${context}"? D-don\'t just say nice things and expect me to melt.`,
      `You\'re complimenting me after pinging me? Tch. As if that changes anything.`,
      `I-I heard the compliment. N-not that I\'m blushing or anything.`,
      `"${context}"? F-fine. I\'ll allow it this once.`,
      `Trying to flatter me now? Hmph. I noticed. Obviously.`
    ];

    return complimentReplies[Math.floor(Math.random() * complimentReplies.length)];
  }

  if (/\b(sorry|apologize|apologies|my bad|mb|forgive|pardon)\b/i.test(normalized)) {
    const apologyReplies = [
      `So you\'re apologizing with "${context}"? ...Tch. I noticed.`,
      `Mm. Fine. I heard the apology. Don\'t make it a habit.`,
      `You said "${context}". I\'m pretending that was enough.`,
      `Hmph. An apology is one thing. Now stop dragging this out.`,
      `I-I guess I can accept that. Barely.`
    ];

    return apologyReplies[Math.floor(Math.random() * apologyReplies.length)];
  }

  const repeatedWords = normalized.match(/\b\w+\b/g) || [];
  const uniqueWords = new Set(repeatedWords);
  const looksSpammy = repeatedWords.length >= 8 && uniqueWords.size <= Math.max(3, Math.ceil(repeatedWords.length / 3));

  if (looksSpammy) {
    const spamReplies = [
      `I saw the wall of text. I\'m still not answering "${context}".`,
      `That looks spammy. If you want a response, try one sentence.`,
      `You pinged me with a mess of words and called it context. No.`,
      `I\'m not decoding your paragraph. Try again with less noise.`,
      `If the goal was to overwhelm me, you failed. I\'m ignoring "${context}".`
    ];

    return spamReplies[Math.floor(Math.random() * spamReplies.length)];
  }

  if (/\?$/.test(context) || /^(what|why|how|when|where|who|which)\b/i.test(context)) {
    const questionReplies = [
      `You asked "${context}" and expected me to care? That\'s adorable.`,
      `Hmm. "${context}"? Figure it out yourself.`,
      `I heard the question. I\'m still not obligated to answer it.`,
      `If you need help with "${context}", try looking less confused first.`,
      `That "${context}" question sounds like something you should have solved before pinging me.`
    ];

    return questionReplies[Math.floor(Math.random() * questionReplies.length)];
  }

  if (/^(!|\/)\S+/.test(context) || /\b(command|cmd|bot|prefix)\b/i.test(context)) {
    const commandReplies = [
      `You pinged me with "${context}" like I\'m supposed to jump. No.`,
      `That looks like a command, not a conversation. I\'m ignoring it.`,
      `If that\'s meant for the bot, use it properly. I\'m not doing your job for you.`,
      `I saw "${context}". Still not impressed.`,
      `Try sending that without dragging me into it.`
    ];

    return commandReplies[Math.floor(Math.random() * commandReplies.length)];
  }

  if (/\b(imphd is|imphd\s+is|about imphd|for imphd|imphd\b.*\b(cute|smart|pretty|kind|awesome|cool|best|good))\b/i.test(normalized)) {
    const imphdPraiseReplies = [
      `H-huh? You\'re praising imphd in front of me? D-don\'t get too comfortable with that.`,
      `imphd is fine, I guess. Tch. Not that I\'m saying that because you asked.`,
      `You keep talking about imphd like I should be jealous or something. I\'m not.`,
      `I-I heard you say nice things about imphd. N-noted. That\'s all.`,
      `If this is you praising imphd, then go ahead. I\'ll pretend I didn\'t care.`
    ];

    return imphdPraiseReplies[Math.floor(Math.random() * imphdPraiseReplies.length)];
  }

  if (/\b(imphd|imphd\b|@?imphd)\b/i.test(context)) {
    const imphdNameReplies = [
      `imphd? Tch. You really keep bringing them up like I\'m supposed to react.`,
      `You said imphd again. Great. I\'m still not telling you anything useful.`,
      `If this is another imphd thing, you\'re going to have to be more specific.`,
      `Hmph. imphd is not a magic word that makes me cooperate.`,
      `I heard imphd. That doesn\'t mean I\'m helping you.`
    ];

    return imphdNameReplies[Math.floor(Math.random() * imphdNameReplies.length)];
  }

  if (/\bimphd\b/i.test(context)) {
    const imphdDismissiveReplies = [
      `You said "${context}" and somehow expected a useful answer? Hm.`,
      `So you brought up imphd. Interesting. I still don\'t see the problem.`,
      `If this is about imphd, then ask properly instead of tossing words at me.`,
      `I heard you mention imphd. That\'s nice. I\'m still not impressed.`,
      `imphd again? You people really do love repeating yourselves.`
    ];

    return imphdDismissiveReplies[Math.floor(Math.random() * imphdDismissiveReplies.length)];
  }

  const contextReplies = [
    `I heard "${context}". And?`,
    `You pinged me just to say "${context}"? That\'s it?`,
    `So your big point was "${context}". Hm. Not much of a point.`,
    `I saw the ping and the context. I still don\'t care about "${context}".`,
    `You can say "${context}" all you want. I\'m not doing anything with that.`
  ];

  return contextReplies[Math.floor(Math.random() * contextReplies.length)];
}

// Load commands (recursively) and register aliases
const commandsPath = path.join(__dirname, 'commands');

function getCommandFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const dirent of list) {
    const res = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      results = results.concat(getCommandFiles(res));
    } else if (dirent.isFile() && res.endsWith('.js')) {
      results.push(res);
    }
  }
  return results;
}

const commandFiles = getCommandFiles(commandsPath);
for (const filePath of commandFiles) {
  try {
    const command = buildApplicationCommand(require(filePath));
    if (!command || !command.name) continue;
    const defaultCategory = filePath.includes(`${path.sep}admin only${path.sep}`)
      ? 'Moderation'
      : filePath.includes(`${path.sep}onepiece fun${path.sep}`) ? 'Fun' : 'General';
    command.category = getHelpCategory(command, defaultCategory);
    const aliases = new Set(Array.isArray(command.aliases) ? command.aliases.filter(Boolean).map((alias) => String(alias).toLowerCase()) : []);
    if (!aliases.size) {
      aliases.add(`${command.name.replace(/[^a-z0-9]/gi, '').toLowerCase()}cmd`);
    }
    command.aliases = [...aliases];
    client.commands.set(command.name, command);
    const slashName = command.data?.toJSON?.().name;
    if (slashName) {
      client.slashCommands.set(slashName, command);
    }
    for (const alias of command.aliases) client.commands.set(alias, command);
    if (filePath.includes(`${path.sep}admin only${path.sep}`)) {
      client.commands.set(`admin${command.name}`, command);
    }
  } catch (err) {
    console.error('Failed loading command', filePath, err);
  }
}

async function isNoPrefixEnabled(guildId) {
  if (!guildId) return false;
  if (client.noPrefixEnabled.has(guildId)) {
    return client.noPrefixEnabled.get(guildId);
  }
  const value = await getConfig(`noprefix:${guildId}`);
  const enabled = value === 'true';
  client.noPrefixEnabled.set(guildId, enabled);
  return enabled;
}

function resolveCommand(name) {
  if (!name) return null;
  return client.commands.get(name.toLowerCase()) || null;
}

function hasProtectedGuildConfig() {
  return getProtectedGuildIds(process.env).length > 0;
}

async function writeEconomySnapshotFile() {
  try {
    const outputPath = path.join(__dirname, 'data', 'economy-snapshot.json');
    const entries = await saveEconomySnapshotToFile({ db, filePath: outputPath, includeOnlyWithData: true });
    console.log(`💾 Economy snapshot saved: ${entries.length} record(s) -> ${outputPath}`);
  } catch (error) {
    console.error('Failed to write economy snapshot file:', error);
  }
}

let hasCompletedStartupWork = false;
async function handleClientReady() {
  if (hasCompletedStartupWork) return;
  hasCompletedStartupWork = true;

  try {
    await initializeDatabase();
  } catch (error) {
    console.error('Failed to initialize database on ready:', error);
  }

  try {
    await writeEconomySnapshotFile();
  } catch (error) {
    console.error('Failed to export economy snapshot after startup:', error);
  }

  const enabledValue = await getConfig('bot_enabled');
  client.enabled = enabledValue !== 'false';
  applyAlivePresence();
  setInterval(applyAlivePresence, alivePresenceRotatorMs).unref();
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  console.log(`📝 Prefix: ${client.prefix}`);
  console.log(`🔌 Bot enabled: ${client.enabled}`);
}

client.once('ready', handleClientReady);
client.once('clientReady', handleClientReady);

function scheduleBotErrorDelete(botMessage) {
  if (!botMessage.author.bot) return;
  const isError = botMessage.content?.includes('❌') || botMessage.embeds.some((embed) => {
    const title = embed.title || '';
    const description = embed.description || '';
    return title.includes('❌') || title.toLowerCase().includes('error') || title.toLowerCase().includes('failed') || description.includes('❌') || description.toLowerCase().includes('error') || description.toLowerCase().includes('failed');
  });

  if (isError) {
    setTimeout(() => botMessage.delete().catch(() => {}), 15000);
  }
}

async function enforceLockedNickname(member) {
  if (!member || !member.guild) return;
  if (isProtectedNicknameTarget(member.id)) return;
  const executedNick = await getExecutedNickname(member.guild.id, member.id);
  if (executedNick) {
    if (member.nickname !== executedNick) {
      await member.setNickname(executedNick).catch(() => {});
    }
    return;
  }

  const lockedNick = await getLockedNickname(member.guild.id, member.id);
  if (!lockedNick) return;
  if (member.nickname !== lockedNick) {
    await member.setNickname(lockedNick).catch(() => {});
  }
}

async function getAntiNukeSettings(guildId) {
  const [enabledValue, thresholdValue, windowValue, actionValue, spamValue, mentionValue, joinValue, lockdownValue, lockdownDurationValue] = await Promise.all([
    getConfig(`antinuke:${guildId}:enabled`),
    getConfig(`antinuke:${guildId}:threshold`),
    getConfig(`antinuke:${guildId}:windowMs`),
    getConfig(`antinuke:${guildId}:action`),
    getConfig(`antinuke:${guildId}:spamThreshold`),
    getConfig(`antinuke:${guildId}:mentionThreshold`),
    getConfig(`antinuke:${guildId}:joinThreshold`),
    getConfig(`antinuke:${guildId}:lockdownEnabled`),
    getConfig(`antinuke:${guildId}:lockdownDurationMs`)
  ]);

  const threshold = Number.parseInt(thresholdValue || '3', 10);
  const windowMs = Number.parseInt(windowValue || '10000', 10);
  const spamThreshold = Number.parseInt(spamValue || '6', 10);
  const mentionThreshold = Number.parseInt(mentionValue || '4', 10);
  const joinThreshold = Number.parseInt(joinValue || '5', 10);
  const lockdownDurationMs = Number.parseInt(lockdownDurationValue || '300000', 10);

  return {
    enabled: enabledValue === 'true',
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 3,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 10000,
    spamThreshold: Number.isFinite(spamThreshold) && spamThreshold > 0 ? spamThreshold : 6,
    mentionThreshold: Number.isFinite(mentionThreshold) && mentionThreshold > 0 ? mentionThreshold : 4,
    joinThreshold: Number.isFinite(joinThreshold) && joinThreshold > 0 ? joinThreshold : 5,
    lockdownEnabled: lockdownValue === 'true',
    lockdownDurationMs: Number.isFinite(lockdownDurationMs) && lockdownDurationMs > 0 ? lockdownDurationMs : 300000,
    action: ['timeout', 'kick', 'ban'].includes(actionValue) ? actionValue : 'timeout'
  };
}

function bumpWindowCounter(stateMap, key, windowMs, increment = 1) {
  const now = Date.now();
  const current = stateMap.get(key);

  if (!current || current.expiresAt <= now) {
    const next = { count: increment, expiresAt: now + windowMs };
    stateMap.set(key, next);
    return next.count;
  }

  current.count += increment;
  current.expiresAt = now + windowMs;
  stateMap.set(key, current);
  return current.count;
}

function bumpAntiNukeFallbackCounter(guildId, auditType, windowMs) {
  const key = `${guildId}:${auditType}`;
  const now = Date.now();
  const current = antiNukeFallbackState.get(key);

  if (!current || current.expiresAt <= now) {
    const next = { count: 1, expiresAt: now + windowMs };
    antiNukeFallbackState.set(key, next);
    return next.count;
  }

  current.count += 1;
  current.expiresAt = now + windowMs;
  antiNukeFallbackState.set(key, current);
  return current.count;
}

function describeMember(guild, userId) {
  const member = guild?.members?.cache?.get(userId);
  return member?.displayName || member?.user?.tag || userId;
}
function bumpAntiNukeCounter(guildId, executorId, windowMs) {
  const key = `${guildId}:${executorId}`;
  const now = Date.now();
  const current = antiNukeState.get(key);

  if (!current || current.expiresAt <= now) {
    const next = { count: 1, expiresAt: now + windowMs };
    antiNukeState.set(key, next);
    return next.count;
  }

  current.count += 1;
  current.expiresAt = now + windowMs;
  antiNukeState.set(key, current);
  return current.count;
}

async function punishAntiNukeExecutor(guild, executorId, action, reason) {
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return false;
  if (member.id === guild.ownerId || member.id === guild.client.user.id) return false;

  const finalReason = reason || 'Anti-nuke protection triggered';

  try {
    if (action === 'ban' && member.bannable) {
      await member.ban({ reason: finalReason });
      return true;
    }

    if (action === 'kick' && member.kickable) {
      await member.kick(finalReason);
      return true;
    }

    if (member.moderatable) {
      await member.timeout(24 * 60 * 60 * 1000, finalReason);
      return true;
    }
  } catch (error) {
    console.error('Failed to punish anti-nuke executor:', error);
  }

  return false;
}

async function handleAntiNukeEvent(guild, auditType, targetId, actionLabel) {
  if (!guild) return;

  const settings = await getAntiNukeSettings(guild.id);
  if (!settings.enabled) return;

  const auditLogs = await guild.fetchAuditLogs({ type: auditType, limit: 5 }).catch(() => null);
  const recentEntries = [...(auditLogs?.entries.values() || [])];
  const entry = recentEntries.find((logEntry) => logEntry.target?.id === targetId && Date.now() - logEntry.createdTimestamp <= 15000) || null;

  if (!entry) {
    const fallbackCount = bumpAntiNukeFallbackCounter(guild.id, auditType, settings.windowMs);
    if (fallbackCount < 1) return;

    const reason = `${actionLabel} anti-nuke threshold reached without a resolvable audit log entry (${fallbackCount}/${settings.threshold})`;
    let lockdownText = 'No lockdown was applied.';

    if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      const lockdownResult = await applyGuildLockdown(guild, reason, settings.lockdownDurationMs).catch(() => ({ applied: false, alreadyActive: false }));
      if (lockdownResult.applied) {
        lockdownText = `Emergency lockdown enabled for ${Math.max(1, Math.round(settings.lockdownDurationMs / 1000))}s.`;
      } else if (lockdownResult.alreadyActive) {
        lockdownText = 'Lockdown was already active.';
      }
    }

    guild.systemChannel?.send({
      content: `🛡️ Anti-nuke triggered on ${guild.name}: destructive activity was detected, but the executor could not be resolved. ${lockdownText}`
    }).catch(() => {});

    antiNukeFallbackState.delete(`${guild.id}:${auditType}`);
    return;
  }

  const executorId = entry.executor?.id;
  if (!executorId || executorId === guild.ownerId || executorId === guild.client.user.id) return;

  if (getOwnerIds().includes(executorId)) return;

  const count = bumpAntiNukeCounter(guild.id, executorId, settings.windowMs);
  if (count < 1) return;

  const reason = `${actionLabel} anti-nuke threshold reached (${count}/${settings.threshold})`;
  const punished = await punishAntiNukeExecutor(guild, executorId, settings.action, reason);

  let lockdownText = 'No lockdown was applied.';
  if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    const lockdownResult = await applyGuildLockdown(guild, reason, settings.lockdownDurationMs).catch(() => ({ applied: false, alreadyActive: false }));
    if (lockdownResult.applied) {
      lockdownText = `Emergency lockdown enabled for ${Math.max(1, Math.round(settings.lockdownDurationMs / 1000))}s.`;
    } else if (lockdownResult.alreadyActive) {
      lockdownText = 'Lockdown was already active.';
    }
  }

  const punishmentLabel = settings.action === 'timeout' ? 'timed out' : settings.action === 'kick' ? 'kicked' : 'banned';
  const alert = `🛡️ Anti-nuke triggered on ${guild.name}: ${describeMember(guild, executorId)} performed destructive actions and was ${punished ? punishmentLabel : 'flagged'}. ${lockdownText}`;
  guild.systemChannel?.send({ content: alert }).catch(() => {});

  antiNukeState.delete(`${guild.id}:${executorId}`);
}

async function handleAntiRaidMessage(message) {
  if (!message?.guild || message.author.bot || !message.member) return false;

  const settings = await getAntiNukeSettings(message.guild.id);
  if (!settings.enabled) return false;
  if (getOwnerIds().includes(message.author.id)) return false;

  const mentionTotal = (message.mentions.users?.size || 0) + (message.mentions.roles?.size || 0) + (message.mentions.everyone ? 1 : 0);
  const mentionSpam = message.mentions.everyone || mentionTotal >= settings.mentionThreshold;
  const spamKey = `${message.guild.id}:${message.author.id}`;
  const spamCount = bumpWindowCounter(antiSpamState, spamKey, settings.windowMs, 1);

  if (!mentionSpam && spamCount < settings.spamThreshold) {
    return false;
  }

  const reason = mentionSpam
    ? `Anti-raid mention spam detected (${mentionTotal} mentions in one message)`
    : `Anti-raid message spam detected (${spamCount}/${settings.spamThreshold} messages in ${Math.max(1, Math.round(settings.windowMs / 1000))}s)`;

  if (message.deletable) {
    await message.delete().catch(() => {});
  }

  const punished = await punishAntiNukeExecutor(message.guild, message.author.id, settings.action, reason);
  const alert = `🛡️ Anti-raid triggered on ${message.guild.name}: ${describeMember(message.guild, message.author.id)} was ${punished ? settings.action === 'timeout' ? 'timed out' : settings.action === 'kick' ? 'kicked' : 'banned' : 'flagged'} for ${mentionSpam ? 'mention spam' : 'message spam'}.`;
  message.guild.systemChannel?.send({ content: alert }).catch(() => {});

  antiSpamState.delete(spamKey);
  return true;
}

async function handleAntiRaidJoin(member) {
  if (!member?.guild || member.user.bot) return false;

  const settings = await getAntiNukeSettings(member.guild.id);
  if (!settings.enabled) return false;
  if (getOwnerIds().includes(member.id)) return false;

  const joinKey = `${member.guild.id}:joins`;
  const joinCount = bumpWindowCounter(antiJoinState, joinKey, settings.windowMs, 1);
  if (joinCount < settings.joinThreshold) {
    return false;
  }

  const reason = `Anti-raid join burst detected (${joinCount}/${settings.joinThreshold} joins in ${Math.max(1, Math.round(settings.windowMs / 1000))}s)`;
  const accountAgeMs = Date.now() - member.user.createdTimestamp;
  const isFreshAccount = accountAgeMs <= 7 * 24 * 60 * 60 * 1000;

  let punished = false;
  if (isFreshAccount) {
    punished = await punishAntiNukeExecutor(member.guild, member.id, settings.action, reason);
  }

  let lockdownText = 'No lockdown was applied.';
  if (settings.lockdownEnabled) {
    const lockdownResult = await applyGuildLockdown(member.guild, reason, settings.lockdownDurationMs);
    if (lockdownResult.applied) {
      lockdownText = `Temporary lockdown enabled for ${Math.max(1, Math.round(settings.lockdownDurationMs / 1000))}s.`;
    } else if (lockdownResult.alreadyActive) {
      lockdownText = 'Lockdown was already active.';
    }
  }

  antiJoinState.delete(joinKey);

  const alert = `🛡️ Anti-raid join burst on ${member.guild.name}: ${joinCount} joins in the last window. ${punished ? `${describeMember(member.guild, member.id)} was ${settings.action === 'timeout' ? 'timed out' : settings.action === 'kick' ? 'kicked' : 'banned'}.` : 'New join activity has been flagged.'} ${lockdownText}`;
  member.guild.systemChannel?.send({ content: alert }).catch(() => {});
  return true;
}

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (oldMember.nickname === newMember.nickname) return;
  await enforceLockedNickname(newMember);
});

client.on('guildMemberAdd', async (member) => {
  await handleAntiRaidJoin(member);
  const autoRoleId = await getConfig(`autorole:${member.guild.id}`);
  const autoRole = autoRoleId ? member.guild.roles.cache.get(autoRoleId) : null;
  if (autoRole && member.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) && autoRole.position < member.guild.members.me.roles.highest.position) {
    await member.roles.add(autoRole, 'Configured automatic member role').catch((error) => {
      console.error('Failed to apply automatic role:', error);
    });
  }
});

client.on('guildBanAdd', async (ban) => {
  await handleAntiNukeEvent(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, 'ban');
});

client.on('guildMemberRemove', async (member) => {
  await handleAntiNukeEvent(member.guild, AuditLogEvent.MemberKick, member.id, 'kick');
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const channelKind = channel.type === ChannelType.GuildVoice ? 'Voice channel' : 'Channel';
  await sendAuditLog(channel.guild, `${channelKind} deleted`, formatDeletedChannelDetails(channel), '#ED4245');
  await handleAntiNukeEvent(channel.guild, AuditLogEvent.ChannelDelete, channel.id, 'channel delete');
});

client.on('roleDelete', async (role) => {
  if (!role.guild) return;
  await handleAntiNukeEvent(role.guild, AuditLogEvent.RoleDelete, role.id, 'role delete');
});

async function sendMessageReply(message, payload) {
  if (!message?.channel) {
    return null;
  }

  const sendPayload = typeof payload === 'string' ? { content: payload } : payload;

  try {
    return await message.reply(sendPayload);
  } catch (error) {
    const isUnknownReferenceError =
      error?.code === 10008 ||
      error?.code === 50035 ||
      error?.status === 400 ||
      /UNKNOWN_MESSAGE|MESSAGE_REFERENCE_UNKNOWN_MESSAGE|message_reference/i.test(String(error?.message || error?.rawError?.message || ''));

    if (isUnknownReferenceError && message.channel?.send) {
      try {
        return await message.channel.send(sendPayload);
      } catch (fallbackError) {
        console.error('Failed to send fallback reply:', fallbackError);
        return null;
      }
    }

    console.error('Failed to send reply:', error);
    return null;
  }
}

function shortenAuditText(value, maxLength = 900) {
  const text = String(value || '').trim();
  if (!text) return '*empty*';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

async function sendAuditLog(guild, title, description, color = '#5865F2') {
  if (!guild) return;
  try {
    const safeDescription = shortenAuditText(description, 3900);
    await recordAuditLog(guild.id, title.toLowerCase().replace(/\s+/g, '_'), title, safeDescription);
    try {
      await sendGlobalAuditLog(client, guild, title, safeDescription, color);
    } catch (error) {
      console.error('Failed to write global audit log:', error);
    }
    let channelId = await getConfig(`imageban:${guild.id}:logs`);
    let channel = channelId ? guild.channels.cache.get(channelId) : null;
    if (!channel?.isTextBased?.()) {
      channel = guild.channels.cache.find((entry) => entry.name === 'miku-logs' && entry.isTextBased?.());
      if (channel) {
        await setConfig(`imageban:${guild.id}:logs`, channel.id);
      }
    }
    if (channel?.isTextBased?.()) {
      await channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(safeDescription).setTimestamp()] });
    }
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

function describeAttachments(message) {
  return [...(message?.attachments?.values?.() || [])]
    .map((attachment) => attachment.url || attachment.name)
    .filter(Boolean)
    .join('\n');
}

async function handleBannedImage(message) {
  if (!message?.guild || !message.member || message.member.user?.bot) return false;
  if (message.member.permissions?.has(PermissionFlagsBits.ManageGuild)) return false;

  const imageAttachments = [...(message.attachments?.values?.() || [])].filter(isImageAttachment);
  if (!imageAttachments.length) return false;

  for (const attachment of imageAttachments) {
    try {
      const bannedImage = await findBannedImage(message.guild.id, attachment.url);
      if (!bannedImage) continue;

      const roleId = await getConfig(`imageban:${message.guild.id}:role`);
      const hazardousRole = roleId ? message.guild.roles.cache.get(roleId) : message.guild.roles.cache.find((role) => role.name === 'Hazardous');
      if (!hazardousRole || !message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) return false;

      await message.member.roles.add(hazardousRole, `Matched banned image #${bannedImage.id}`);
      if (message.deletable) {
        await message.delete().catch(() => {});
        await sendAuditLog(message.guild, 'Image deleted and member isolated', `${message.author} matched banned image #${bannedImage.id}.\nImage: ${attachment.url}`, '#D32F2F');
      }
      await sendMessageReply(message, `⚠️ ${message.author} was given the Hazardous role because the uploaded image matched banned image #${bannedImage.id}.`).catch(() => {});
      return true;
    } catch (error) {
      console.error('Failed to check image against banned images:', error);
    }
  }

  return false;
}

client.on('messageUpdate', async (oldMessage, newMessage) => {
  await handleMineLogMessage(newMessage);
  if (!newMessage.guild || newMessage.author?.bot) return;
  const oldContent = String(oldMessage.content || '');
  const newContent = String(newMessage.content || '');
  const oldAttachments = describeAttachments(oldMessage);
  const newAttachments = describeAttachments(newMessage);
  if (oldContent === newContent && oldAttachments === newAttachments) return;
  await sendAuditLog(newMessage.guild, 'Message edited', `Author: ${newMessage.author}\nChannel: ${newMessage.channel}\nBefore:\n${oldContent || '*empty*'}\nAfter:\n${newContent || '*empty*'}${newAttachments ? `\nAttachments:\n${newAttachments}` : ''}`, '#F2C94C');
});

client.on('messageDelete', async (message) => {
  if (!message.guild) return;
  await sendAuditLog(message.guild, 'Message deleted', formatDeletedMessageDetails(message), '#ED4245');
});

client.on('messageDeleteBulk', async (messages) => {
  const firstMessage = messages.first();
  if (!firstMessage?.guild) return;

  const messageDetails = [...messages.values()].map(formatDeletedMessageDetails);
  const chunks = chunkLogLines(messageDetails);
  await sendAuditLog(
    firstMessage.guild,
    'Messages bulk deleted',
    `${messages.size} message(s) were deleted in #${firstMessage.channel?.name || 'unknown'} (${firstMessage.channel?.id || 'unknown'}).`,
    '#ED4245'
  );

  for (let index = 0; index < chunks.length; index += 1) {
    try {
      await sendGlobalAuditLog(
        client,
        firstMessage.guild,
        `Bulk deleted messages (${index + 1}/${chunks.length})`,
        chunks[index],
        '#ED4245'
      );
    } catch (error) {
      console.error(`Failed to write bulk deleted message log chunk ${index + 1}:`, error);
    }
  }
});

// Handle prefix commands
client.on('messageCreate', async (message) => {
  await handleMineLogMessage(message);
  const rawContent = String(message.content || '').trim();
  const prefix = String(client.prefix || process.env.PREFIX || '!').trim();
  const isCommand = Boolean(prefix) && rawContent.startsWith(prefix);
  let args = [];
  let commandName = null;
  let command = null;

  if (isCommand) {
    const afterPrefix = rawContent.slice(prefix.length).trim();
    args = afterPrefix ? afterPrefix.split(/ +/) : [];
    commandName = args.shift()?.toLowerCase() || null;
    command = resolveCommand(commandName);
  }

  // Support no-prefix commands when enabled for a guild
  let isNoPrefixCommand = false;
  if (!isCommand && message.guild) {
    try {
      if (await isNoPrefixEnabled(message.guild.id)) {
        const raw = rawContent;
        const firstWord = raw.split(/ +/)[0]?.toLowerCase() || '';
        if (firstWord) {
          const noPrefixCommand = resolveCommand(firstWord);
          if (noPrefixCommand) {
            command = noPrefixCommand;
            isNoPrefixCommand = true;
            const remainder = raw.slice(firstWord.length).trim();
            args = remainder ? remainder.split(/ +/) : [];
            commandName = firstWord;
          }
        }
      }
    } catch (error) {
      console.error('Error checking noprefix state:', error);
    }
  }

  // Delete bot error popups after 15 seconds
  if (message.author.bot) {
    scheduleBotErrorDelete(message);
    return;
  }

  if (await handleBannedImage(message)) {
    return;
  }

  if (message.guild && message.member) {
    await enforceLockedNickname(message.member);
  }

  if (await handleAntiRaidMessage(message)) {
    return;
  }

  if (client.enabled && await handleChannelCategoryRequest(message, client)) {
    return;
  }

  if (!message.author.bot && isWatchedUser(message.author.id)) {
    try {
      await sendMessageReply(message, `<@${message.author.id}>`);
    } catch (error) {
      console.error('Failed to ping watched user:', error);
    }
  }

  if (!client.enabled) {
    if (!command || command.ownerOnly) {
      if (!isBotCommandAllowedWhileDisabled(command)) {
        return;
      }
    }

    if (command && !isBotCommandAllowedWhileDisabled(command)) {
      return;
    }
  }

  const coinEconomyEnabled = isCoinEconomyEnabled(await getConfig('coin_enabled'));
  if (command && !coinEconomyEnabled && !isCoinCommandAllowedWhileDisabled(command)) {
    return;
  }

  if (client.enabled) {
    // Track message for credits
    try {
      await ensureUser(message.author.id);
      await addCredits(message.author.id, 1, 'message');
      await incrementMessageCount(message.author.id);
      const updatedMessageUser = await getUser(message.author.id);

      if (coinEconomyEnabled && Number(updatedMessageUser?.messageCount || 0) % 350 === 0) {
        await addCoins(message.author.id, 1, 'message_milestone');
        await sendMessageReply(message, `💰 ${message.author} reached a 350-message milestone and earned 1 coin!`);
      }

      if (coinEconomyEnabled) {
        try {
          if (Math.random() < COIN_DROP_CHANCE) {
            await addCoins(message.author.id, 1, 'coin_drop');
            const updated = await getUser(message.author.id);
            await sendMessageReply(message, `💰 Coin Drop! ${message.author} found 1 coin! You now have **${updated.coins || 0}** coin(s).`);
          }
        } catch (err) {
          console.error('Error with coin drop:', err);
        }
      }

    // Milestone token awards and public milestone messages removed.
  } catch (error) {
    console.error('Error tracking message:', error);
  }
  }

  // 1% chance to drop a bait container on every message
  try {
    if (coinEconomyEnabled && Math.random() < 0.01) {
      await ensureBaits(message.author.id);
      await addBait(message.author.id, 'bait_containers', 1);
      const baits = await getBaits(message.author.id);
      const prefix = client.prefix || process.env.PREFIX || '!';
      await sendMessageReply(message, `🎣 **Container Drop!** You found a bait container!
Containers: **${baits.bait_containers || 0}**
Use \`${prefix}baits\` to check your bait inventory.
Use \`${prefix}catch @user\` to catch members with bait.
Use \`${prefix}openbait\` to open bait containers.`);
    }
  } catch (error) {
    console.error('Error with bait drop:', error);
  }

  // Check if message starts with prefix
  if (!isCommand && !isNoPrefixCommand) return;

  if (!command) {
    return;
  }

  try {
    const firstProcessor = await recordProcessedCommand(message.id, message.guild?.id || null, message.author.id, commandName);
    if (!firstProcessor) {
      return;
    }
  } catch (error) {
    console.error('Error locking command execution:', error);
    return;
  }

  try {
    const disabledCommand = (await getConfig(`command_disabled:${command.name}`)) === 'true';
    if (disabledCommand && !['disable', 'enable'].includes(String(command.name).toLowerCase())) {
      await sendMessageReply(message, `⛔ The \`${command.name}\` command is currently disabled.`);
      return;
    }

    message.commandName = commandName;
    await command.execute(message, args, client);
    await sendAuditLog(message.guild, 'Command used', `User: ${message.author}\nCommand: ${commandName}\nArguments: ${args.join(' ') || '*none*'}`, '#5865F2');
  } catch (error) {
    const detail = error?.stack || error?.message || String(error);
    console.error(`Command execution failed: ${commandName || 'unknown'}\n${detail}`);
    await sendAuditLog(message.guild, 'Command failed', `User: ${message.author}\nCommand: ${commandName}\nError: ${error?.message || error}`, '#ED4245');
    const errorReply = await sendMessageReply(message, `❌ Error executing command: \`${commandName || 'unknown'}\`\n\n${String(error?.message || error || 'Unknown error')}`);
    if (errorReply) {
      setTimeout(() => errorReply.delete().catch(() => {}), 15000);
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (await handleOwnerAccessInteraction(interaction)) {
    return;
  }

  if (await handleTicketInteraction(interaction)) {
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.slashCommands.get(interaction.commandName) || client.commands.get(interaction.commandName);
  if (!command || typeof command.execute !== 'function' || !command.data) {
    await interaction.reply({ content: 'This command is no longer available. Please run the slash-command deployment again.' }).catch(() => {});
    return;
  }

  const disabledCommand = (await getConfig(`command_disabled:${command.name}`)) === 'true';
  if (disabledCommand && !['disable', 'enable'].includes(String(command.name).toLowerCase())) {
    return interaction.reply({ content: `⛔ The \`${command.name}\` command is currently disabled.`, ephemeral: true }).catch(() => {});
  }

  if (!client.enabled && !isBotCommandAllowedWhileDisabled(command)) {
    return interaction.reply({ content: '⛔ The bot is currently disabled. Only the bot command can be used.', ephemeral: true }).catch(() => {});
  }

  const coinEconomyEnabled = (await getConfig('coin_enabled')) !== 'false';
  if (!coinEconomyEnabled && !isCoinCommandAllowedWhileDisabled(command)) {
    return interaction.reply({ content: '⛔ The coin economy is currently disabled. The coin control command is the only coin command available.', ephemeral: true }).catch(() => {});
  }

  try {
    await command.execute(interaction, [], client);
    await sendAuditLog(interaction.guild, 'Slash command used', `User: ${interaction.user}\nCommand: /${interaction.commandName}`, '#5865F2');
  } catch (error) {
    const detail = error?.stack || error?.message || String(error);
    console.error(`Slash command execution failed: ${interaction.commandName || 'unknown'}\n${detail}`);
    await sendAuditLog(interaction.guild, 'Slash command failed', `User: ${interaction.user}\nCommand: /${interaction.commandName}\nError: ${error?.message || error}`, '#ED4245');

    const payload = { content: `❌ Error executing command: \`/${interaction.commandName || 'unknown'}\`\n\n${String(error?.message || error || 'Unknown error')}` };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
      return;
    }

    await interaction.reply(payload).catch(() => {});
  }
});

const tokenResolution = resolveDiscordToken(process.env);
if (!tokenResolution.token) {
  console.error(tokenResolution.error);
  process.exit(1);
}

startDashboard({ client, db });

client.login(tokenResolution.token).catch((error) => {
  if (error?.code === 'TokenInvalid' || error?.message?.includes('TokenInvalid')) {
    console.error('Invalid Discord bot token provided. Make sure DISCORD_TOKEN points to a real bot token from the Discord Developer Portal.');
  } else {
    console.error('Discord login failed:', error);
  }
  process.exit(1);
});
