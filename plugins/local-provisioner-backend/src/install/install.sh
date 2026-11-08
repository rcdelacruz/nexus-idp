#!/bin/sh
# Backstage Agent installer for macOS and Linux.
#
#   curl -fsSL <portal>/api/local-provisioner/agent/install.sh | sh
#
# What it does: installs the agent into its own folder (~/.backstage-agent/npm), writes a small
# launcher that always runs the agent with the Node that installed it, and puts that launcher on
# the PATH of every new terminal. So `backstage-agent` works in any terminal window, whatever
# Node version nvm or Homebrew has active there.
#
# Options (after `sh -s --`):  --uninstall   --version X.Y.Z   --no-modify-path
# Environment: BACKSTAGE_AGENT_HOME (default ~/.backstage-agent), BACKSTAGE_AGENT_VERSION
#
# The whole script is inside main(), which runs on the last line: a download that stops half way
# runs nothing.

PORTAL_URL='__PORTAL_URL__'
PACKAGE='@stratpoint/backstage-agent'
MARK_BEGIN='# >>> backstage-agent >>>'
MARK_END='# <<< backstage-agent <<<'

say() { printf '%s\n' "$*"; }
warn() { printf 'Note: %s\n' "$*" >&2; }
die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

# Shell-quote a value so it can be written into the launcher whatever characters the path holds.
sq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# Remove our block from a startup file, keeping everything else as it was.
strip_block() {
  [ -f "$1" ] || return 0
  grep -q "$MARK_BEGIN" "$1" || return 0
  # Without the end marker (someone edited the block) nothing is cut: "everything after the begin marker" would be the
  # rest of the person's startup file.
  grep -q "$MARK_END" "$1" || {
    warn "the agent's lines in $1 were edited, so they were left alone. Remove the 'backstage-agent' block there by hand."
    return 0
  }
  tmp="$1.backstage-agent.$$"
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0 == b { skip = 1 } !skip { print } $0 == e { skip = 0 }' "$1" > "$tmp" && cat "$tmp" > "$1"
  rm -f "$tmp"
}

# Add (or refresh) the PATH block in a startup file.
add_block() {
  file="$1"
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 1
  strip_block "$file"
  qdir="$(sq "$BIN_DIR")"
  {
    # A blank line first only when the file already has content that does not end in one.
    [ -s "$file" ] && [ -n "$(tail -c1 "$file")" ] && printf '\n'
    printf '%s\n' "$MARK_BEGIN"
    # The folder is single-quoted, so a $, ", ` or space in the path cannot change what the line means.
    printf 'case ":$PATH:" in *":"%s":"*) ;; *) export PATH=%s":$PATH" ;; esac\n' "$qdir" "$qdir"
    printf '%s\n' "$MARK_END"
  } >> "$file" 2>/dev/null || {
    warn "could not write to $file"
    return 1
  }
  say "  added to $file"
}

add_fish_file() {
  file="$HOME/.config/fish/conf.d/backstage-agent.fish"
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 1
  # set -gx works in every fish version (fish_add_path needs 3.2); \ and ' are escaped for fish's single quotes.
  fdir="'$(printf '%s' "$BIN_DIR" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g")'"
  {
    printf '%s\n' "$MARK_BEGIN"
    printf 'if not contains -- %s $PATH\n    set -gx PATH %s $PATH\nend\n' "$fdir" "$fdir"
    printf '%s\n' "$MARK_END"
  } > "$file" 2>/dev/null || {
    warn "could not write to $file"
    return 1
  }
  say "  added to $file"
}

shell_files() {
  case "${SHELL:-}" in
    */zsh) echo zsh ;;
    */bash) echo bash ;;
    */fish) echo fish ;;
  esac
  # macOS: zsh is the default shell even when this script was started by sh.
  [ "$(uname -s)" = "Darwin" ] && case "${SHELL:-}" in */zsh) ;; *) echo zsh ;; esac
  [ -d "$HOME/.config/fish" ] && case "${SHELL:-}" in */fish) ;; *) echo fish ;; esac
}

modify_path() {
  done_any=0
  for sh_name in $(shell_files | sort -u); do
    case "$sh_name" in
      zsh) add_block "${ZDOTDIR:-$HOME}/.zshrc" && done_any=1 ;;
      bash)
        if [ "$(uname -s)" = "Darwin" ]; then
          # Terminal.app starts login shells, which read .bash_profile and not .bashrc.
          add_block "$HOME/.bash_profile" && done_any=1
        else
          add_block "$HOME/.bashrc" && done_any=1
        fi
        ;;
      fish) add_fish_file && done_any=1 ;;
    esac
  done
  PATH_WRITTEN="$done_any"
}

# A folder that is already on THIS terminal's PATH and that the user may write to. A link to the launcher there makes
# the command work in the window the installer was started from and in every other one, with no PATH step to type
# (a script cannot change the PATH of the terminal that started it, but it can put the command where that PATH looks).
pick_link_dir() {
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
    [ -d "$d" ] && [ -w "$d" ] || continue
    case ":$PATH:" in *":$d:"*)
      echo "$d"
      return 0
      ;;
    esac
  done
  return 1
}

# Sets LINKED to the folder when the link was made. An existing link is replaced only when it is the older npm -g link
# of this same package (or already ours); anything else in that place is left alone.
link_command() {
  LINKED=""
  ldir="$(pick_link_dir)" || return 0
  ltarget="$ldir/backstage-agent"
  if [ -L "$ltarget" ]; then
    case "$(readlink "$ltarget")" in
      "$launcher" | *node_modules/@stratpoint/backstage-agent/*) ;;
      *)
        warn "$ltarget already points somewhere else, so it was left alone."
        return 0
        ;;
    esac
  elif [ -e "$ltarget" ]; then
    warn "$ltarget exists and is not a link, so it was left alone."
    return 0
  fi
  ln -sf "$launcher" "$ltarget" 2>/dev/null || {
    warn "could not link $ltarget"
    return 0
  }
  grep -qxF "$ltarget" "$AGENT_HOME/links" 2>/dev/null || printf '%s\n' "$ltarget" >> "$AGENT_HOME/links"
  LINKED="$ldir"
  say "  linked $ltarget"
}

# ready, closed (installed, the daemon does not answer or hangs) or missing. `docker info` can hang while Docker Desktop is
# starting, so it gets a time limit (BACKSTAGE_AGENT_DOCKER_WAIT seconds, default 10) and never reads this script's stdin.
docker_state() {
  command -v docker >/dev/null 2>&1 || {
    echo missing
    return
  }
  docker info >/dev/null 2>&1 < /dev/null &
  dpid=$!
  waited=0
  while kill -0 "$dpid" 2>/dev/null; do
    if [ "$waited" -ge "${BACKSTAGE_AGENT_DOCKER_WAIT:-10}" ]; then
      kill "$dpid" 2>/dev/null
      echo closed
      return
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if wait "$dpid"; then echo ready; else echo closed; fi
}

uninstall() {
  if [ -x "$BIN_DIR/backstage-agent" ]; then
    "$BIN_DIR/backstage-agent" stop >/dev/null 2>&1 < /dev/null || true
  fi
  # Remove the links the installer made, but only those that still point at its launcher.
  if [ -f "$AGENT_HOME/links" ]; then
    while IFS= read -r l; do
      if [ -n "$l" ] && [ -L "$l" ] && [ "$(readlink "$l")" = "$BIN_DIR/backstage-agent" ]; then rm -f "$l"; fi
    done < "$AGENT_HOME/links"
    rm -f "$AGENT_HOME/links"
  fi
  rm -rf "$PREFIX" "$BIN_DIR"
  for f in "${ZDOTDIR:-$HOME}/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    strip_block "$f"
  done
  rm -f "$HOME/.config/fish/conf.d/backstage-agent.fish"
  say "Backstage Agent removed. Your login, logs and labs in $AGENT_HOME were kept."
  say "Delete that folder too if you want everything gone."
}

main() {
  AGENT_HOME="${BACKSTAGE_AGENT_HOME:-$HOME/.backstage-agent}"
  # The installer owns $AGENT_HOME/npm and $AGENT_HOME/bin and deletes them on --uninstall, so the
  # folder must be a real, dedicated one.
  case "$AGENT_HOME" in
    /?*) ;;
    *) die "BACKSTAGE_AGENT_HOME must be an absolute path." ;;
  esac
  [ "$AGENT_HOME" != "$HOME" ] || die "BACKSTAGE_AGENT_HOME must be a folder of its own, not your home folder."
  PREFIX="$AGENT_HOME/npm"
  BIN_DIR="$AGENT_HOME/bin"
  VERSION="${BACKSTAGE_AGENT_VERSION:-latest}"
  MODIFY_PATH=1
  ACTION=install

  while [ $# -gt 0 ]; do
    case "$1" in
      --uninstall) ACTION=uninstall ;;
      --no-modify-path) MODIFY_PATH=0 ;;
      --version)
        [ $# -ge 2 ] || die "--version needs a value, for example --version 0.1.31"
        VERSION="$2"
        shift
        ;;
      *) die "unknown option: $1" ;;
    esac
    shift
  done

  [ -n "${HOME:-}" ] || die "HOME is not set."
  # With sudo the agent would land in root's files (or root-owned files in yours) and fail later on permissions.
  if [ "$(id -u 2>/dev/null)" = 0 ] && [ -n "${SUDO_USER:-}" ]; then
    die "do not run this with sudo. Run it as yourself, without sudo."
  fi
  case "$(uname -s)" in
    Darwin | Linux) ;;
    *) die "this installer is for macOS and Linux. On Windows run: npm install -g $PACKAGE" ;;
  esac

  if [ "$ACTION" = uninstall ]; then
    uninstall
    return 0
  fi

  case "$VERSION" in
    latest | [0-9]*.[0-9]*.[0-9]*) ;;
    *) die "the version must be latest or like 0.1.31" ;;
  esac

  # 1. Node 20 or newer, and the npm that belongs to it.
  NODE="$(command -v node 2>/dev/null)" || NODE=""
  if [ -z "$NODE" ]; then
    die "Node.js was not found in this terminal. Install Node 20 or newer, open a new terminal, and run this again.
  macOS:  brew install node     (or the installer from https://nodejs.org)
  Linux:  https://nodejs.org/en/download  (or nvm: https://github.com/nvm-sh/nvm)
  Already use nvm? Run: nvm use default   (or: nvm use 22)   and then run this again."
  fi
  NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null < /dev/null)"
  case "$NODE_MAJOR" in
    '' | *[!0-9]*) die "could not read the version of $NODE" ;;
  esac
  [ "$NODE_MAJOR" -ge 20 ] || die "Node $NODE_MAJOR is too old (the agent needs 20 or newer). Update Node, open a new terminal, and run this again."
  # Pin the real binary (version-manager shims and symlinks resolved): a shim path can be a per-terminal
  # folder that is gone tomorrow, and the launcher must keep working in terminals that never had it.
  REAL_NODE="$("$NODE" -p 'process.execPath' 2>/dev/null < /dev/null)"
  if [ -n "$REAL_NODE" ] && [ -x "$REAL_NODE" ]; then NODE="$REAL_NODE"; fi
  NODE_DIR="$(dirname "$NODE")"
  if [ -x "$NODE_DIR/npm" ]; then
    NPM="$NODE_DIR/npm"
  else
    NPM="$(command -v npm 2>/dev/null)" || die "npm was not found next to $NODE."
  fi

  say "Installing the Backstage Agent ($PACKAGE@$VERSION) with Node $("$NODE" -v)..."
  PATH="$NODE_DIR:$PATH" "$NPM" install -g --prefix "$PREFIX" --no-fund --no-audit --loglevel=error "${BACKSTAGE_AGENT_PACKAGE:-$PACKAGE@$VERSION}" < /dev/null \
    || die "npm could not install the agent (see the lines above). Check your internet connection and try again."

  ENTRY="$PREFIX/lib/node_modules/$PACKAGE/bin/backstage-agent.js"
  [ -f "$ENTRY" ] || die "npm finished, but $ENTRY is missing."

  # 2. The launcher: the Node that installed the agent, found again by absolute path. If that
  #    Node was removed later (an old nvm version), it falls back to whatever node is on the PATH.
  mkdir -p "$BIN_DIR" || die "could not create $BIN_DIR (is the folder writable?)"
  launcher="$BIN_DIR/backstage-agent"
  {
    printf '%s\n' '#!/bin/sh'
    printf '%s\n' '# Written by the Backstage Agent installer. Runs the agent with the Node that installed it.'
    printf 'NODE=%s\n' "$(sq "$NODE")"
    printf 'ENTRY=%s\n' "$(sq "$ENTRY")"
    # The Node that installed the agent is gone (an old nvm version, a Homebrew cleanup): use the node on the PATH,
    # but only if it is new enough to run the agent.
    # shellcheck disable=SC2016
    printf '%s\n' 'if [ ! -x "$NODE" ]; then'
    # shellcheck disable=SC2016
    printf '%s\n' '  NODE="$(command -v node 2>/dev/null)"'
    # shellcheck disable=SC2016
    printf '%s\n' '  [ -n "$NODE" ] || { echo "backstage-agent: Node.js was not found. Install Node 20 or newer, or run the installer again." >&2; exit 127; }'
    # shellcheck disable=SC2016
    printf '%s\n' '  case "$("$NODE" -p '"'"'process.versions.node.split(".")[0]'"'"' 2>/dev/null)" in'
    # shellcheck disable=SC2016
    printf '%s\n' '    "" | *[!0-9]* | 1? | [0-9]) echo "backstage-agent: the Node on this terminal is too old (the agent needs 20 or newer). Update Node or run the installer again." >&2; exit 127 ;;'
    printf '%s\n' '  esac'
    printf '%s\n' 'fi'
    # The agent starts its background process and runs npm by name: keep this Node first on the PATH.
    # shellcheck disable=SC2016
    printf '%s\n' 'PATH="$(dirname "$NODE"):$PATH"'
    printf '%s\n' 'export PATH'
    # shellcheck disable=SC2016
    printf '%s\n' 'exec "$NODE" "$ENTRY" "$@"'
  } > "$launcher" || die "could not write $launcher (is the folder writable?)"
  chmod 755 "$launcher" || die "could not make $launcher executable"

  # 3. Every terminal finds it: a link in a folder that is already on the PATH (works in this window at once), and a
  #    line in the shell startup files for the case where no such folder exists.
  other="$(command -v backstage-agent 2>/dev/null)"
  LINKED=""
  PATH_WRITTEN=0
  if [ "$MODIFY_PATH" = 1 ]; then
    say "Making backstage-agent available in every terminal:"
    link_command
    modify_path
  fi

  INSTALLED="$("$launcher" --version 2>/dev/null < /dev/null)" || die "the agent was installed but does not start. Run: $launcher --version"
  say "Installed: backstage-agent $INSTALLED"

  # 4. Things to know before it can run.
  if [ -n "$other" ] && [ "$other" != "$launcher" ] && [ "$other" != "$LINKED/backstage-agent" ]; then
    warn "an older copy exists at $other. New terminals use the one from this installer first. To remove the old one: npm uninstall -g $PACKAGE (with the Node version that installed it)."
  fi
  if [ -f "$AGENT_HOME/agent.pid" ] && kill -0 "$(cat "$AGENT_HOME/agent.pid" 2>/dev/null)" 2>/dev/null; then
    warn "the agent is running on the old version. Restart it: backstage-agent stop && backstage-agent start"
  fi
  case "$(docker_state)" in
    missing) warn "Docker is not installed, and the agent will not start without it. Install Docker Desktop (recommended): https://www.docker.com/products/docker-desktop/  (Linux: Docker Engine, https://docs.docker.com/engine/install/)" ;;
    closed) warn "Docker is installed but not running. Open Docker Desktop and wait until it says it is running; the agent will not start before that." ;;
  esac
  command -v multipass >/dev/null 2>&1 || say "Linux server labs also need Multipass (macOS: brew install --cask multipass). The agent tells you when a lab needs it."

  say ""
  if [ -n "$LINKED" ]; then
    # The command is already where this terminal looks: nothing to type but the next steps.
    say "Done. backstage-agent works right now, in this window and in every new one:"
    say ""
  else
    # No folder on the PATH that we may write to: the PATH step has to be typed. These lines are meant to be pasted
    # top to bottom in THIS window. The line is printed once, with words that match what happened to the startup files.
    if [ "$MODIFY_PATH" = 0 ]; then
      say "Installed. As you asked, nothing was added to your PATH. To use it in THIS window, run this first:"
    elif [ "$PATH_WRITTEN" = 1 ]; then
      say "Installed. To use it in THIS window, run this first (terminal windows you open from now on already have it):"
    else
      say "Installed, but no shell startup file could be changed. Run this in THIS window, and add the same line to the startup file of your shell so new windows have it too:"
    fi
    say ""
    say "  export PATH=$(sq "$BIN_DIR"):\"\$PATH\""
    say ""
    say "Then:"
    say ""
  fi
  case "$PORTAL_URL" in
    http*) say "  backstage-agent login --url $PORTAL_URL" ;;
    *) say "  backstage-agent login --url <your portal address>" ;;
  esac
  say "  backstage-agent start"
}

main "$@"
