#!/bin/bash
# Tests for install.sh. Every "terminal" is started with env -i, so nothing leaks from this
# shell: in particular node is NOT on the PATH of a new terminal (the nvm situation).
HERE=$(cd "$(dirname "$0")" && pwd)
S=$(mktemp -d)
trap 'rm -rf "$S"' EXIT
SCRIPT=${SCRIPT:-$HERE/install.sh}
# A tiny stand-in for the agent package, so the tests are fast and need no network.
mkdir -p "$S/fake/bin"
printf '%s\n' '{"name":"@stratpoint/backstage-agent","version":"9.9.9","bin":{"backstage-agent":"bin/backstage-agent.js"}}' > "$S/fake/package.json"
cat > "$S/fake/bin/backstage-agent.js" <<'JS'
#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === '--version') console.log('9.9.9');
else console.log(JSON.stringify({ argv: a, firstPath: process.env.PATH.split(':')[0], node: process.execPath }));
JS
(cd "$S/fake" && npm pack --pack-destination "$S" --silent >/dev/null 2>&1)
PKG=$(ls "$S"/stratpoint-backstage-agent-*.tgz)
# The real node binary, not a wrapper (yarn puts its own node wrapper first on the PATH when jest runs this).
NODEDIR=$(dirname "$(node -p process.execPath)")
# A PATH with every system tool except node: a new terminal on a machine whose node comes from nvm.
NONODE="$S/nonode-bin"
if [ ! -d "$NONODE" ]; then
  mkdir -p "$NONODE"
  for f in /usr/bin/*; do
    case "$(basename "$f")" in node | nodejs | npm | npx | corepack) continue ;; esac
    ln -s "$f" "$NONODE/$(basename "$f")" 2>/dev/null
  done
fi
BASE="$NONODE"
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "  ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

newhome() { mktemp -d "$S/home.XXXXXX"; }
# install <home> <shell> [extra env...] -- [installer args]
run_install() {
  local home=$1 shell=$2; shift 2
  env -i HOME="$home" SHELL="$shell" PATH="$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" "$@"
}

echo "syntax"
for sh in sh dash bash zsh; do check "$sh -n" "$sh -n '$SCRIPT'"; done

echo "install: zsh terminal that has no node"
H=$(newhome)
OUT=$(run_install "$H" /bin/zsh /bin/sh "$SCRIPT" 2>&1); RC=$?
check "installer exits 0" "[ $RC -eq 0 ]"
check "launcher written and executable" "[ -x '$H/.backstage-agent/bin/backstage-agent' ]"
check ".zshrc has one block" "[ \"\$(grep -c '>>> backstage-agent >>>' '$H/.zshrc')\" = 1 ]"
check "a new zsh terminal has no node (the problem)" "[ -z \"\$(env -i HOME='$H' SHELL=/bin/zsh PATH=$BASE zsh -ic 'command -v node' 2>/dev/null)\" ]"
check "a new zsh terminal finds backstage-agent" "[ \"\$(env -i HOME='$H' SHELL=/bin/zsh PATH=$BASE zsh -ic 'backstage-agent --version' 2>/dev/null)\" = 9.9.9 ]"
J=$(env -i HOME="$H" SHELL=/bin/zsh PATH=$BASE zsh -ic 'backstage-agent one "two words"' 2>/dev/null)
check "arguments pass through intact" "echo '$J' | grep -q '\"argv\":\[\"one\",\"two words\"\]'"
check "the Node that installed it is first on PATH for the agent" "echo '$J' | grep -q '\"firstPath\":\"$NODEDIR\"'"
check "prints the next steps" "echo \"\$OUT\" | grep -q 'backstage-agent start'"

echo "the printed next steps work, pasted in order, in the SAME window"
# This is what happened on a real Mac: the installer printed its steps, the user ran them in the window it was started from.
printf '%s\n' "$OUT" > "$S/out.txt"
EXPORT_LINE=$(grep -m1 '^  export PATH=' "$S/out.txt" | sed 's/^  //')
LOGIN_LINE=$(grep -n 'backstage-agent login --url' "$S/out.txt" | head -1 | cut -d: -f1)
EXPORT_AT=$(grep -n '^  export PATH=' "$S/out.txt" | head -1 | cut -d: -f1)
check "the PATH line is printed exactly once on a normal install" "[ \"\$(grep -c '^  export PATH=' '$S/out.txt')\" = 1 ]"
check "the export line is printed, and before the login line" "[ -n '$EXPORT_LINE' ] && [ -n '$EXPORT_AT' ] && [ '$EXPORT_AT' -lt '$LOGIN_LINE' ]"
RESULT=$(env -i HOME="$H" PATH="$BASE" sh -c "$EXPORT_LINE; backstage-agent --version" 2>/dev/null)
[ "$RESULT" = 9.9.9 ] && ok "after that export line, in a window that never had it, the command works" || bad "after that export line, in a window that never had it, the command works"
check "the old 'open a new terminal ... then' sentence that hid this step is gone" "! grep -q 'Next: open a new terminal' '$S/out.txt'"

echo "install: running it twice"
run_install "$H" /bin/zsh /bin/sh "$SCRIPT" >/dev/null 2>&1
check "still one block" "[ \"\$(grep -c '>>> backstage-agent >>>' '$H/.zshrc')\" = 1 ]"

echo "startup file content is kept"
H2=$(newhome); printf 'export A=1\nalias x=y' > "$H2/.zshrc"
run_install "$H2" /bin/zsh /bin/sh "$SCRIPT" >/dev/null 2>&1
check "old lines kept" "grep -q 'export A=1' '$H2/.zshrc' && grep -q 'alias x=y' '$H2/.zshrc'"
check "block starts on its own line" "grep -qx '# >>> backstage-agent >>>' '$H2/.zshrc'"
check "still loads in zsh" "[ \"\$(env -i HOME='$H2' SHELL=/bin/zsh PATH=$BASE zsh -ic 'backstage-agent --version' 2>/dev/null)\" = 9.9.9 ]"

echo "install: bash terminal"
H3=$(newhome)
run_install "$H3" /bin/bash /bin/sh "$SCRIPT" >/dev/null 2>&1
check "bash terminal finds backstage-agent" "[ \"\$(env -i HOME='$H3' SHELL=/bin/bash PATH=$BASE bash -ic 'backstage-agent --version' 2>/dev/null)\" = 9.9.9 ]"

echo "install: through dash and from a pipe (curl | sh)"
H4=$(newhome)
OUT=$(cat "$SCRIPT" | run_install "$H4" /bin/zsh dash -s -- 2>&1); RC=$?
check "pipe into dash works" "[ $RC -eq 0 ] && [ -x '$H4/.backstage-agent/bin/backstage-agent' ]"

echo "a download that stops half way runs nothing"
SIZE=$(wc -c < "$SCRIPT")
for pct in 20 40 60 75 90 97 99; do
  H5=$(newhome)
  head -c $(( SIZE * pct / 100 )) "$SCRIPT" | run_install "$H5" /bin/zsh /bin/sh >/dev/null 2>&1
  check "cut at ${pct}%: nothing was created" "[ -z \"\$(ls -A '$H5')\" ]"
done

echo "paths with spaces and quotes"
H6="$(mktemp -d "$S/home.XXXXXX")/it's a home"; mkdir -p "$H6"
run_install "$H6" /bin/zsh /bin/sh "$SCRIPT" >/dev/null 2>&1
[ "$("$H6/.backstage-agent/bin/backstage-agent" --version 2>/dev/null)" = 9.9.9 ] && ok "launcher works from such a home" || bad "launcher works from such a home"
[ "$(env -i HOME="$H6" SHELL=/bin/zsh PATH="$BASE" zsh -ic 'backstage-agent --version' 2>/dev/null)" = 9.9.9 ] && ok "a new zsh terminal finds it" || bad "a new zsh terminal finds it"

echo "a version-manager shim is not what gets pinned"
HS=$(newhome); mkdir -p "$HS/shims"
printf '#!/bin/sh\nexec "%s/node" "$@"\n' "$NODEDIR" > "$HS/shims/node"; chmod +x "$HS/shims/node"
env -i HOME="$HS" SHELL=/bin/zsh PATH="$HS/shims:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" >/dev/null 2>&1
check "the launcher names the real node, not the shim" "grep -q \"^NODE='$NODEDIR/node'\$\" '$HS/.backstage-agent/bin/backstage-agent'"

echo "the Node it was installed with is gone"
H7=$(newhome); mkdir -p "$H7/n"; cp "$NODEDIR/node" "$H7/n/node"; ln -s "$NODEDIR/npm" "$H7/n/npm" 2>/dev/null
env -i HOME="$H7" SHELL=/bin/zsh PATH="$H7/n:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" >/dev/null 2>&1
rm -f "$H7/n/node"
check "falls back to the node on the PATH" "[ \"\$(env -i HOME='$H7' PATH='$NODEDIR:$BASE' '$H7/.backstage-agent/bin/backstage-agent' --version 2>/dev/null)\" = 9.9.9 ]"
OUT=$(env -i HOME="$H7" PATH="$BASE" "$H7/.backstage-agent/bin/backstage-agent" --version 2>&1); RC=$?
check "says so and exits 127 when there is no node at all" "[ $RC -eq 127 ] && echo \"\$OUT\" | grep -q 'Node.js was not found'"

echo "pinned node gone, and the node on the PATH is too old"
H18=$(newhome); mkdir -p "$H18/old"
printf '#!/bin/sh\n[ "$1" = "-p" ] && echo 18 || echo v18.0.0\n' > "$H18/old/node"; chmod +x "$H18/old/node"
OUT=$(env -i HOME="$H7" PATH="$H18/old:$BASE" "$H7/.backstage-agent/bin/backstage-agent" --version 2>&1); RC=$?
check "launcher refuses a node 18 fallback with a plain message" "[ $RC -eq 127 ] && echo \"\$OUT\" | grep -q 'too old'"

echo "refusals"
H8=$(newhome)
OUT=$(env -i HOME="$H8" SHELL=/bin/zsh PATH="$BASE" /bin/sh "$SCRIPT" 2>&1); RC=$?
check "no node: fails, explains, mentions nvm" "[ $RC -ne 0 ] && echo \"\$OUT\" | grep -q 'nvm use'"
check "no node: creates nothing" "[ -z \"\$(ls -A '$H8')\" ]"
mkdir -p "$H8/old"; printf '#!/bin/sh\n[ "$1" = "-p" ] && echo 18 || echo v18.0.0\n' > "$H8/old/node"; chmod +x "$H8/old/node"
OUT=$(env -i HOME="$H8" SHELL=/bin/zsh PATH="$H8/old:$BASE" /bin/sh "$SCRIPT" 2>&1); RC=$?
check "node 18: fails with 'too old'" "[ $RC -ne 0 ] && echo \"\$OUT\" | grep -q 'too old'"
check "node 18: creates no install" "[ ! -e '$H8/.backstage-agent' ]"
# The "/" case runs only against the real script: with its guard broken on purpose (the mutation run)
# an uninstall there would try to delete /bin, so the mutation run sets SKIP_ROOT_HOME=1.
HOMES=(relative "$H8"); [ -z "$SKIP_ROOT_HOME" ] && HOMES=(/ "${HOMES[@]}")
for bad_home in "${HOMES[@]}"; do
  env -i HOME="$H8" PATH="$NODEDIR:$BASE" BACKSTAGE_AGENT_HOME="$bad_home" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" --uninstall >/dev/null 2>&1; RC=$?
  check "BACKSTAGE_AGENT_HOME=$bad_home is refused" "[ $RC -ne 0 ]"
done
env -i HOME="$H8" PATH="$NODEDIR:$BASE" /bin/sh "$SCRIPT" --bogus >/dev/null 2>&1; check "unknown option fails" "[ $? -ne 0 ]"
env -i HOME="$H8" PATH="$NODEDIR:$BASE" /bin/sh "$SCRIPT" --version 'x;rm' >/dev/null 2>&1; check "bad version fails" "[ $? -ne 0 ]"

echo "--no-modify-path"
H9=$(newhome)
run_install "$H9" /bin/zsh /bin/sh "$SCRIPT" --no-modify-path >/dev/null 2>&1
check "launcher there, no startup file touched" "[ -x '$H9/.backstage-agent/bin/backstage-agent' ] && [ ! -e '$H9/.zshrc' ]"

echo "hardening"
# --- sudo: refused (a fake id says we are root; works whoever runs the tests)
HS1=$(newhome); mkdir -p "$HS1/fakeid"; printf '#!/bin/sh\necho 0\n' > "$HS1/fakeid/id"; chmod +x "$HS1/fakeid/id"
OUT=$(env -i HOME="$HS1" SUDO_USER=ann SHELL=/bin/zsh PATH="$HS1/fakeid:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1); RC=$?
check "under sudo: refused with a plain message" "[ $RC -ne 0 ] && echo \"\$OUT\" | grep -q 'do not run this with sudo'"
check "under sudo: nothing created" "[ ! -e '$HS1/.backstage-agent' ] && [ ! -e '$HS1/.zshrc' ]"
env -i HOME="$HS1" SHELL=/bin/zsh PATH="$HS1/fakeid:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" >/dev/null 2>&1
check "root without sudo (a container) is allowed" "[ -x '$HS1/.backstage-agent/bin/backstage-agent' ]"

# --- a docker that hangs (Docker Desktop still starting) must not hang the installer
HD=$(newhome); mkdir -p "$HD/fd"; printf '#!/bin/sh\nsleep 30\n' > "$HD/fd/docker"; chmod +x "$HD/fd/docker"
START=$(date +%s)
OUT=$(env -i HOME="$HD" SHELL=/bin/zsh BACKSTAGE_AGENT_DOCKER_WAIT=2 PATH="$HD/fd:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1); RC=$?
ELAPSED=$(( $(date +%s) - START ))
check "hung docker: finishes in seconds and says Docker is not running" "[ $RC -eq 0 ] && [ $ELAPSED -lt 20 ] && echo \"\$OUT\" | grep -q 'installed but not running'"
HD2=$(newhome); mkdir -p "$HD2/fd"; printf '#!/bin/sh\nexit 0\n' > "$HD2/fd/docker"; chmod +x "$HD2/fd/docker"
OUT=$(env -i HOME="$HD2" SHELL=/bin/zsh PATH="$HD2/fd:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1)
check "working docker: no Docker warning" "! echo \"\$OUT\" | grep -qi 'docker is not\|Docker is installed but'"

# --- nothing the installer starts may read the installer from the pipe (curl | sh)
# After main() the piped script has a sentinel behind 25 KB of padding: if docker or npm ate stdin, it is gone.
pipe_with_sentinel() { { cat "$SCRIPT"; for i in $(seq 1 400); do echo "# padding padding padding padding padding padding padding padding"; done; echo 'echo SENTINEL-AFTER-MAIN'; }; }
HK=$(newhome); mkdir -p "$HK/fd"; printf '#!/bin/sh\ncat >/dev/null\nexit 0\n' > "$HK/fd/docker"; chmod +x "$HK/fd/docker"
OUT=$(pipe_with_sentinel | env -i HOME="$HK" SHELL=/bin/zsh PATH="$HK/fd:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh -s -- 2>&1)
check "a docker that reads stdin does not eat the piped script" "echo \"\$OUT\" | grep -q SENTINEL-AFTER-MAIN"
HN=$(newhome); mkdir -p "$HN/n"; cp "$NODEDIR/node" "$HN/n/node"; printf '#!/bin/sh\ncat >/dev/null\nexec "%s/npm" "$@"\n' "$NODEDIR" > "$HN/n/npm"; chmod +x "$HN/n/npm"
OUT=$(pipe_with_sentinel | env -i HOME="$HN" SHELL=/bin/zsh PATH="$HN/n:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh -s -- 2>&1)
check "an npm that reads stdin does not eat the piped script" "echo \"\$OUT\" | grep -q SENTINEL-AFTER-MAIN && [ -x '$HN/.backstage-agent/bin/backstage-agent' ]"

# --- a startup file that cannot be written (here: a directory, like a read-only dotfile): the install still works
HR=$(newhome); mkdir "$HR/.zshrc"
OUT=$(run_install "$HR" /bin/zsh /bin/sh "$SCRIPT" 2>&1); RC=$?
check "unwritable startup file: install completes and says which file" "[ $RC -eq 0 ] && [ -x '$HR/.backstage-agent/bin/backstage-agent' ] && echo \"\$OUT\" | grep -q 'could not write to'"
check "unwritable startup file: says so once, prints the line ONCE, before the login line" "echo \"\$OUT\" | grep -q 'no shell startup file could be changed' && [ \"\$(echo \"\$OUT\" | grep -c '^  export PATH=')\" = 1 ]"

# --- folders and files that cannot be created: a clear failure (npm must succeed first, so the problem is placed after it)
HU=$(newhome); : > "$HU/afile"
OUT=$(env -i HOME="$HU" PATH="$NODEDIR:$BASE" BACKSTAGE_AGENT_HOME="$HU/afile/x" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1); RC=$?
check "install folder that cannot be created: fails, says npm could not" "[ $RC -ne 0 ] && echo \"\$OUT\" | grep -q 'could not'"
HU2=$(newhome); mkdir -p "$HU2/ah"; : > "$HU2/ah/bin"
OUT=$(env -i HOME="$HU2" PATH="$NODEDIR:$BASE" BACKSTAGE_AGENT_HOME="$HU2/ah" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1); RC=$?
check "launcher folder that cannot be created: fails and names it" "[ $RC -ne 0 ] && echo \"\$OUT\" | grep -q 'could not create .*/ah/bin'"
HU3=$(newhome); mkdir -p "$HU3/ah/bin/backstage-agent"
OUT=$(env -i HOME="$HU3" PATH="$NODEDIR:$BASE" BACKSTAGE_AGENT_HOME="$HU3/ah" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1); RC=$?
check "launcher file that cannot be written: fails and names it" "[ $RC -ne 0 ] && echo \"\$OUT\" | grep -q 'could not write .*backstage-agent'"

# --- $, ", backtick and a quote in the home folder must not change what the startup line means
HW="$S/we\$ird\"home\`x'y z"; mkdir -p "$HW"
run_install "$HW" /bin/zsh /bin/sh "$SCRIPT" >/dev/null 2>&1
[ "$(env -i HOME="$HW" SHELL=/bin/zsh PATH="$BASE" zsh -ic 'backstage-agent --version' 2>/dev/null)" = 9.9.9 ] && ok "zsh terminal finds it from a home with \$ \" \` ' and a space" || bad "zsh terminal finds it from a home with \$ \" \` ' and a space"
HW2="$S/we\$ird2\"home\`x'y z"; mkdir -p "$HW2"
run_install "$HW2" /bin/bash /bin/sh "$SCRIPT" >/dev/null 2>&1
[ "$(env -i HOME="$HW2" SHELL=/bin/bash PATH="$BASE" bash -ic 'backstage-agent --version' 2>/dev/null)" = 9.9.9 ] && ok "bash terminal finds it from such a home" || bad "bash terminal finds it from such a home"

echo "a link in a folder that is already on the PATH: works in THIS window, in any shell, no PATH step"
mk_linkhome() { H=$(newhome); mkdir -p "$H/.local/bin"; echo "$H"; }
HL=$(mk_linkhome)
OUT=$(env -i HOME="$HL" SHELL=/bin/bash PATH="$HL/.local/bin:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1)
check "says it works right now, and prints no PATH step" "echo \"\$OUT\" | grep -q 'works right now' && ! echo \"\$OUT\" | grep -q '^  export PATH='"
check "the link points at the launcher" "[ \"\$(readlink '$HL/.local/bin/backstage-agent')\" = '$HL/.backstage-agent/bin/backstage-agent' ]"
for sh_name in sh dash bash zsh; do
  [ "$(env -i HOME="$HL" PATH="$HL/.local/bin:$BASE" "$sh_name" -c 'backstage-agent --version' 2>/dev/null)" = 9.9.9 ] && ok "$sh_name: the command works right after the install, with no startup file read and no export" || bad "$sh_name: the command works right after the install"
done
[ "$(env -i HOME="$HL" SHELL=/bin/zsh PATH="$HL/.local/bin:$BASE" zsh -ic 'backstage-agent --version' 2>/dev/null)" = 9.9.9 ] && ok "an interactive zsh window too" || bad "an interactive zsh window too"
check "the login line is printed with no 'open a new terminal' step" "echo \"\$OUT\" | grep -q 'backstage-agent login --url' && ! echo \"\$OUT\" | grep -qi 'new terminal window (or'"

# an older npm -g link of this same package is replaced; nothing else is touched
HL2=$(mk_linkhome)
# a WORKING older npm -g install: the link resolves to a real executable, as it does on a Mac with Homebrew's node
mkdir -p "$HL2/.local/lib/node_modules/@stratpoint/backstage-agent/bin"
printf '#!/bin/sh\necho old\n' > "$HL2/.local/lib/node_modules/@stratpoint/backstage-agent/bin/backstage-agent.js"; chmod +x "$HL2/.local/lib/node_modules/@stratpoint/backstage-agent/bin/backstage-agent.js"
ln -s ../lib/node_modules/@stratpoint/backstage-agent/bin/backstage-agent.js "$HL2/.local/bin/backstage-agent"
OUT=$(env -i HOME="$HL2" SHELL=/bin/zsh PATH="$HL2/.local/bin:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1)
check "the older npm -g link is replaced by ours, and is not reported as an older copy" "[ \"\$(readlink '$HL2/.local/bin/backstage-agent')\" = '$HL2/.backstage-agent/bin/backstage-agent' ] && ! echo \"\$OUT\" | grep -q 'older copy exists at $HL2/.local/bin'"
HL3=$(mk_linkhome); printf 'mine\n' > "$HL3/.local/bin/backstage-agent"
OUT=$(env -i HOME="$HL3" SHELL=/bin/zsh PATH="$HL3/.local/bin:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1)
check "a file that is not ours is left alone, with a warning, and the PATH step is printed instead" "[ \"\$(cat '$HL3/.local/bin/backstage-agent')\" = mine ] && echo \"\$OUT\" | grep -q 'left alone' && echo \"\$OUT\" | grep -q '^  export PATH='"
HL4=$(mk_linkhome); ln -s /bin/true "$HL4/.local/bin/backstage-agent"
env -i HOME="$HL4" SHELL=/bin/zsh PATH="$HL4/.local/bin:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" >/dev/null 2>&1
check "a link that points somewhere else is left alone" "[ \"\$(readlink '$HL4/.local/bin/backstage-agent')\" = /bin/true ]"
HL5=$(newhome); mkdir -p "$HL5/random/bin"
OUT=$(env -i HOME="$HL5" SHELL=/bin/zsh PATH="$HL5/random/bin:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" 2>&1)
check "a writable folder that is not on the short list of normal places is not used" "[ ! -e '$HL5/random/bin/backstage-agent' ] && echo \"\$OUT\" | grep -q '^  export PATH='"
HL6=$(mk_linkhome)
env -i HOME="$HL6" SHELL=/bin/zsh PATH="$HL6/.local/bin:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" --no-modify-path >/dev/null 2>&1
OUT=$(env -i HOME="$HL6" SHELL=/bin/zsh PATH="$HL6/.local/bin:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" --no-modify-path 2>&1)
check "--no-modify-path says nothing was added and still tells how to use it now" "echo \"\$OUT\" | grep -q 'As you asked, nothing was added' && [ \"\$(echo \"\$OUT\" | grep -c '^  export PATH=')\" = 1 ]"
check "--no-modify-path makes no link either" "[ ! -e '$HL6/.local/bin/backstage-agent' ] && [ ! -e '$HL6/.zshrc' ]"

# uninstall removes our link, never someone else's
env -i HOME="$HL" PATH="$HL/.local/bin:$NODEDIR:$BASE" /bin/sh "$SCRIPT" --uninstall >/dev/null 2>&1
check "uninstall removes the link and the list of links" "[ ! -e '$HL/.local/bin/backstage-agent' ] && [ ! -L '$HL/.local/bin/backstage-agent' ] && [ ! -e '$HL/.backstage-agent/links' ]"
HL7=$(mk_linkhome)
env -i HOME="$HL7" SHELL=/bin/zsh PATH="$HL7/.local/bin:$NODEDIR:$BASE" BACKSTAGE_AGENT_PACKAGE="$PKG" /bin/sh "$SCRIPT" >/dev/null 2>&1
rm -f "$HL7/.local/bin/backstage-agent"; ln -s /bin/true "$HL7/.local/bin/backstage-agent"
env -i HOME="$HL7" PATH="$HL7/.local/bin:$NODEDIR:$BASE" /bin/sh "$SCRIPT" --uninstall >/dev/null 2>&1
check "uninstall leaves a link that someone re-pointed" "[ \"\$(readlink '$HL7/.local/bin/backstage-agent')\" = /bin/true ]"

echo "uninstall never cuts the rest of a startup file whose block was edited"
HE=$(newhome); printf 'export KEEP=1\n# >>> backstage-agent >>>\nexport PATH=x\n# my important line\n' > "$HE/.zshrc"
mkdir -p "$HE/.backstage-agent"
OUT=$(env -i HOME="$HE" PATH="$NODEDIR:$BASE" /bin/sh "$SCRIPT" --uninstall 2>&1); RC=$?
check "the edited block is left alone with a warning; every line is still there" "[ $RC -eq 0 ] && grep -q 'my important line' '$HE/.zshrc' && grep -q 'export KEEP=1' '$HE/.zshrc' && echo \"\$OUT\" | grep -q 'left alone'"

echo "uninstall"
printf '{"x":1}' > "$H2/.backstage-agent/config.json"
run_install "$H2" /bin/zsh /bin/sh "$SCRIPT" --uninstall >/dev/null 2>&1; RC=$?
check "exits 0" "[ $RC -eq 0 ]"
check "block removed, other lines kept" "! grep -q 'backstage-agent' '$H2/.zshrc' && grep -q 'export A=1' '$H2/.zshrc' && grep -q 'alias x=y' '$H2/.zshrc'"
check "launcher and npm folder gone, login kept" "[ ! -e '$H2/.backstage-agent/bin' ] && [ ! -e '$H2/.backstage-agent/npm' ] && [ -f '$H2/.backstage-agent/config.json' ]"
check "a new terminal no longer finds it" "[ -z \"\$(env -i HOME='$H2' SHELL=/bin/zsh PATH=$BASE zsh -ic 'command -v backstage-agent' 2>/dev/null)\" ]"

echo; echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
