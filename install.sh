#!/bin/bash
set -e

echo "🧠 Installing code-mem — Project Memory Tool..."

# Detect OS
UNAME=$(uname -s)
case "$UNAME" in
  Linux)  BINDIR="$HOME/.local/bin" ;;
  Darwin) BINDIR="$HOME/.local/bin" ;;
  *)      BINDIR="/usr/local/bin" ;;
esac

# Detect harness
HARNESS=""
if command -v pi &>/dev/null; then HARNESS="$HARNESS pi"; fi
CLAUDE_CODE_DIR="$HOME/.claude"
if [ -d "$CLAUDE_CODE_DIR" ]; then HARNESS="$HARNESS claude-code"; fi
if [ -d "$HOME/.codex" ]; then HARNESS="$HARNESS codex"; fi
if [ -d "$HOME/.cursor" ]; then HARNESS="$HARNESS cursor"; fi

# Download CLI into a same-directory staging area, verify it, then replace the
# installed file in one rename. A failed/interrupted download must never leave
# a partially written executable at the user's PATH.
mkdir -p "$BINDIR"
INSTALL_TMP=$(mktemp -d "$BINDIR/.cm-install.XXXXXX")
cleanup() { rm -rf "$INSTALL_TMP"; }
trap cleanup EXIT

REMOTE_BASE="https://raw.githubusercontent.com/alessiobacin/code-mem/main"
echo "  📥 Downloading cm CLI..."
if command -v curl &>/dev/null; then
  curl -fsSL "$REMOTE_BASE/bin/cm" -o "$INSTALL_TMP/cm"
  curl -fsSL "$REMOTE_BASE/bin/cm.sha256" -o "$INSTALL_TMP/cm.sha256"
elif command -v wget &>/dev/null; then
  wget -q "$REMOTE_BASE/bin/cm" -O "$INSTALL_TMP/cm"
  wget -q "$REMOTE_BASE/bin/cm.sha256" -O "$INSTALL_TMP/cm.sha256"
else
  echo "❌ Need curl or wget"
  exit 1
fi

EXPECTED_SHA=$(awk 'NF { print $1; exit }' "$INSTALL_TMP/cm.sha256")
if ! printf '%s\n' "$EXPECTED_SHA" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  echo "❌ Invalid remote checksum manifest"
  exit 1
fi
if command -v sha256sum &>/dev/null; then
  ACTUAL_SHA=$(sha256sum "$INSTALL_TMP/cm" | awk '{print $1}')
elif command -v shasum &>/dev/null; then
  ACTUAL_SHA=$(shasum -a 256 "$INSTALL_TMP/cm" | awk '{print $1}')
else
  echo "❌ Need sha256sum or shasum to verify the downloaded CLI"
  exit 1
fi
EXPECTED_SHA=$(printf '%s' "$EXPECTED_SHA" | tr '[:upper:]' '[:lower:]')
ACTUAL_SHA=$(printf '%s' "$ACTUAL_SHA" | tr '[:upper:]' '[:lower:]')
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo "❌ SHA-256 checksum mismatch; CLI was not installed"
  exit 1
fi

chmod +x "$INSTALL_TMP/cm"
mv -f "$INSTALL_TMP/cm" "$BINDIR/cm"
echo "  ✅ SHA-256 verified"

echo "  ✅ CLI installed at $BINDIR/cm"

# One per-user graph service serves every registered project. It binds only to
# loopback and keeps project memory/harness execution isolated by project token.
# Keep installation non-fatal on older systems without launchd/systemd user
# support; `cm service start` remains available as an explicit fallback.
if "$BINDIR/cm" service install --global; then
  echo "  ✅ Global local graph service installed"
else
  echo "  ℹ️  Global graph service could not auto-start; run: cm service install"
fi

# Install skill for each harness
SKILL_URL="https://raw.githubusercontent.com/alessiobacin/code-mem/main/skill/SKILL.md"
INSTALLED=0
for h in $HARNESS; do
  case "$h" in
    pi)         SKILL_DIR="$HOME/.pi/agent/skills/cm" ;;
    claude-code) SKILL_DIR="$HOME/.claude/skills/cm" ;;
    codex)      SKILL_DIR="$HOME/.codex/skills/cm" ;;
    cursor)     SKILL_DIR="$HOME/.cursor/skills/cm" ;;
  esac
  mkdir -p "$SKILL_DIR"
  if command -v curl &>/dev/null; then
    curl -fsSL "$SKILL_URL" -o "$SKILL_DIR/SKILL.md"
  else
    wget -q "$SKILL_URL" -O "$SKILL_DIR/SKILL.md"
  fi
  echo "  ✅ Skill installed for $h"
  INSTALLED=1
done

echo ""
echo "✅ code-mem installed successfully!"
echo ""
echo "📋 Add to PATH (add to ~/.bashrc or ~/.zshrc):"
echo "   export PATH=\"\$PATH:$BINDIR\""
echo ""
echo "📋 In your project:"
echo "   cm init"
echo ""
echo "📋 Commands:"
echo "   cm save --kind fact \"Project uses TypeScript\""
echo "   cm recall \"fix flaky tests\" --level 2"
echo "   cm plan \"deploy preview build\""
echo "   cm project"
echo "   cm update"
echo ""

# Auto-add to PATH in current shell
export PATH="$PATH:$BINDIR"

# Offer to add to .bashrc/.zshrc
SHELL_NAME=$(basename "$SHELL" 2>/dev/null || echo "bash")
RCFILE="$HOME/.${SHELL_NAME}rc"
if [ -f "$RCFILE" ]; then
  if ! grep -q "$BINDIR" "$RCFILE" 2>/dev/null; then
    echo ""
    echo "  ℹ️  Add to $RCFILE?:"
    echo "     echo 'export PATH=\"\$PATH:$BINDIR\"' >> $RCFILE"
  fi
fi
