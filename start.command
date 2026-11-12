#!/usr/bin/env bash
# macOS 더블클릭용. 처음 한 번 터미널에서: chmod +x start.command start.sh
cd "$(dirname "$0")"
exec bash ./start.sh "$@"
