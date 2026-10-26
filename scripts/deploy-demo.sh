#!/usr/bin/env bash
# Publishes the static demo (bundled samples, no model) to the gh-pages branch.
set -euo pipefail
npm run build
T=$(mktemp -d)
cp -R dist/. "$T/"
touch "$T/.nojekyll"
cp "$T/index.html" "$T/404.html"
git -C "$T" init -q -b gh-pages
git -C "$T" add -A
git -C "$T" commit -q -m "Deploy static demo"
git -C "$T" push -f "$(git remote get-url origin)" gh-pages
