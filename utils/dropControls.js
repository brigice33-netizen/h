const CONTAINER_DROPS_CONFIG_KEY = 'container_drops_enabled';
const COIN_DROPS_CONFIG_KEY = 'coin_drops_enabled';

function isDropEnabled(value) {
  const normalized = String(value ?? 'true').trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  return true;
}

module.exports = {
  CONTAINER_DROPS_CONFIG_KEY,
  COIN_DROPS_CONFIG_KEY,
  isDropEnabled
};
