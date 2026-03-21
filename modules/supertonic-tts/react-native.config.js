module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: "./android",
        packageImportPath: "import com.supertonictts.SupertonicTTSPackage;",
        packageInstance: "new SupertonicTTSPackage()",
      },
      ios: {
        podspecPath: "./ios/SupertonicTTS.podspec",
      },
    },
  },
};
