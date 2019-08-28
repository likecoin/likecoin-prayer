const axios = require('axios');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const secp256k1 = require('secp256k1');
const bech32 = require('bech32');
const jsonStringify = require('fast-json-stable-stringify');

const { privKey: cosmosKey } = require('../config/cosmos.json'); // 32-byte, 64-digit hex str
const config = require('../config/config.js');
const {
  db,
  txCollection: txLogRef,
} = require('./firebase');
const publisher = require('./gcloudPub');

const PUBSUB_TOPIC_MISC = 'misc';
const {
  COSMOS_LCD_ENDPOINT,
  COSMOS_BLOCK_TIME = 5000,
  COSMOS_GAS = '200000',
  COSMOS_DENOM = 'nanolike',
  COSMOS_CHAIN_ID = '',
} = config;

const api = axios.create({
  baseURL: `http://${COSMOS_LCD_ENDPOINT}`,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
});

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCurrentHeight() {
  const res = await api.get('/blocks/latest');
  const { block_meta: { header: height } } = res.data;
  return height;
}

function createSigner(privKey) {
  const privateKey = Buffer.from(privKey, 'hex');
  const publicKey = secp256k1.publicKeyCreate(privateKey, true);
  const sha256 = crypto.createHash('sha256');
  const ripemd = crypto.createHash('ripemd160');
  sha256.update(publicKey);
  ripemd.update(sha256.digest());
  const rawAddr = ripemd.digest();
  const cosmosAddress = bech32.encode('cosmos', bech32.toWords(rawAddr));
  const signer = (msg) => {
    const msgSha256 = crypto.createHash('sha256');
    msgSha256.update(Buffer.from(msg, 'utf-8'));
    const msgHash = msgSha256.digest();
    const { signature } = secp256k1.sign(msgHash, privateKey);
    return { signature, publicKey };
  };
  return {
    cosmosAddress,
    signer,
  };
}

const {
  cosmosAddress,
  signer,
} = createSigner(cosmosKey);

async function resendTransaction(payload, txHash) {
  const { data } = await api.post('/txs', payload);
  const { txhash } = data;
  return txhash === txHash;
}

async function getBlockTime(blockNumber) {
  const { data } = await api.get(`/blocks/${blockNumber}`);
  const { block_meta: { header: { time } } } = data;
  return (new Date(time)).getTime();
}

function amountToLIKE(likecoin) {
  if (likecoin.denom === 'nanolike') {
    return (Number.parseFloat(likecoin.amount) / 1e9);
  }
  console.error(`${likecoin.denom} is not supported denom`);
  return -1;
}

function isCosmosWallet(wallet) {
  return wallet.startsWith('cosmos');
}

async function getAccountInfo(address) {
  const res = await api.get(`/auth/accounts/${address}`);
  if (res.status !== 200) {
    throw new Error(`Response failed with status ${res.status}: ${res.statusText}`);
  }
  return res.data.value;
}

function getTransactionGas() {
  return COSMOS_GAS;
}

async function sendTransaction(tx) {
  const res = await api.post('/txs', {
    tx,
    mode: 'sync',
  });
  if (res.data.code) {
    throw new Error(res.data.raw_log);
  }
  return res.data.txhash;
}

async function signTransaction(toAddress, value, sequence, gas) {
  const msgSend = {
    type: 'cosmos-sdk/MsgSend',
    value: {
      from_address: cosmosAddress,
      to_address: toAddress,
      amount: [{ denom: COSMOS_DENOM, amount: value.toString() }],
    },
  };
  const stdTx = {
    msg: [msgSend],
    fee: {
      amount: null,
      gas,
    },
    memo: '',
  };
  const { account_number: accountNumber } = await getAccountInfo(cosmosAddress);
  const signMessage = jsonStringify({
    fee: {
      amount: [],
      gas,
    },
    msgs: stdTx.msg,
    chain_id: COSMOS_CHAIN_ID,
    account_number: accountNumber,
    sequence,
    memo: stdTx.memo,
  });
  const { signature, publicKey } = signer(signMessage);
  stdTx.signatures = [{
    signature: signature.toString('base64'),
    account_number: accountNumber,
    sequence,
    pub_key: {
      type: 'tendermint/PubKeySecp256k1',
      value: publicKey.toString('base64'),
    },
  }];
  return stdTx;
}

async function sendTransactionWithLoop(toAddress, value) {
  const RETRY_LIMIT = 10;
  let txHash;
  let tx;
  const gas = getTransactionGas();
  const counterRef = txLogRef.doc(`!counter_${cosmosAddress}`);
  let pendingCount = await db.runTransaction(async (t) => {
    const d = await t.get(counterRef);
    const v = d.data().value + 1;
    await t.update(counterRef, { value: v });
    return d.data().value;
  });
  tx = await signTransaction(toAddress, value, pendingCount.toString(), gas);
  try {
    txHash = await sendTransaction(tx);
  } catch (err) {
    console.log(`Sequence ${pendingCount} failed, trying to get account info sequence`);
    console.error(err);
  }
  try {
    let retryCount = 0;
    let sequence;
    while (!txHash) {
      try {
        /* eslint-disable no-await-in-loop */
        ({ sequence } = await getAccountInfo(cosmosAddress));
        tx = await signTransaction(toAddress, value, sequence, gas);
        txHash = await sendTransaction(tx);
      } catch (err) {
        console.error(`Retry with sequence ${sequence} failed`);
        console.error(err);
      }
      if (!txHash) {
        retryCount += 1;
        if (retryCount > RETRY_LIMIT) {
          throw new Error('Retry limit exceeds');
        }
        await timeout(COSMOS_BLOCK_TIME);
      }
    }
    await db.runTransaction(t => t.get(counterRef).then((d) => {
      pendingCount = parseInt(sequence, 10);
      if (pendingCount + 1 > d.data().value) {
        return t.update(counterRef, {
          value: pendingCount + 1,
        });
      }
      return Promise.resolve();
    }));
  } catch (err) {
    await publisher.publish(PUBSUB_TOPIC_MISC, null, {
      logType: 'eventCosmosError',
      fromWallet: cosmosAddress,
      txHash,
      txSequence: pendingCount,
      error: err.toString(),
    });
    throw err;
  }
  return {
    tx,
    txHash,
    gas,
    delegatorAddress: cosmosAddress,
    pendingCount,
  };
}

module.exports = {
  getCurrentHeight,
  resendTransaction,
  getBlockTime,
  amountToLIKE,
  isCosmosWallet,
  sendTransactionWithLoop,
};
