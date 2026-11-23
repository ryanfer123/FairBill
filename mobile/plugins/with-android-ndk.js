const { withProjectBuildGradle } = require('expo/config-plugins');

module.exports = function withAndroidNdk(config, { version }) {
  return withProjectBuildGradle(config, (mod) => {
    const marker = 'apply plugin: "expo-root-project"';
    const assignment = `ext.ndkVersion = "${version}"`;
    const contents = mod.modResults.contents;
    if (!contents.includes(marker)) throw new Error('The Expo root Gradle plugin was not found.');
    if (!contents.includes(assignment)) {
      mod.modResults.contents = contents.replace(marker, `${assignment}\n${marker}`);
    }
    return mod;
  });
};
