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

# Download CLI
mkdir -p "$BINDIR"
echo "  📥 Downloading cm CLI..."
if command -v curl &>/dev/null; then
  curl -fsSL "https://raw.githubusercontent.com/alessiobacin/code-mem/main/bin/cm" -o "$BINDIR/cm"
elif command -v wget &>/dev/null; then
  wget -q "https://raw.githubusercontent.com/alessiobacin/code-mem/main/bin/cm" -O "$BINDIR/cm"
else
  echo "❌ Need curl or wget"
  exit 1
fi
chmod +x "$BINDIR/cm"

echo "  ✅ CLI installed at $BINDIR/cm"

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
