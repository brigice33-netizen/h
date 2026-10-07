const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const setprefixCommand = require('../commands/admin only/setprefix');

test('setprefix writes dollar sequences literally to the environment file', async () => {
  const originalReadFileSync = fs.readFileSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalTrueOwnerId = process.env.TRUE_OWNER_ID;
  const originalPrefix = process.env.PREFIX;
  const newPrefix = `${String.fromCharCode(36)}&`;
  let savedEnvContent;

  process.env.TRUE_OWNER_ID = 'test-owner';
  fs.readFileSync = () => 'PREFIX=~\n';
  fs.writeFileSync = (filePath, content) => {
    savedEnvContent = content;
  };

  try {
    const client = { prefix: '~' };
    const message = {
      author: { id: 'test-owner' },
      reply: async () => {}
    };

    await setprefixCommand.execute(message, [newPrefix], client);

    assert.equal(savedEnvContent, `PREFIX=${newPrefix}\n`);
    assert.equal(client.prefix, newPrefix);
    assert.equal(process.env.PREFIX, newPrefix);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.writeFileSync = originalWriteFileSync;
    if (originalTrueOwnerId === undefined) delete process.env.TRUE_OWNER_ID;
    else process.env.TRUE_OWNER_ID = originalTrueOwnerId;
    if (originalPrefix === undefined) delete process.env.PREFIX;
    else process.env.PREFIX = originalPrefix;
  }
});