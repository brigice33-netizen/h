const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { calculateCrateReward } = require('./utils/crateSystem');

// Ensure the data directory exists so SQLite can create the DB file
const dataDir = path.join(__dirname, 'data');
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch (e) {
  console.error('Failed to ensure data directory exists:', e);
}

const dbPath = path.join(dataDir, 'bot.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});
let bannedImagesReasonMigration;

function ensureBannedImagesReasonColumn() {
  if (!bannedImagesReasonMigration) {
    bannedImagesReasonMigration = new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS banned_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guildId TEXT NOT NULL,
          imageUrl TEXT NOT NULL,
          imageHash TEXT NOT NULL,
          addedBy TEXT,
          reason TEXT NOT NULL DEFAULT '',
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (createErr) => {
        if (createErr) return reject(createErr);
        db.all('PRAGMA table_info(banned_images)', [], (err, columns) => {
          if (err) return reject(err);
          if (columns.some((column) => column.name === 'reason')) return resolve();
          db.run("ALTER TABLE banned_images ADD COLUMN reason TEXT NOT NULL DEFAULT ''", (alterErr) => {
            if (alterErr) return reject(alterErr);
            resolve();
          });
        });
      });
    }).catch((error) => {
      bannedImagesReasonMigration = null;
      throw error;
    });
  }
  return bannedImagesReasonMigration;
}

function getRandomInteger(min, max) {
  const lower = Math.ceil(Number(min));
  const upper = Math.floor(Number(max));
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper < lower) {
    return 0;
  }
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

// Initialize database tables
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
    // Users table: tracks credits and tokens
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        credits INTEGER DEFAULT 0,
        tokens INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 0,
        messageCount INTEGER DEFAULT 0,
        bounty INTEGER DEFAULT 0,
        lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Transactions table: logs all credit/token transfers
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fromUserId TEXT,
        toUserId TEXT,
        creditsAmount INTEGER DEFAULT 0,
        tokensAmount INTEGER DEFAULT 0,
        coinsAmount INTEGER DEFAULT 0,
        type TEXT,
        reason TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.all('PRAGMA table_info(transactions)', [], (err, columns) => {
      if (err) {
        console.error('Failed to inspect transactions table:', err);
        return;
      }

      const hasCoinsAmount = columns.some((column) => column.name === 'coinsAmount');
      if (!hasCoinsAmount) {
        db.run('ALTER TABLE transactions ADD COLUMN coinsAmount INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) {
            console.error('Failed to add coinsAmount column to transactions table:', alterErr);
          }
        });
      }
    });

    // Crate opens table: logs crate openings
    db.run(`
      CREATE TABLE IF NOT EXISTS crateOpens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        reward INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Bait inventory table: tracks user baits and containers
    db.run(`
      CREATE TABLE IF NOT EXISTS baits (
        userId TEXT PRIMARY KEY,
        bait_containers INTEGER DEFAULT 0,
        common_bait INTEGER DEFAULT 0,
        uncommon_bait INTEGER DEFAULT 0,
        rare_bait INTEGER DEFAULT 0,
        epic_bait INTEGER DEFAULT 0,
        legendary_bait INTEGER DEFAULT 0,
        mythical_bait INTEGER DEFAULT 0,
        owner_bait INTEGER DEFAULT 0,
        love_bait INTEGER DEFAULT 0,
        lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Ensure existing databases have the new bait_containers column
    db.all('PRAGMA table_info(baits)', [], (err, columns) => {
      if (err) {
        console.error('Failed to inspect baits table:', err);
        return;
      }
      const hasContainers = columns.some((col) => col.name === 'bait_containers');
      if (!hasContainers) {
        db.run('ALTER TABLE baits ADD COLUMN bait_containers INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) {
            console.error('Failed to add bait_containers column:', alterErr);
          }
        });
      }
      const hasLoveBait = columns.some((col) => col.name === 'love_bait');
      if (!hasLoveBait) {
        db.run('ALTER TABLE baits ADD COLUMN love_bait INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) {
            console.error('Failed to add love_bait column:', alterErr);
          }
        });
      }
    });

    // Catch history table: logs catches
    db.run(`
      CREATE TABLE IF NOT EXISTS catches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catcherId TEXT,
        targetId TEXT,
        baitUsed TEXT,
        success BOOLEAN,
        bountyGained INTEGER,
        passiveName TEXT,
        passiveBonus INTEGER DEFAULT 0,
        released INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.all('PRAGMA table_info(catches)', [], (err, columns) => {
      if (err) {
        console.error('Failed to inspect catches table:', err);
        return;
      }

      const hasPassiveName = columns.some((col) => col.name === 'passiveName');
      const hasPassiveBonus = columns.some((col) => col.name === 'passiveBonus');
      const hasReleased = columns.some((col) => col.name === 'released');

      if (!hasPassiveName) {
        db.run('ALTER TABLE catches ADD COLUMN passiveName TEXT', (alterErr) => {
          if (alterErr) console.error('Failed to add passiveName column to catches table:', alterErr);
        });
      }

      if (!hasPassiveBonus) {
        db.run('ALTER TABLE catches ADD COLUMN passiveBonus INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) console.error('Failed to add passiveBonus column to catches table:', alterErr);
        });
      }

      if (!hasReleased) {
        db.run('ALTER TABLE catches ADD COLUMN released INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) console.error('Failed to add released column to catches table:', alterErr);
        });
      }
    });

    // Warning history table: stores moderation warnings for later viewing
    db.run(`
      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId TEXT,
        userId TEXT,
        moderatorId TEXT,
        reason TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Daily rewards table: tracks when users claimed daily rewards
    db.run(`
      CREATE TABLE IF NOT EXISTS daily_rewards (
        userId TEXT PRIMARY KEY,
        dailyStreak INTEGER DEFAULT 0,
        lastDaily DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.all('PRAGMA table_info(daily_rewards)', [], (err, columns) => {
      if (err) {
        console.error('Failed to inspect daily_rewards table:', err);
        return;
      }

      const hasDailyStreak = columns.some((col) => col.name === 'dailyStreak');
      if (!hasDailyStreak) {
        db.run('ALTER TABLE daily_rewards ADD COLUMN dailyStreak INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) {
            console.error('Failed to add dailyStreak column to daily_rewards table:', alterErr);
          }
        });
      }

      db.run(`
        CREATE TABLE IF NOT EXISTS quest_progress (
          userId TEXT PRIMARY KEY,
          dailyKey TEXT DEFAULT '',
          weeklyKey TEXT DEFAULT '',
          dailyBanditCount INTEGER DEFAULT 0,
          dailyBanditClaimed INTEGER DEFAULT 0,
          dailyMerchantCount INTEGER DEFAULT 0,
          dailyMerchantClaimed INTEGER DEFAULT 0,
          dailyOnepieceCount INTEGER DEFAULT 0,
          dailyOnepieceClaimed INTEGER DEFAULT 0,
          weeklyBanditCount INTEGER DEFAULT 0,
          weeklyBanditClaimed INTEGER DEFAULT 0,
          weeklyMerchantCount INTEGER DEFAULT 0,
          weeklyMerchantClaimed INTEGER DEFAULT 0,
          weeklyOnepieceCount INTEGER DEFAULT 0,
          weeklyOnepieceClaimed INTEGER DEFAULT 0,
          lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.all('PRAGMA table_info(quest_progress)', [], (err, columns) => {
        if (err) {
          console.error('Failed to inspect quest_progress table:', err);
          return;
        }

        const requiredColumns = [
          ['dailyKey', 'TEXT DEFAULT ""'],
          ['weeklyKey', 'TEXT DEFAULT ""'],
          ['dailyBanditCount', 'INTEGER DEFAULT 0'],
          ['dailyBanditClaimed', 'INTEGER DEFAULT 0'],
          ['dailyMerchantCount', 'INTEGER DEFAULT 0'],
          ['dailyMerchantClaimed', 'INTEGER DEFAULT 0'],
          ['dailyOnepieceCount', 'INTEGER DEFAULT 0'],
          ['dailyOnepieceClaimed', 'INTEGER DEFAULT 0'],
          ['weeklyBanditCount', 'INTEGER DEFAULT 0'],
          ['weeklyBanditClaimed', 'INTEGER DEFAULT 0'],
          ['weeklyMerchantCount', 'INTEGER DEFAULT 0'],
          ['weeklyMerchantClaimed', 'INTEGER DEFAULT 0'],
          ['weeklyOnepieceCount', 'INTEGER DEFAULT 0'],
          ['weeklyOnepieceClaimed', 'INTEGER DEFAULT 0']
        ];

        for (const [columnName, columnDefinition] of requiredColumns) {
          const hasColumn = columns.some((col) => col.name === columnName);
          if (!hasColumn) {
            db.run(`ALTER TABLE quest_progress ADD COLUMN ${columnName} ${columnDefinition}`, (alterErr) => {
              if (alterErr) {
                console.error(`Failed to add ${columnName} column to quest_progress table:`, alterErr);
              }
            });
          }
        }
      });
    });

    // Config table: stores bot configuration
    db.run(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `, (err) => {
      if (err) {
        console.error('Failed to create config table:', err);
        return reject(err);
      }
      resolve();
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS banned_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId TEXT NOT NULL,
        imageUrl TEXT NOT NULL,
        imageHash TEXT NOT NULL,
        addedBy TEXT,
        reason TEXT NOT NULL DEFAULT '',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guildId TEXT NOT NULL,
        eventType TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS processed_commands (
        messageId TEXT PRIMARY KEY,
        guildId TEXT,
        userId TEXT,
        commandName TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Failed to create processed_commands table:', err);
      }
    });

    db.all('PRAGMA table_info(processed_commands)', [], (err, columns) => {
      if (err) {
        console.error('Failed to inspect processed_commands table:', err);
        return;
      }

      const hasGuildId = columns.some((col) => col.name === 'guildId');
      if (!hasGuildId) {
        db.run('ALTER TABLE processed_commands ADD COLUMN guildId TEXT', (alterErr) => {
          if (alterErr) {
            console.error('Failed to add guildId column to processed_commands table:', alterErr);
          }
        });
      }
    });

    // Ensure users table has the economy columns used by the bot (migration for old databases)
    db.all('PRAGMA table_info(users)', [], (err, columns) => {
      if (err) {
        console.error('Failed to inspect users table:', err);
        return;
      }
      const hasCoins = columns.some((col) => col.name === 'coins');
      const hasBounty = columns.some((col) => col.name === 'bounty');

      if (!hasCoins) {
        db.run('ALTER TABLE users ADD COLUMN coins INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) {
            console.error('Failed to add coins column to users table:', alterErr);
          } else {
            console.log('✅ Added coins column to users table');
          }
        });
      }

      if (!hasBounty) {
        db.run('ALTER TABLE users ADD COLUMN bounty INTEGER DEFAULT 0', (alterErr) => {
          if (alterErr) {
            console.error('Failed to add bounty column to users table:', alterErr);
          } else {
            console.log('✅ Added bounty column to users table');
          }
        });
      }
    });

    console.log('Database tables initialized');
  });
});
}

// Get user data
function getUser(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE userId = ?', [userId], (err, row) => {
      if (err) reject(err);
      resolve(row);
    });
  });
}

// Create or get user
async function ensureUser(userId) {
  const user = await getUser(userId);
  if (!user) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (userId, credits, tokens, coins) VALUES (?, ?, ?, ?)',
        [userId, 0, 0, 0],
        function(err) {
          if (err) reject(err);
          resolve({ userId, credits: 0, tokens: 0, messageCount: 0 });
        }
      );
    });
  }
  return user;
}

// Add credits to user
function addCredits(userId, amount, reason = 'manual') {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET credits = credits + ? WHERE userId = ?',
      [amount, userId],
      function(err) {
        if (err) reject(err);
        db.run(
          'INSERT INTO transactions (toUserId, creditsAmount, type, reason) VALUES (?, ?, ?, ?)',
          [userId, amount, 'credit_add', reason],
          (err) => {
            if (err) reject(err);
            resolve();
          }
        );
      }
    );
  });
}

// Add tokens to user
function addTokens(userId, amount, reason = 'manual') {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET tokens = tokens + ? WHERE userId = ?',
      [amount, userId],
      function(err) {
        if (err) reject(err);
        db.run(
          'INSERT INTO transactions (toUserId, tokensAmount, type, reason) VALUES (?, ?, ?, ?)',
          [userId, amount, 'token_add', reason],
          (err) => {
            if (err) reject(err);
            resolve();
          }
        );
      }
    );
  });
}

// Add coins to user
function addCoins(userId, amount, reason = 'manual') {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET coins = coins + ? WHERE userId = ?',
      [amount, userId],
      function(err) {
        if (err) reject(err);
        db.run(
          'INSERT INTO transactions (toUserId, coinsAmount, type, reason) VALUES (?, ?, ?, ?)',
          [userId, amount, 'coin_add', reason],
          (err) => {
            if (err) reject(err);
            resolve();
          }
        );
      }
    );
  });
}

// Deduct coins from user
function deductCoins(userId, amount, reason = 'manual') {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET coins = coins - ? WHERE userId = ? AND coins >= ?',
      [amount, userId, amount],
      function(err) {
        if (err) reject(err);
        const changed = this.changes || 0;
        if (changed === 0) {
          resolve(false);
          return;
        }
        db.run(
          'INSERT INTO transactions (fromUserId, coinsAmount, type, reason) VALUES (?, ?, ?, ?)',
          [userId, -amount, 'coin_deduct', reason],
          (err) => {
            if (err) reject(err);
            resolve(true);
          }
        );
      }
    );
  });
}

// Transfer coins between users (from -> to)
function transferCoins(fromUserId, toUserId, amount, reason = 'transfer') {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run(
        'UPDATE users SET coins = coins - ? WHERE userId = ? AND coins >= ?',
        [amount, fromUserId, amount],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }
          if ((this.changes || 0) === 0) {
            db.run('ROLLBACK');
            return resolve(false);
          }
          db.run(
            'UPDATE users SET coins = coins + ? WHERE userId = ?',
            [amount, toUserId],
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                return reject(err);
              }
              db.run(
                'INSERT INTO transactions (fromUserId, toUserId, coinsAmount, type, reason) VALUES (?, ?, ?, ?, ?)',
                [fromUserId, toUserId, amount, 'coin_transfer', reason],
                (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    return reject(err);
                  }
                  db.run('COMMIT');
                  resolve(true);
                }
              );
            }
          );
        }
      );
    });
  });
}

// Convert credits to tokens (every 100 credits = 1 token)
async function convertCreditsToTokens(userId) {
  const user = await getUser(userId);
  if (!user) return 0;

  const tokensToAdd = Math.floor(user.credits / 100);
  if (tokensToAdd > 0) {
    const creditsToRemove = tokensToAdd * 100;
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET credits = credits - ?, tokens = tokens + ? WHERE userId = ?',
        [creditsToRemove, tokensToAdd, userId],
        function(err) {
          if (err) reject(err);
          db.run(
            'INSERT INTO transactions (toUserId, creditsAmount, tokensAmount, type, reason) VALUES (?, ?, ?, ?, ?)',
            [userId, -creditsToRemove, tokensToAdd, 'conversion', 'auto_conversion'],
            (err) => {
              if (err) reject(err);
              resolve(tokensToAdd);
            }
          );
        }
      );
    });
  }
  return 0;
}

// Open crate and get reward
function openCrate(userId) {
  const reward = calculateCrateReward();
  return new Promise((resolve, reject) => {
    // If reward is a number, add credits; otherwise (e.g., 'custom_role') only log the crate open
    if (typeof reward === 'number') {
      db.run(
        'UPDATE users SET credits = credits + ? WHERE userId = ?',
        [reward, userId],
        function(err) {
          if (err) return reject(err);
          db.run(
            'INSERT INTO crateOpens (userId, reward) VALUES (?, ?)',
            [userId, reward],
            (err) => {
              if (err) return reject(err);
              resolve(reward);
            }
          );
        }
      );
    } else {
      db.run(
        'INSERT INTO crateOpens (userId, reward) VALUES (?, ?)',
        [userId, reward],
        (err) => {
          if (err) return reject(err);
          resolve(reward);
        }
      );
    }
  });
}

// Get leaderboard
function getLeaderboard(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT userId, credits, tokens, messageCount FROM users ORDER BY credits DESC LIMIT ?',
      [limit],
      (err, rows) => {
        if (err) reject(err);
        resolve(rows || []);
      }
    );
  });
}

// Get bounty leaderboard
function getBountyLeaderboard(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT userId, bounty FROM users ORDER BY bounty DESC LIMIT ?',
      [limit],
      (err, rows) => {
        if (err) reject(err);
        resolve(rows || []);
      }
    );
  });
}

// Get coin leaderboard
function getCoinsLeaderboard(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT userId, coins FROM users ORDER BY coins DESC LIMIT ?',
      [limit],
      (err, rows) => {
        if (err) reject(err);
        resolve(rows || []);
      }
    );
  });
}

// Get catch history for a user
function getCatchHistory(catcherId, limit = 20) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM catches WHERE catcherId = ? ORDER BY timestamp DESC LIMIT ?',
      [catcherId, limit],
      (err, rows) => {
        if (err) reject(err);
        resolve(rows || []);
      }
    );
  });
}

function canApplySeaEmperorBonus(source) {
  return ['daily', 'container', 'catch'].includes(String(source || '').toLowerCase());
}

function getBountyPassiveProfile(userId, source = '') {
  return new Promise((resolve, reject) => {
    db.get('SELECT bounty FROM users WHERE userId = ?', [userId], (bountyErr, bountyRow) => {
      if (bountyErr) {
        reject(bountyErr);
        return;
      }

      const currentBounty = bountyRow?.bounty || 0;
      if (currentBounty >= 1000000) {
          const normalizedSource = String(source || '').toLowerCase();
          const seaEmperorBonusBySource = {
            daily: { bonusAmount: 10000, displayText: 'Sea Emperor gives +10,000 bounty' },
            container: { bonusAmount: 10000, displayText: 'Sea Emperor gives +10,000 bounty' },
            catch: { bonusAmount: 10000, displayText: 'Sea Emperor gives +10,000 bounty' },
            sail_bandit: { bonusAmount: getRandomInteger(5000, 10000), displayText: 'Sea Emperor gives 5,000-10,000 bounty from bandits' },
            sail_merchant: { bonusAmount: getRandomInteger(10000, 15000), displayText: 'Sea Emperor gives 10,000-15,000 bounty from merchants' },
            sail_wealthy_ship: { bonusAmount: getRandomInteger(20000, 30000), displayText: 'Sea Emperor gives 20,000-30,000 bounty from wealthy ships' },
            sail_one_piece: { bonusAmount: getRandomInteger(200000, 300000), displayText: 'Sea Emperor gives 200,000-300,000 bounty from One Piece treasure' },
            summary: { bonusAmount: 6767, displayText: 'Sea Emperor gives +6,767 bounty' }
          };
          const seaEmperor = seaEmperorBonusBySource[normalizedSource] || seaEmperorBonusBySource.summary;
        resolve({
          multiplier: 1,
            title: seaEmperor.displayText,
            bonusAmount: seaEmperor.bonusAmount,
            displayBonusAmount: normalizedSource === 'summary' || !normalizedSource ? 6767 : seaEmperor.bonusAmount,
            bonusText: seaEmperor.displayText,
          bonusPercent: 0,
            passivePieces: [{ name: 'Sea Emperor', bonusAmount: seaEmperor.bonusAmount, displayText: seaEmperor.displayText }]
        });
        return;
      }

      db.all(
        `SELECT baitUsed, COUNT(*) AS uses
         FROM catches
         WHERE catcherId = ? AND success = 1 AND baitUsed IN ('legendary_bait', 'mythical_bait', 'owner_bait')
         GROUP BY baitUsed`,
        [userId],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          const baitSet = new Set((rows || []).map((row) => row.baitUsed));
          const tiers = [
            { bait: 'legendary_bait', percent: 10, label: 'Legendary Hunter' },
            { bait: 'mythical_bait', percent: 20, label: 'Mythical Hunter' },
            { bait: 'owner_bait', percent: 30, label: 'Owner Hunter' }
          ];

          const activeTiers = tiers.filter((tier) => baitSet.has(tier.bait));
          const totalPercent = activeTiers.reduce((sum, tier) => sum + tier.percent, 0);
          const passivePieces = activeTiers.map((tier) => ({
            name: tier.label,
            bonusPercent: tier.percent,
            displayText: `${tier.label} gives ${tier.percent}% more bounty`
          }));
          const title = passivePieces.length > 0
            ? passivePieces.map((piece) => piece.displayText).join(' + ')
            : null;

          resolve({
            multiplier: 1 + (totalPercent / 100),
            title,
            bonusAmount: 0,
            bonusPercent: totalPercent,
            passivePieces
          });
        }
      );
    });
  });
}

async function applyBountyPassiveBonus(userId, bountyAmount, source = '') {
  const amount = Number.parseInt(bountyAmount, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { amount: 0, multiplier: 1, title: null, bonusAmount: 0, bonusPercent: 0 };
  }

  const profile = await getBountyPassiveProfile(userId, source);
  const bonusAmount = profile.bonusAmount ?? Math.floor(amount * (profile.multiplier - 1));
  return {
    amount: amount + bonusAmount,
    multiplier: profile.multiplier,
    title: profile.title,
    bonusAmount,
    bonusPercent: profile.bonusPercent || 0,
    displayBonusAmount: profile.displayBonusAmount ?? bonusAmount,
    bonusText: profile.bonusText || profile.title,
    passivePieces: profile.passivePieces || []
  };
}

function getDailyClaimRow(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT userId, dailyStreak, lastDaily FROM daily_rewards WHERE userId = ?',
      [userId],
      (err, row) => {
        if (err) reject(err);
        resolve(row || null);
      }
    );
  });
}

function upsertDailyClaim(userId, dailyStreak) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO daily_rewards (userId, dailyStreak, lastDaily) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [userId, dailyStreak],
      function(err) {
        if (err) reject(err);
        resolve();
      }
    );
  });
}

function getQuestDateKeys(referenceDate = new Date()) {
  const date = new Date(referenceDate);
  const dailyKey = date.toISOString().slice(0, 10);

  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  const weeklyKey = `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;

  return { dailyKey, weeklyKey };
}

function getQuestStateRow(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM quest_progress WHERE userId = ?', [userId], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row || null);
    });
  });
}

async function ensureQuestProgress(userId) {
  const currentKeys = getQuestDateKeys();

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO quest_progress (userId, dailyKey, weeklyKey, dailyBanditCount, dailyBanditClaimed, dailyMerchantCount, dailyMerchantClaimed, dailyOnepieceCount, dailyOnepieceClaimed, weeklyBanditCount, weeklyBanditClaimed, weeklyMerchantCount, weeklyMerchantClaimed, weeklyOnepieceCount, weeklyOnepieceClaimed)
       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
      [userId, currentKeys.dailyKey, currentKeys.weeklyKey],
      async (insertErr) => {
        if (insertErr) {
          reject(insertErr);
          return;
        }

        try {
          await refreshQuestPeriods(userId);
          resolve(await getQuestStateRow(userId));
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}

async function refreshQuestPeriods(userId) {
  const row = await getQuestStateRow(userId);
  if (!row) {
    return ensureQuestProgress(userId);
  }

  const { dailyKey, weeklyKey } = getQuestDateKeys();
  const updates = [];
  const params = [];

  if (row.dailyKey !== dailyKey) {
    updates.push('dailyKey = ?', 'dailyBanditCount = 0', 'dailyBanditClaimed = 0', 'dailyMerchantCount = 0', 'dailyMerchantClaimed = 0', 'dailyOnepieceCount = 0', 'dailyOnepieceClaimed = 0');
    params.push(dailyKey);
  }

  if (row.weeklyKey !== weeklyKey) {
    updates.push('weeklyKey = ?', 'weeklyBanditCount = 0', 'weeklyBanditClaimed = 0', 'weeklyMerchantCount = 0', 'weeklyMerchantClaimed = 0', 'weeklyOnepieceCount = 0', 'weeklyOnepieceClaimed = 0');
    params.push(weeklyKey);
  }

  if (updates.length > 0) {
    params.push(userId);
    await new Promise((resolve, reject) => {
      db.run(`UPDATE quest_progress SET ${updates.join(', ')}, lastUpdated = CURRENT_TIMESTAMP WHERE userId = ?`, params, function(err) {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      });
    });
  }
}

function buildQuestColumnName(period, questKey, suffix) {
  const map = {
    bandit: 'Bandit',
    merchant: 'Merchant',
    onepiece: 'Onepiece'
  };

  return `${period}${map[questKey]}${suffix}`;
}

async function getQuestProgress(userId) {
  await ensureQuestProgress(userId);
  await refreshQuestPeriods(userId);
  return getQuestStateRow(userId);
}

async function incrementQuestProgress(userId, period, questKey, amount = 1) {
  const normalizedPeriod = String(period || '').toLowerCase();
  const normalizedQuestKey = String(questKey || '').toLowerCase();
  const incrementAmount = Number.isFinite(amount) && amount > 0 ? amount : 1;
  const countColumn = buildQuestColumnName(normalizedPeriod, normalizedQuestKey, 'Count');
  const claimedColumn = buildQuestColumnName(normalizedPeriod, normalizedQuestKey, 'Claimed');
  const currentRow = await getQuestProgress(userId);

  if (!currentRow || !countColumn || !Object.prototype.hasOwnProperty.call(currentRow, countColumn)) {
    return null;
  }

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE quest_progress SET ${countColumn} = ${countColumn} + ?, lastUpdated = CURRENT_TIMESTAMP WHERE userId = ?`,
      [incrementAmount, userId],
      async function(err) {
        if (err) {
          reject(err);
          return;
        }

        try {
          resolve({
            changes: this.changes || 0,
            state: await getQuestProgress(userId),
            countColumn,
            claimedColumn
          });
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}

async function claimQuestReward(userId, period, questKey, questDefinition) {
  const state = await getQuestProgress(userId);
  const normalizedPeriod = String(period || '').toLowerCase();
  const normalizedQuestKey = String(questKey || '').toLowerCase();
  const countColumn = buildQuestColumnName(normalizedPeriod, normalizedQuestKey, 'Count');
  const claimedColumn = buildQuestColumnName(normalizedPeriod, normalizedQuestKey, 'Claimed');
  const countValue = Number.parseInt(state?.[countColumn], 10) || 0;
  const claimedValue = Number.parseInt(state?.[claimedColumn], 10) || 0;

  if (claimedValue > 0) {
    return { ok: false, reason: 'claimed', state };
  }

  if (countValue <= 0) {
    return { ok: false, reason: 'not_started', state };
  }

  if (countValue < questDefinition.required) {
    return { ok: false, reason: 'incomplete', state };
  }

  await addBounty(userId, questDefinition.reward);

  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE quest_progress SET ${claimedColumn} = 1, lastUpdated = CURRENT_TIMESTAMP WHERE userId = ?`,
      [userId],
      function(err) {
        if (err) {
          reject(err);
          return;
        }

        resolve();
      }
    );
  });

  return { ok: true, state: await getQuestProgress(userId) };
}

// Deduct tokens (for crate opening)
function deductTokens(userId, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET tokens = tokens - ? WHERE userId = ?',
      [amount, userId],
      function(err) {
        if (err) reject(err);
        resolve();
      }
    );
  });
}

// Increment message count
function incrementMessageCount(userId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET messageCount = messageCount + 1 WHERE userId = ?',
      [userId],
      function(err) {
        if (err) reject(err);
        resolve();
      }
    );
  });
}

// Get user bounty
function getBounty(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT bounty FROM users WHERE userId = ?', [userId], (err, row) => {
      if (err) reject(err);
      resolve(row?.bounty || 0);
    });
  });
}

// Add bounty to user
function addBounty(userId, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET bounty = bounty + ? WHERE userId = ?',
      [amount, userId],
      function(err) {
        if (err) reject(err);
        resolve();
      }
    );
  });
}

// Get user bait inventory
function getBaits(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM baits WHERE userId = ?', [userId], (err, row) => {
      if (err) reject(err);
      resolve(row || { userId, bait_containers: 0, common_bait: 0, uncommon_bait: 0, rare_bait: 0, epic_bait: 0, legendary_bait: 0, mythical_bait: 0, owner_bait: 0, love_bait: 0 });
    });
  });
}

// Ensure user has bait inventory
async function ensureBaits(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM baits WHERE userId = ?', [userId], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row);

      db.run(
        'INSERT INTO baits (userId, bait_containers, common_bait, uncommon_bait, rare_bait, epic_bait, legendary_bait, mythical_bait, owner_bait) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, 0, 0, 0, 0, 0, 0, 0, 0],
        function(insertErr) {
          if (insertErr) return reject(insertErr);
          resolve({ userId, bait_containers: 0, common_bait: 0, uncommon_bait: 0, rare_bait: 0, epic_bait: 0, legendary_bait: 0, mythical_bait: 0, owner_bait: 0, love_bait: 0 });
        }
      );
    });
  });
}

// Add bait to user
function addBait(userId, baitType, amount = 1) {
  return new Promise((resolve, reject) => {
    ensureBaits(userId).then(() => {
      db.run(
        `UPDATE baits SET ${baitType} = ${baitType} + ? WHERE userId = ?`,
        [amount, userId],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    }).catch(reject);
  });
}

// Deduct bait from user
function deductBait(userId, baitType, amount = 1) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE baits SET ${baitType} = MAX(0, ${baitType} - ?) WHERE userId = ?`,
      [amount, userId],
      function(err) {
        if (err) reject(err);
        resolve();
      }
    );
  });
}

// Record a catch
function recordCatch(catcherId, targetId, baitUsed, success, bountyGained = 0, passiveName = null, passiveBonus = 0) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO catches (catcherId, targetId, baitUsed, success, bountyGained, passiveName, passiveBonus, released) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [catcherId, targetId, baitUsed, success ? 1 : 0, bountyGained, passiveName, passiveBonus],
      function(err) {
        if (err) reject(err);
        resolve();
      }
    );
  });
}

// Get unique active targets successfully caught by a user
function getCaughtTargets(catcherId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT targetId, baitUsed, passiveName, passiveBonus, bountyGained, timestamp AS lastCaught
       FROM catches
       WHERE catcherId = ? AND success = 1 AND COALESCE(released, 0) = 0
       ORDER BY timestamp DESC`,
      [catcherId],
      (err, rows) => {
        if (err) reject(err);
        const latestByTarget = new Map();
        for (const row of rows || []) {
          if (!latestByTarget.has(row.targetId)) {
            latestByTarget.set(row.targetId, row);
          }
        }

        resolve([...latestByTarget.values()]);
      }
    );
  });
}

function releaseCaughtTarget(catcherId, targetId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE catches SET released = 1 WHERE catcherId = ? AND targetId = ? AND success = 1 AND COALESCE(released, 0) = 0',
      [catcherId, targetId],
      function(err) {
        if (err) {
          reject(err);
          return;
        }

        resolve(this.changes || 0);
      }
    );
  });
}

// Record a moderation warning
function recordWarning(guildId, userId, moderatorId, reason) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO warnings (guildId, userId, moderatorId, reason) VALUES (?, ?, ?, ?)',
      [guildId, userId, moderatorId, reason],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });
}

// Get warnings for a guild or user
function getWarnings({ guildId, userId, limit = 10 }) {
  return new Promise((resolve, reject) => {
    const conditions = [];
    const params = [];

    if (guildId) {
      conditions.push('guildId = ?');
      params.push(guildId);
    }

    if (userId) {
      conditions.push('userId = ?');
      params.push(userId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    db.all(
      `SELECT * FROM warnings ${whereClause} ORDER BY timestamp DESC LIMIT ?`,
      [...params, limit],
      (err, rows) => {
        if (err) reject(err);
        resolve(rows || []);
      }
    );
  });
}

// Delete all warnings for a user in a guild
function deleteWarnings(guildId, userId) {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM warnings WHERE guildId = ? AND userId = ?',
      [guildId, userId],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes || 0);
      }
    );
  });
}

// Delete a single warning by its ID (and ensure it belongs to the guild)
function deleteWarningById(guildId, warningId) {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM warnings WHERE id = ? AND guildId = ?',
      [warningId, guildId],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes || 0);
      }
    );
  });
}

// Get recent command logs from the processed command table
function getCommandLogs({ guildId = null, userId = null, limit = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const conditions = [];
    const params = [];

    if (guildId) {
      conditions.push('guildId = ?');
      params.push(guildId);
    }

    if (userId) {
      conditions.push('userId = ?');
      params.push(userId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    db.all(
      `SELECT * FROM processed_commands ${whereClause} ORDER BY timestamp DESC LIMIT ?`,
      [...params, limit],
      (err, rows) => {
        if (err) reject(err);
        resolve(rows || []);
      }
    );
  });
}

// Get all-time usage counts for owner/admin commands
function getAdminCommandUsageCounts({ guildId = null } = {}) {
  return new Promise((resolve, reject) => {
    const conditions = [];
    const params = [];

    if (guildId) {
      conditions.push('guildId = ?');
      params.push(guildId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    db.all(
      `SELECT commandName, COUNT(*) AS uses FROM processed_commands ${whereClause} GROUP BY commandName ORDER BY uses DESC`,
      params,
      (err, rows) => {
        if (err) reject(err);
        resolve(rows || []);
      }
    );
  });
}

// Get config value
function getConfig(key) {
  return new Promise((resolve, reject) => {
    db.get('SELECT value FROM config WHERE key = ?', [key], (err, row) => {
      if (err) reject(err);
      resolve(row?.value || null);
    });
  });
}

// Set config value
function setConfig(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      [key, value],
      function(err) {
        if (err) reject(err);
        resolve();
      }
    );
  });
}

// Delete config value
function deleteConfig(key) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM config WHERE key = ?', [key], function(err) {
      if (err) reject(err);
      resolve();
    });
  });
}

function addBannedImage(guildId, imageUrl, imageHash, addedBy, reason) {
  return ensureBannedImagesReasonColumn().then(() => new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO banned_images (guildId, imageUrl, imageHash, addedBy, reason) VALUES (?, ?, ?, ?, ?)',
      [guildId, imageUrl, imageHash, addedBy || null, reason],
      function(err) {
        if (err) return reject(err);
        const id = this.lastID;
        db.get('SELECT createdAt FROM banned_images WHERE id = ?', [id], (selectErr, row) => {
          if (selectErr) return reject(selectErr);
          resolve({
            id,
            guildId,
            imageUrl,
            imageHash,
            addedBy: addedBy || null,
            reason,
            createdAt: row?.createdAt || null
          });
        });
      }
    );
  }));
}

function getBannedImages(guildId) {
  return ensureBannedImagesReasonColumn().then(() => new Promise((resolve, reject) => {
    db.all('SELECT * FROM banned_images WHERE guildId = ? ORDER BY id ASC', [guildId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  }));
}

function removeBannedImage(guildId, id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM banned_images WHERE guildId = ? AND id = ?', [guildId, id], function(err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
}

function recordAuditLog(guildId, eventType, title, description) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO audit_logs (guildId, eventType, title, description) VALUES (?, ?, ?, ?)',
      [guildId, eventType, title, description || null],
      function(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function getAuditLogs(guildId, limit = 50) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM audit_logs WHERE guildId = ? ORDER BY id DESC LIMIT ?', [guildId, limit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function recordProcessedCommand(messageId, guildId, userId, commandName) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR IGNORE INTO processed_commands (messageId, guildId, userId, commandName) VALUES (?, ?, ?, ?)'
      , [messageId, guildId || null, userId, commandName],
      function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes === 1);
      }
    );
  });
}

async function getLockedNickname(guildId, userId) {
  return await getConfig(`lockednick:${guildId}:${userId}`);
}

async function setLockedNickname(guildId, userId, nickname) {
  if (nickname === null) {
    return deleteConfig(`lockednick:${guildId}:${userId}`);
  }
  return setConfig(`lockednick:${guildId}:${userId}`, nickname);
}

async function getExecutedNickname(guildId, userId) {
  return await getConfig(`executednick:${guildId}:${userId}`);
}

async function setExecutedNickname(guildId, userId, nickname) {
  if (nickname === null) {
    return deleteConfig(`executednick:${guildId}:${userId}`);
  }
  return setConfig(`executednick:${guildId}:${userId}`, nickname);
}

async function getBotPingMemory(userId) {
  const raw = await getConfig(`botmemory:${userId}`);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function updateBotPingMemory(userId, patch = {}) {
  const current = await getBotPingMemory(userId);
  const now = Date.now();
  const next = {
    userId,
    pingCount: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    lastMessage: '',
    familiar: false,
    ...current,
    ...patch
  };

  next.userId = userId;
  next.pingCount = Number.isFinite(Number(next.pingCount)) ? Number(next.pingCount) : 0;
  next.firstSeenAt = Number.isFinite(Number(next.firstSeenAt)) ? Number(next.firstSeenAt) : now;
  next.lastSeenAt = now;
  next.familiar = next.pingCount >= 4 || Boolean(next.familiar);

  await setConfig(`botmemory:${userId}`, JSON.stringify(next));
  return next;
}

module.exports = {
  db,
  initializeDatabase,
  getUser,
  ensureUser,
  addCredits,
  addTokens,
  convertCreditsToTokens,
  openCrate,
  getLeaderboard,
  deductTokens,
  incrementMessageCount,
  getBaits,
  ensureBaits,
  addBait,
  deductBait,
  recordCatch,
  getCaughtTargets,
  releaseCaughtTarget,
  getBounty,
  getBountyLeaderboard,
  getCoinsLeaderboard,
  getCatchHistory,
  getBountyPassiveProfile,
  applyBountyPassiveBonus,
  getDailyClaimRow,
  upsertDailyClaim,
  getQuestDateKeys,
  getQuestProgress,
  incrementQuestProgress,
  claimQuestReward,
  addBounty,
  getConfig,
  setConfig,
  deleteConfig,
  addBannedImage,
  getBannedImages,
  removeBannedImage,
  recordAuditLog,
  getAuditLogs,
  getLockedNickname,
  setLockedNickname,
  getExecutedNickname,
  setExecutedNickname,
  getBotPingMemory,
  updateBotPingMemory,
  recordProcessedCommand,
  recordWarning,
  getWarnings,
  addCoins,
  deductCoins,
  transferCoins,
  getCommandLogs,
  getAdminCommandUsageCounts
};
