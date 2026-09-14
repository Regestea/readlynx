// Shared helpers for the release-note scripts (no dependencies, Node 18+).

export function commitLink(repo, sha) {
  return repo ? `[\`${sha}\`](https://github.com/${repo}/commit/${sha})` : `\`${sha}\``;
}

export function installSection(version) {
  const v = version || "<version>";
  return [
    "## 📥 Install",
    "",
    "Get the file for your platform under **Assets** below:",
    "",
    "| Platform | File | How to install |",
    "|---|---|---|",
    `| 🪟 Windows | \`ReadLynx.Setup.${v}.exe\` | Run the installer and follow the steps. |`,
    `| 🍎 macOS (Apple Silicon) | \`ReadLynx-${v}-arm64.dmg\` | Open the .dmg and drag **ReadLynx** to **Applications**. (A \`-mac.zip\` with the same build is also attached.) |`,
    `| 🐧 Linux | \`readlynx_${v}_amd64.deb\` or \`ReadLynx-${v}.AppImage\` | Double-click the .deb, or make the AppImage executable and run it. |`,
    "",
    "> 🔒 All files are checksummed in `SHA256SUMS.txt`. To verify: `sha256sum -c SHA256SUMS.txt`.",
    "",
  ];
}

export function compareLine(repo, prevTag, newVersion) {
  if (!repo || !prevTag) return "";
  const to = newVersion ? `v${newVersion}` : "HEAD";
  return `**Full Changelog**: https://github.com/${repo}/compare/${prevTag}...${to}`;
}
