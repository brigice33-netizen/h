const test = require('node:test');
const assert = require('node:assert/strict');
const imageBanCommand = require('../commands/imageban');
const mikuSetupCommand = require('../commands/admin only/mikuset');

test('imageban is a standalone command with add, list, and remove operations', () => {
  assert.equal(imageBanCommand.name, 'imageban');
  assert.deepEqual(imageBanCommand.aliases, ['bannedimage']);
  assert.equal(mikuSetupCommand.aliases.includes('imageban'), false);
  assert.equal(mikuSetupCommand.aliases.includes('bannedimage'), false);
});

test('imageban requires a reason after the add action', () => {
  assert.equal(imageBanCommand.getBanReason(['add']), '');
  assert.equal(imageBanCommand.getBanReason(['add', 'Repeated', 'prohibited', 'image']), 'Repeated prohibited image');
});

test('imageban list embed shows the image, reason, added date, and submitter', () => {
  const embed = imageBanCommand.formatBannedImageEmbed({
    id: 12,
    imageUrl: 'https://example.test/banned.png',
    reason: 'Prohibited content',
    addedBy: 'user-123',
    createdAt: '2026-10-19 01:00:00'
  });

  assert.equal(embed.data.image.url, 'https://example.test/banned.png');
  assert.match(embed.data.description, /Prohibited content/);
  assert.match(embed.data.description, /2026/);
  assert.match(embed.data.description, /user-123/);
});
