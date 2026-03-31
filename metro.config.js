const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Add .pte (ExecuTorch model) and .onnx as asset extensions
config.resolver.assetExts.push("pte", "onnx", "bin");

module.exports = config;
