const configRef = require('../util/firebase').configCollection;
const accounts = require('../config/accounts.js'); // eslint-disable-line import/no-extraneous-dependencies

/* eslint import/no-mutable-exports: "off" */
let { gasPrice } = accounts[0];
let unsubscribeGasPrice;

function pollGasPrice() {
  try {
    const watchRef = configRef.doc('gasPrice');
    const watch = () => {
      if (!unsubscribeGasPrice) {
        unsubscribeGasPrice = watchRef.onSnapshot((docSnapshot) => {
          if (docSnapshot.exists) {
            const { value } = docSnapshot.data();
            gasPrice = value;
          }
        }, (err) => {
          console.error(err.message || err); // eslint-disable-line no-console
          if (typeof unsubscribeGasPrice === 'function') {
            unsubscribeGasPrice();
            unsubscribeGasPrice = null;
          }
          const timer = setInterval(() => {
            console.log('Trying to restart watcher (gas price)...'); // eslint-disable-line no-console
            try {
              watch();
              clearInterval(timer);
            } catch (innerErr) {
              console.log('Watcher restart failed (gas price)'); // eslint-disable-line no-console
            }
          }, 10000);
        });
      }
    };
    watch();
  } catch (err) {
    const msg = err.message || err;
    console.error(msg); // eslint-disable-line no-console
  }
}

function startPoller() {
  pollGasPrice();
}

function stopPoller() {
  if (typeof unsubscribeGasPrice === 'function') {
    unsubscribeGasPrice();
    unsubscribeGasPrice = null;
  }
}

module.exports = {
  gasPrice,
  startPoller,
  stopPoller,
};
