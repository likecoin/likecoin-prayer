const admin = require('firebase-admin');

const config = require('../config/config.js');
const serviceAccount = require('../config/serviceAccountKey.json');

if (process.env.CI) {
  module.exports = {
    userCollection: {},
    txCollection: {},
    payoutCollection: {},
    configCollection: {},
  };
} else {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  const db = admin.firestore();
  const userCollection = db.collection(config.FIRESTORE_USER_ROOT);
  const txCollection = db.collection(config.FIRESTORE_TX_ROOT);
  const payoutCollection = db.collection(config.FIRESTORE_PAYOUT_ROOT);
  const configCollection = db.collection(config.FIRESTORE_CONFIG_ROOT);

  module.exports = {
    db,
    userCollection,
    txCollection,
    payoutCollection,
    configCollection,
  };
}
