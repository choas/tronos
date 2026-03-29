#!/bin/bash
# Dirigent home-directory guard – Claude Code PreToolUse hook.
# Blocks tool calls that reference personal home directories or
# recursively search from the home directory root.
INPUT=$(cat)
HOME_DIR="${HOME:-/Users/$(whoami)}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || dirname "$(cd "$(dirname "$0")" && pwd)")"

# 1. Block explicit references to personal sub-directories.
for DIR in Documents Desktop Downloads Photos Pictures Movies Music Library Applications .ssh .gnupg; do
    BLOCKED="$HOME_DIR/$DIR"
    if echo "$INPUT" | grep -qF "$BLOCKED"; then
        # If the repo lives under this blocked dir, strip repo-root paths from
        # the input and re-check.  Only the stripped copy is tested so that
        # references *outside* the repo subtree are still caught.
        case "$REPO_ROOT" in "$BLOCKED"|"$BLOCKED"/*)
            STRIPPED=$(echo "$INPUT" | sed "s|$REPO_ROOT[^ \"']*||g")
            if ! echo "$STRIPPED" | grep -qF "$BLOCKED"; then
                continue   # every matched path was inside the repo
            fi
            ;; esac
        echo "Blocked by Dirigent: access to ~/$DIR is restricted. Disable the home-folder guard in Dirigent Settings to override."
        exit 2
    fi
done

# 2. Block recursive commands that start from the home directory itself
#    (e.g. "find /Users/lars -name foo" or "find ~ -type f").
#    These traverse into Documents, Desktop, Photos etc. and trigger macOS
#    permission pop-ups even though those paths aren't named explicitly.
#    We match: find <home> | find ~ | ls -R <home> | grep -r ... <home>
#    but NOT paths that go deeper (e.g. find /Users/lars/prj is fine).
HOME_ESC=$(printf '%s' "$HOME_DIR" | sed 's/[.[\*^$()+?{|]/\\&/g')
if echo "$INPUT" | grep -qE "(find|ls -[a-zA-Z]*R|grep -[a-zA-Z]*r|rg |fd |du |tree )[^\"]*($HOME_ESC|~)(/| |\"|\$)" 2>/dev/null; then
    # Make sure it's not targeting a deeper subdirectory within home
    if ! echo "$INPUT" | grep -qE "(find|ls|grep|rg|fd|du|tree)[^\"]*$HOME_ESC/[A-Za-z0-9._-]+[/ \"]" 2>/dev/null; then
        echo "Blocked by Dirigent: recursive search from home directory is restricted. Use a more specific path or disable the home-folder guard in Dirigent Settings."
        exit 2
    fi
fi

exit 0
