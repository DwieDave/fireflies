#!/bin/sh
# Makes an agent's worktree from integrate with a build that is already done.
#   .claude/seed-worktree.sh <name>        -> /Volumes/data/coding/fireflies-wt/<name>, branch feat/<name>
# cargo decides what is stale by file times and by the text its build scripts
# printed. So the new checkout gets integrate's file times (a checkout stamps
# every file "now", which reads as "everything changed"), and target/ is an
# APFS clone that keeps its own times. With both, cargo rebuilds only what the
# agent edits.
set -eu
name=$1
repo=$(git -C "$(dirname "$0")/.." worktree list --porcelain | sed -n '1s/^worktree //p')
root=/Volumes/data/coding/fireflies-wt
from=$root/integrate
to=$root/$name
git -C "$repo" worktree add -q -b "feat/$name" "$to" integrate
git -C "$to" submodule update -q --init --reference "$repo/vendor/ghostty"
python3 - "$from" "$to" <<'PY'
import os, subprocess, sys
src, dst = (p.encode() for p in sys.argv[1:])
names = subprocess.run(["git", "-C", src, "ls-files", "-z", "--recurse-submodules"], capture_output=True, check=True).stdout
for name in filter(None, names.split(b"\0")):
    try:
        st = os.lstat(os.path.join(src, name))
        os.utime(os.path.join(dst, name), ns=(st.st_atime_ns, st.st_mtime_ns), follow_symlinks=False)
    except OSError:
        pass
PY
/bin/cp -cRp "$from/target" "$to/target"
echo "$to"
