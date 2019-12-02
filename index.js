/* eslint-disable no-await-in-loop */
const BigNumber = require('bignumber.js');
const {
  db,
  userCollection: userRef,
  payoutCollection: payoutRef,
} = require('./util/firebase');
const {
  logCosmosPayoutTx,
} = require('./util/logger');
const publisher = require('./util/gcloudPub');
const config = require('./config/config.js');
const { startPoller } = require('./util/poller');
const {
  getCurrentHeight,
  isCosmosWallet,
  sendTransactionWithLoop: sendCosmosTransaction,
  LIKEToAmount,
} = require('./util/cosmos');

const PUBSUB_TOPIC_MISC = 'misc';
const ONE_LIKE = new BigNumber(10).pow(18);
const ONE_COSMOS_LIKE = new BigNumber(10).pow(9);

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeNewRecevier(wallet, user) {
  return {
    wallet,
    user,
    payoutIds: [],
    payoutDatas: [],
    value: new BigNumber(0),
  };
}

async function handleQuery(docs) {
  const senderMap = {};
  docs.forEach((ref) => {
    const d = ref.data();
    if (!d.to) {
      return; // wait for user to bind wallet
    }
    if (!d.value) {
      console.error(`handleQuery(): ${ref.id} has no value`); // eslint-disable-line no-console
      return;
    }
    if (!senderMap[d.to]) {
      senderMap[d.to] = makeNewRecevier(d.to, d.toId);
    }
    senderMap[d.to].payoutIds.push(ref.id);
    senderMap[d.to].payoutDatas.push(d);
    senderMap[d.to].value = senderMap[d.to].value.plus(new BigNumber(d.value));
  });
  const receivers = Object.keys(senderMap);
  for (let i = 0; i < receivers.length; i += 1) {
    try {
      const wallet = receivers[i];
      const data = senderMap[wallet];
      const {
        user,
        payoutIds,
        payoutDatas,
        value,
        delegatorAccount,
      } = data;
      await db.runTransaction(t => Promise.all(payoutIds.map(async (payoutId) => {
        const ref = payoutRef.doc(payoutId);
        const d = await t.get(ref);
        if (d.data().txHash) throw new Error('set claim fail');
      })).then(() => Promise.all(payoutIds.map(async (payoutId) => {
        const ref = payoutRef.doc(payoutId);
        await t.update(ref, {
          txHash: 'pending',
        });
      }))));

      const isCosmos = isCosmosWallet(wallet);
      if (!isCosmos) {
        console.error(`dangling tx to eth wallet ${wallet}`);
        return;
      }
      const cosmosValue = value.dividedBy(ONE_LIKE).times(ONE_COSMOS_LIKE);
      const {
        txHash,
        pendingCount,
        gas,
        delegatorAddress,
        payload,
      } = await sendCosmosTransaction(wallet, cosmosValue.toFixed());

      const batch = db.batch();
      payoutIds.forEach((payoutId) => {
        const ref = payoutRef.doc(payoutId);
        batch.update(ref, { txHash });
      });
      batch.commit();
      const remarks = payoutDatas.map(d => d.remarks).filter(r => !!r);
      const currentBlock = await getCurrentHeight();
      await logCosmosPayoutTx({
        txHash,
        from: delegatorAddress,
        to: wallet,
        amount: LIKEToAmount(cosmosValue.toFixed()),
        fromId: delegatorAccount || delegatorAddress,
        toId: user,
        currentBlock,
        sequence: pendingCount.toString(),
        rawPayload: JSON.stringify(payload),
        delegatorAddress,
        remarks: (remarks && remarks.length) ? remarks : 'Bonus',
      });
      const receiverDoc = await userRef.doc(user).get();
      const {
        referrer: toReferrer,
        timestamp: toRegisterTime,
      } = receiverDoc.data();
      publisher.publish(PUBSUB_TOPIC_MISC, null, {
        logType: 'eventCosmosPayout',
        fromUser: delegatorAccount || delegatorAddress,
        fromCosmosWallet: delegatorAddress,
        toUser: user,
        toCosmosWallet: wallet,
        toReferrer,
        toRegisterTime,
        likeAmount: value.dividedBy(ONE_LIKE).toNumber(),
        likeAmountUnitStr: value.toString(),
        txHash,
        txStatus: 'pending',
        txSequence: pendingCount.toString(),
        gas,
        currentBlock,
        delegatorAddress,
      });
    } catch (err) {
      console.error('handleQuery()', err); // eslint-disable-line no-console
    }
  }
}

async function loop() {
  while (true) { // eslint-disable-line no-constant-condition
    try {
      const query = await payoutRef.where('waitForClaim', '==', false)
        .where('effectiveTs', '<', Date.now())
        .where('txHash', '==', null)
        .limit(250)
        .get();
      await handleQuery(query.docs);
    } catch (err) {
      console.error('loop():', err); // eslint-disable-line no-console
    } finally {
      await timeout(config.POLLING_DELAY || 10000);
    }
  }
}

startPoller();
loop();
