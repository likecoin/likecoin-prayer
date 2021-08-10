#!/usr/bin/env bash

PWD=`pwd`
WD=`cd $(dirname "$0") && pwd -P`

cd "${WD}"

docker build . -t like-prayer
docker tag like-prayer:latest us.gcr.io/likecoin-foundation/like-prayer:fotan
docker -- push us.gcr.io/likecoin-foundation/like-prayer:fotan

cd "${PWD}"
