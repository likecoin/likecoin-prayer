const PubSub = require('@google-cloud/pubsub');
const uuidv4 = require('uuid/v4');

const config = require('../config/config.js');

const pubsub = new PubSub();
const topics = [
  'misc',
];
const publisher = {};
const publisherWrapper = {};
const ethNetwork = process.env.IS_TESTNET ? 'rinkeby' : 'mainnet';

topics.forEach((topic) => {
  publisherWrapper[topic] = pubsub.topic(topic)
    .publisher({
      batching: {
        maxMessages: config.GCLOUD_PUBSUB_MAX_MESSAGES || 10,
        maxMilliseconds: config.GCLOUD_PUBSUB_MAX_WAIT || 1000,
      },
    });
});

publisher.publish = async (publishTopic, req, obj) => {
  if (!config.GCLOUD_PUBSUB_ENABLE) return;
  Object.assign(obj, {
    '@timestamp': new Date().toISOString(),
    appServer: config.APP_SERVER || 'test-store',
    ethNetwork,
    uuidv4: uuidv4(),
    requestIP: req.headers['x-real-ip'] || req.ip,
  });

  const data = JSON.stringify(obj);
  const dataBuffer = Buffer.from(data);
  try {
    await publisherWrapper[publishTopic].publish(dataBuffer);
  } catch (err) {
    console.error('ERROR:', err); // eslint-disable-line no-console
  }
};

module.exports = publisher;
