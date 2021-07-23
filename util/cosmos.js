const { MsgSend } = require('cosmjs-types/cosmos/bank/v1beta1/tx');
const { TxRaw } = require('cosmjs-types/cosmos/tx/v1beta1/tx');
const { assertIsBroadcastTxSuccess, SigningStargateClient, StargateClient } = require('@cosmjs/stargate');
// eslint-disable-next-line import/no-extraneous-dependencies
const { DirectSecp256k1Wallet } = require('@cosmjs/proto-signing');

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
  COSMOS_BLOCK_TIME = 6000,
  COSMOS_GAS = '200000',
  COSMOS_DENOM = 'nanolike',
  COSMOS_GAS_PRICE = 1000,
} = config;

let queryClient;
async function getQueryClient() {
  if (!queryClient) queryClient = await StargateClient.connect(COSMOS_LCD_ENDPOINT);
  return queryClient;
}

let signingWallet;
async function getSigningWallet(privKey = cosmosKey) {
  if (!signingWallet) {
    const privateKeyBytes = Buffer.from(privKey, 'hex');
    const senderWallet = await DirectSecp256k1Wallet.fromKey(privateKeyBytes);
    const [firstAccount] = await senderWallet.getAccounts();
    const senderAddress = firstAccount.address;
    const senderClient = await SigningStargateClient.connectWithSigner(
      COSMOS_LCD_ENDPOINT,
      senderWallet,
    );
    signingWallet = {
      cosmosAddress: senderAddress,
      signer: senderClient,
    };
  }
  return signingWallet;
}

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCurrentHeight() {
  const client = await getQueryClient();
  const res = await client.getBlock();
  return res.header.height;
}

async function getBlockTime(blockNumber) {
  const client = await getQueryClient();
  const res = await client.getBlock(blockNumber);
  const { time } = res.header;
  return (new Date(time)).getTime();
}

function amountToLIKE(likecoin) {
  if (likecoin.denom === 'nanolike') {
    return (Number.parseFloat(likecoin.amount) / 1e9);
  }
  console.error(`${likecoin.denom} is not supported denom`);
  return -1;
}

function LIKEToAmount(amount) {
  return {
    denom: 'nanolike',
    amount,
  };
}

function isCosmosWallet(wallet) {
  return wallet.startsWith('cosmos');
}

async function getAccountInfo(address) {
  const client = await getQueryClient();
  const res = await client.getAccount(address);
  return res;
}

function getTransactionGas() {
  return COSMOS_GAS;
}

function getTransactionFee(gas) {
  const price = Number.parseFloat(COSMOS_GAS_PRICE) * Number.parseInt(gas, 10);
  return {
    amount: price.toFixed(0),
    denom: COSMOS_DENOM,
  };
}

async function sendTransaction(toAddress, value, sequence, gas) {
  const { cosmosAddress, signer } = await getSigningWallet();
  const msgSend = MsgSend.fromPartial({
    fromAddress: cosmosAddress,
    toAddress: toAddress,
    amount: [{ denom: COSMOS_DENOM, amount: value.toString() }],
  });

  const msgs = {
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: msgSend,
  };

  const { accountNumber } = await getAccountInfo(cosmosAddress);

  const feeAmount = getTransactionFee(gas);
  const fee = {
    amount: feeAmount.amount === 0 ? [] : [feeAmount],
    gas,
  };

  const chainId = await this.getChainId();
  const signed = await signer.sign(cosmosAddress, [msgs], fee, '', { accountNumber, chainId, sequence });

  const result = await signer.broadcastTx(Uint8Array.from(TxRaw.encode(signed).finish()));
  if ('code' in result && result.code) {
    throw new Error(result.rawLog);
  }
  return result.transactionHash;
}

async function sendTransactionWithLoop(toAddress, value) {
  const { cosmosAddress } = await getSigningWallet();
  const RETRY_LIMIT = 10;
  let txHash;
  let tx;
  let payload;
  const gas = getTransactionGas();
  const counterRef = txLogRef.doc(`!counter_${cosmosAddress}`);
  let pendingCount = await db.runTransaction(async (t) => {
    const d = await t.get(counterRef);
    if (!d.data()) {
      await t.create(counterRef, { value: 1 });
      return 0;
    }
    const v = d.data().value + 1;
    await t.update(counterRef, { value: v });
    return d.data().value;
  });
  try {
    txHash = await sendTransaction(toAddress, value, pendingCount.toString(), gas);
  } catch (err) {
    console.log(`Sequence ${pendingCount} failed, trying to get account info sequence`);
    console.error(err);
  }
  try {
    let retryCount = 0;
    while (!txHash) {
      try {
        /* eslint-disable no-await-in-loop */
        const { sequence } = await getAccountInfo(cosmosAddress);
        pendingCount = parseInt(sequence, 10);
        tx = await sendTransaction(toAddress, value, sequence, gas);
      } catch (err) {
        console.error(`Retry with sequence ${pendingCount} failed`);
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
      txSequence: pendingCount.toString(),
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
    payload,
  };
}

module.exports = {
  getCurrentHeight,
  getBlockTime,
  amountToLIKE,
  LIKEToAmount,
  isCosmosWallet,
  sendTransactionWithLoop,
};
