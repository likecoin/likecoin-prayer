const {
  db,
  txCollection: txLogRef,
} = require('./firebase');
const publisher = require('./gcloudPub');
const { getGasPrice } = require('./poller');

const Web3 = require('web3');

const PUBSUB_TOPIC_MISC = 'misc';
const INFURA_HOST = process.env.IS_TESTNET ? 'https://rinkeby.infura.io/0nSXv3EyFEKw7Alq0z4c' : 'https://mainnet.infura.io/0nSXv3EyFEKw7Alq0z4c';
const web3 = new Web3(new Web3.providers.HttpProvider(INFURA_HOST));
const accounts = require('../config/accounts.js');

const {
  address,
  privateKey,
  gasLimit,
} = accounts[0];

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendTransaction(tx) {
  return new Promise((resolve, reject) => {
    const txEventEmitter = web3.eth.sendSignedTransaction(tx.rawTransaction);
    txEventEmitter.on('transactionHash', resolve)
      .on('error', (err) => {
        if (err.message === 'Returned error: replacement transaction underpriced'
          || err.message.includes('Returned error: known transaction:')) resolve(false);
        else reject(err);
      });
  });
}

async function signTransaction(addr, txData, pendingCount) {
  return web3.eth.accounts.signTransaction({
    to: addr,
    nonce: pendingCount,
    data: txData,
    gasPrice: getGasPrice(),
    gas: gasLimit,
  }, privateKey);
}

async function sendTransactionWithLoop(addr, txData) {
  const counterRef = txLogRef.doc(`!counter_${address}`);
  let pendingCount = await db.runTransaction(t => t.get(counterRef).then((d) => {
    const v = d.data().value + 1;
    t.update(counterRef, { value: v });
    return d.data().value;
  }));
  let tx = await signTransaction(addr, txData, pendingCount);
  let txHash;
  try {
    txHash = await sendTransaction(tx);
  } catch (err) {
    console.log(`Nonce ${pendingCount} failed, trying web3 pending`); // eslint-disable-line no-console
  }
  try {
    while (!txHash) {
      /* eslint-disable no-await-in-loop */
      pendingCount = await web3.eth.getTransactionCount(address, 'pending');
      tx = await signTransaction(addr, txData, pendingCount);
      txHash = await sendTransaction(tx);
      if (!txHash) {
        await timeout(200);
      }
    }
    await db.runTransaction(t => t.get(counterRef).then((d) => {
      if (pendingCount + 1 > d.data().value) {
        return t.update(counterRef, {
          value: pendingCount + 1,
        });
      }
      return Promise.resolve();
    }));
  } catch (err) {
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'eventInfuraError',
      fromWallet: address,
      txHash,
      rawSignedTx: tx.rawTransaction,
      txNonce: pendingCount,
      error: err.toString(),
    });
    throw err;
  }
  return {
    tx,
    txHash,
    delegatorAddress: address,
    pendingCount,
  };
}

module.exports = { web3, sendTransactionWithLoop };
