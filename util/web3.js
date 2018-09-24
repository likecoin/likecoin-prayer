const BigNumber = require('bignumber.js');
const Web3 = require('web3');

const {
  db,
  txCollection: txLogRef,
} = require('./firebase');
const publisher = require('./gcloudPub');
const { getGasPrice } = require('./poller');

const PUBSUB_TOPIC_MISC = 'misc';
const INFURA_HOST = process.env.IS_TESTNET ? 'https://rinkeby.infura.io/v3/3981482524b045a2a5d4f539c07c2cc6' : 'https://mainnet.infura.io/v3/3981482524b045a2a5d4f539c07c2cc6';
const web3 = new Web3(new Web3.providers.HttpProvider(INFURA_HOST));
const config = require('../config/config.js');
const accounts = require('../config/accounts.js');

let targetAccount = accounts[0];
if (config.ACCOUNT_INDEX_OVERRIDE) {
  targetAccount = accounts[config.ACCOUNT_INDEX_OVERRIDE] || accounts[0];
}

const {
  address,
  privateKey,
  gasLimit,
} = targetAccount;

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendTransaction(tx) {
  return new Promise((resolve, reject) => {
    const txEventEmitter = web3.eth.sendSignedTransaction(tx.rawTransaction);
    txEventEmitter.on('transactionHash', resolve)
      .on('error', (err) => {
        if (err.message === 'Returned error: replacement transaction underpriced') {
          resolve(false);
        } else if (err.message.includes('Returned error: known transaction:')) {
          resolve(web3.utils.sha3(tx.rawTransaction));
        } else {
          reject(err);
        }
      });
  });
}

async function signTransaction(addr, txData, pendingCount, gasPrice) {
  return web3.eth.accounts.signTransaction({
    to: addr,
    nonce: pendingCount,
    data: txData,
    gasPrice,
    gas: gasLimit,
  }, privateKey);
}

async function sendTransactionWithLoop(addr, txData) {
  const RETRY_LIMIT = 10;
  let retryCount = 0;
  let retry = false;
  let txHash;
  let tx;
  let networkGas = await web3.eth.getGasPrice();
  networkGas = BigNumber.max(networkGas, '1500000000'); // min 1.5gwei
  const gasPrice = BigNumber.min(getGasPrice(), networkGas).toString();
  const counterRef = txLogRef.doc(`!counter_${address}`);
  let pendingCount = await db.runTransaction(async (t) => {
    const d = await t.get(counterRef);
    const v = d.data().value + 1;
    await t.update(counterRef, { value: v });
    return d.data().value;
  });
  /* eslint-disable no-await-in-loop */
  do {
    retry = false;
    tx = await signTransaction(addr, txData, pendingCount, gasPrice);
    try {
      txHash = await sendTransaction(tx);
    } catch (err) {
      console.error(err);
      if (err.message.includes('replacement transaction underpriced')
        || err.message.includes('nonce too low')) {
        console.log(`Nonce ${pendingCount} failed, trying web3 pending`);
      } else {
        retry = true;
        retryCount += 1;
      }
    }
  } while (retry && retryCount < RETRY_LIMIT);
  try {
    while (!txHash) {
      /* eslint-disable no-await-in-loop */
      pendingCount = await web3.eth.getTransactionCount(address, 'pending');
      tx = await signTransaction(addr, txData, pendingCount, gasPrice);
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
    gasPrice,
    delegatorAddress: address,
    pendingCount,
  };
}

module.exports = { web3, sendTransactionWithLoop };
