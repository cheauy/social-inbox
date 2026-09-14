const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Web and mobile share message-action policies outside the Expo app folder.
// This repository uses separate installs, not package-manager workspaces,
// so Expo does not discover that source directory automatically.
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, "../lib"),
];

module.exports = config;
