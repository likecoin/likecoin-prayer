const config = {};

config.FIRESTORE_USER_ROOT = '';
config.FIRESTORE_TX_ROOT = '';
config.FIRESTORE_PAYOUT_ROOT = '';

config.GCLOUD_PUBSUB_MAX_MESSAGES = 10;
config.GCLOUD_PUBSUB_MAX_WAIT = 1000;
config.GCLOUD_PUBSUB_ENABLE = false;

config.ACCOUNT_INDEX_OVERRIDE = 1;

config.POLLING_DELAY = 10 * 1000;

config.COSMOS_LCD_ENDPOINT = '';
config.COSMOS_CHAIN_ID = '';
config.COSMOS_DENOM = 'nanolike';
config.COSMOS_BLOCK_TIME = 5000;
config.COSMOS_GAS = '200000';

module.exports = config;
