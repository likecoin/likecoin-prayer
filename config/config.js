const config = {};

config.FIRESTORE_USER_ROOT = '';
config.FIRESTORE_TX_ROOT = '';
config.FIRESTORE_PAYOUT_ROOT = '';

config.GCLOUD_PUBSUB_MAX_MESSAGES = 10;
config.GCLOUD_PUBSUB_MAX_WAIT = 1000;
config.GCLOUD_PUBSUB_ENABLE = false;

config.ACCOUNT_INDEX_OVERRIDE = 1;

config.POLLING_DELAY = 10 * 1000;

module.exports = config;
