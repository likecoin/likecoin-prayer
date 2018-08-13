# likecoin-prayer

[![Greenkeeper badge](https://badges.greenkeeper.io/likecoin/likecoin-prayer.svg)](https://greenkeeper.io/)

> A firestore based util for batching our payments, and praying for infura/ethereum network to handle them.

## Folder structure
```bash
├── config
│   ├── accounts.js # eth accounts for payment
│   ├── config.js # config file
│   └── serviceAccountKey.json # firestore crendentials
├── constant # constant
│   └── likecoin.js # LikeCoin contract for abi calls
├── util # helper functions
│   ├── firebase.js # firebase/firestore singleton/util
│   ├── gcloudPub.js # optional gcloud pubsub log
│   ├── logger.js # firestore tx logger for likecoin-tx-poll usage
│   ├── poller.js # firestore watcher for gas price update
│   └── web3.js # web3/tx related functions
└── index.js # main entry
```

## Dev Setup

``` bash
# Remeber to setup accounts.js config.js and serviceAccountKey.json first!

# install dependencies
npm install

# run the program
npm start

```
