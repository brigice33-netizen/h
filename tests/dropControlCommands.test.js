const test = require('node:test');
const assert = require('node:assert/strict');
const database = require('../database');
const config = new Map();
const originalGetConfig = database.getConfig;
const originalSetConfig = database.setConfig;
database.getConfig = async (key) => config.get(key) ?? null;
database.setConfig = async (key, value) => config.set(key, value);
const containerDropCommand = require('../commands/admin only/dcd');
const coinDropCommand = require('../commands/admin only/dcnd');
const {
  CONTAINER_DROPS_CONFIG_KEY,
  COIN_DROPS_CONFIG_KEY,
  isDropEnabled
} = require('../utils/dropControls');

test('drop controls default to enabled and use separate configuration keys', () => {
  assert.equal(isDropEnabled(null), true);
  assert.equal(isDropEnabled('true'), true);
  assert.equal(isDropEnabled('TRUE'), true);
  assert.equal(isDropEnabled('false'), false);
  assert.equal(isDropEnabled('FALSE'), false);
  assert.equal(isDropEnabled(' false '), false);
  assert.equal(isDropEnabled('0'), false);
  assert.notEqual(CONTAINER_DROPS_CONFIG_KEY, COIN_DROPS_CONFIG_KEY);
  assert.equal(containerDropCommand.name, 'dcd');
  assert.equal(coinDropCommand.name, 'dcnd');
});

test('dcd and dcnd toggle their drop types independently', async () => {
  const ownerId = 'drop-control-test-owner';
  const previousOwnerId = process.env.TRUE_OWNER_ID;
  const message = {
    author: { id: ownerId },
    reply: async () => {}
  };

  process.env.TRUE_OWNER_ID = ownerId;
  try {
    await containerDropCommand.execute(message);
    assert.equal(config.get(CONTAINER_DROPS_CONFIG_KEY), 'false');
    assert.equal(config.has(COIN_DROPS_CONFIG_KEY), false);

    await coinDropCommand.execute(message);
    assert.equal(config.get(COIN_DROPS_CONFIG_KEY), 'false');

    await containerDropCommand.execute(message, ['on']);
    assert.equal(config.get(CONTAINER_DROPS_CONFIG_KEY), 'true');
    assert.equal(config.get(COIN_DROPS_CONFIG_KEY), 'false');

    await coinDropCommand.execute(message, ['on']);
    assert.equal(config.get(COIN_DROPS_CONFIG_KEY), 'true');
  } finally {
    if (previousOwnerId === undefined) {
      delete process.env.TRUE_OWNER_ID;
    } else {
      process.env.TRUE_OWNER_ID = previousOwnerId;
    }
    database.getConfig = originalGetConfig;
    database.setConfig = originalSetConfig;
  }
});
