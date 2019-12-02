const dbRef = require('../util/firebase').txCollection;

async function logEthPayoutTx(payload) {
  const { txHash } = payload;
  try {
    await dbRef.doc(txHash).create({
      type: 'payout',
      status: 'pending',
      ts: Date.now(),
      ...payload,
    });
  } catch (err) {
    console.error('logEthPayoutTx():', err); // eslint-disable-line no-console
  }
}

async function logCosmosPayoutTx(payload) {
  const { txHash } = payload;
  try {
    await dbRef.doc(txHash).create({
      type: 'cosmosPayout',
      status: 'pending',
      ts: Date.now(),
      remarks: payload.memo,
      ...payload,
    });
  } catch (err) {
    console.error('logCosmosPayoutTx():', err); // eslint-disable-line no-console
  }
}

module.exports = {
  logEthPayoutTx,
  logCosmosPayoutTx,
};
