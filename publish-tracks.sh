#!/bin/sh
# Publish an updated data/tracks.json: bumps DATA_VERSION in js/data.js so
# returning visitors' caches revalidate, then commits and pushes. GitHub
# Pages redeploys automatically (~1 minute).
#
# Usage: edit data/tracks.json, then run  ./publish-tracks.sh
#
# Note: this is only for tracks.json. If you change HTML/CSS/JS instead,
# bump every ?v= stamp in index.html together and commit normally.
set -e
cd "$(dirname "$0")"

if git diff --quiet -- data/tracks.json && git diff --cached --quiet -- data/tracks.json; then
  echo "data/tracks.json has no changes — nothing to publish."
  exit 1
fi

current=$(sed -n 's/^const DATA_VERSION = "\([0-9]*\)";$/\1/p' js/data.js)
if [ -z "$current" ]; then
  echo "Could not find DATA_VERSION in js/data.js — aborting." >&2
  exit 1
fi
next=$((current + 1))
sed -i "s/^const DATA_VERSION = \"$current\";$/const DATA_VERSION = \"$next\";/" js/data.js
# The head preload (index.html) and the service-worker precache list (sw.js)
# must carry the same version, or browsers would download the index twice /
# serve a stale one.
sed -i "s|data/tracks.json?v=$current|data/tracks.json?v=$next|" index.html sw.js

git add data/tracks.json js/data.js index.html sw.js
git commit -m "Update tracks (data v$next)"
git push
echo "Published. Pages will redeploy shortly — check https://shiitunes.fm in a minute."
