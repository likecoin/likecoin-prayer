/* eslint-disable no-await-in-loop */
const BigNumber = require('bignumber.js');
const LIKECOIN = require('./constant/contract/likecoin');
const { web3, sendTransactionWithLoop } = require('./util/web3');
const {
  db,
  userCollection: userRef,
  payoutCollection: payoutRef,
} = require('./util/firebase');

const config = require('./config/config.js');
const LikeCoin = new web3.eth.Contract(LIKECOIN.LIKE_COIN_ABI, LIKECOIN.LIKE_COIN_ADDRESS);

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeNewRecevier(wallet, user) {
  return {
    wallet,
    user,
    payoutIds: [],
    amount: new BigNumber(0),
  };
}

async function handleQuery(docs) {
  const senderMap = {};
  docs.forEach((d) => {
    if (!d.amount) {
      console.error(`${d.id} has not amount`);
      return;
    }
    if (!senderMap[d.to]) {
      senderMap[d.to] = makeNewRecevier(d.to, d.toId);
    }
    senderMap[d.to].payoutIds.push(d.id);
    senderMap[d.to].amount.plus(d.amount);
  });
  const receivers = Object.keys(senderMap);
  for (let i = 0; i < receivers.length; i += 1) {
    try {
      const wallet = receivers[i];
      const data = senderMap[wallet];
      const {
        user,
        payoutIds,
        amount,
        account,
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
      const methodCall = LikeCoin.methods.transfer(wallet, amount);
      const txData = methodCall.encodeABI();
      const {
        tx,
        txHash,
        pendingCount,
        delegatorAddress,
      } = await sendTransactionWithLoop(
        LIKECOIN.LIKE_COIN_ADDRESS,
        txData,
      );

    } catch (err) {
      console.log(err); // disable-eslint-line no-console
    }
  }
}

async function loop() {
  while (true) {
    try {
      const query = payoutRef.where('waitForClaim', '==', false)
        .where('effectiveTs`', '>', Date.now())
        .where('txHash', '==', null)
        .limit(250);
      await handleQuery(query.get().docs);
      await timeout(config.POLLING_DELAY || 10000);
    } catch (err) {
      console.error(err);
    }
  }
}

loop();
