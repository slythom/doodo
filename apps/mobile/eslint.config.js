// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Les props JSX de React Three Fiber (position, args, flatShading, attach…)
    // sont inconnues de react/no-unknown-property — c'est un faux positif.
    files: ['src/scenes/**/*.tsx'],
    rules: {
      'react/no-unknown-property': 'off',
    },
  },
]);
