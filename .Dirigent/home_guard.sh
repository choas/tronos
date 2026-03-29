#!/bin/bash
# Dirigent home-directory guard – Claude Code PreToolUse hook.
# Blocks tool calls that reference personal home directories or
# recursively search from the home directory root.
INPUT=$(cat)
HOME_DIR="${HOME:-/Users/$(whoami)}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || dirname "$(cd "$(dirname "$0")" && pwd)")"

# ---------------------------------------------------------------------------
# Normalize INPUT: expand ~/  $HOME/  ${HOME}/ to the resolved home path
# so that tilde and env-var references are compared against the same absolute
# strings.  Also resolve paths containing ".." components.
# ---------------------------------------------------------------------------
NORM=$(printf '%s' "$INPUT" | sed \
    -e 's|~/|'"$HOME_DIR"'/|g' \
    -e 's|~\([^a-zA-Z0-9._/-]\)|'"$HOME_DIR"'\1|g' \
    -e 's|\$HOME/|'"$HOME_DIR"'/|g' \
    -e 's|\${HOME}/|'"$HOME_DIR"'/|g' \
    -e 's|\$HOME\([^a-zA-Z0-9_]\)|'"$HOME_DIR"'\1|g' \
    -e 's|\${HOME}\([^a-zA-Z0-9_]\)|'"$HOME_DIR"'\1|g')

# check_dotdot_bypass BLOCKED — returns 0 if any path token in NORM contains
# ".." and, once canonicalized, falls under BLOCKED.
check_dotdot_bypass() {
    local blocked="$1"
    # Fast exit when no ".." appears at all.
    printf '%s' "$NORM" | grep -qF '..' || return 1
    local paths
    paths=$(printf '%s' "$NORM" | grep -oE '/[A-Za-z0-9_./@-][A-Za-z0-9_./ @-]*\.\.[A-Za-z0-9_./ @-]*' | head -50)
    [ -z "$paths" ] && return 1
    while IFS= read -r p; do
        [ -z "$p" ] && continue
        p="${p#\"}" ; p="${p%\"}" ; p="${p#\'}" ; p="${p%\'}"
        local resolved
        resolved=$(python3 -c "import os,sys; print(os.path.normpath(sys.argv[1]))" "$p" 2>/dev/null)
        [ -z "$resolved" ] && continue
        case "$resolved" in "$blocked"|"$blocked"/*) return 0 ;; esac
    done <<< "$paths"
    return 1
}

# 1. Block explicit references to personal sub-directories.
for DIR in Documents Desktop Downloads Photos Pictures Movies Music Library Applications .ssh .gnupg; do
    BLOCKED="$HOME_DIR/$DIR"
    # Check the normalized input (catches ~, $HOME, ${HOME} and literal paths).
    if printf '%s' "$NORM" | grep -qF "$BLOCKED"; then
        # If the repo lives under this blocked dir, strip repo-root paths from
        # the input and re-check.  Only the stripped copy is tested so that
        # references *outside* the repo subtree are still caught.
        case "$REPO_ROOT" in "$BLOCKED"|"$BLOCKED"/*)
            STRIPPED=$(printf '%s' "$NORM" | sed "s|$REPO_ROOT[^ \"']*||g")
            if ! printf '%s' "$STRIPPED" | grep -qF "$BLOCKED"; then
                continue   # every matched path was inside the repo
            fi
            ;; esac
        echo "Blocked by Dirigent: access to ~/$DIR is restricted. Disable the home-folder guard in Dirigent Settings to override."
        exit 2
    fi
    # Check for ".." traversal paths that resolve under the blocked directory.
    if check_dotdot_bypass "$BLOCKED"; then
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
if printf '%s' "$NORM" | grep -qE "(find|ls -[a-zA-Z]*R|grep -[a-zA-Z]*r|rg |fd |du |tree )[^\"]*($HOME_ESC|~)(/| |\"|\$)" 2>/dev/null; then
    # Make sure it's not targeting a deeper subdirectory within home
    if ! printf '%s' "$NORM" | grep -qE "(find|ls|grep|rg|fd|du|tree)[^\"]*$HOME_ESC/[A-Za-z0-9._-]+[/ \"]" 2>/dev/null; then
        echo "Blocked by Dirigent: recursive search from home directory is restricted. Use a more specific path or disable the home-folder guard in Dirigent Settings."
        exit 2
    fi
fi

exit 0
