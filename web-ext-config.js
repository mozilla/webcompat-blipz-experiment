module.exports = {
  sourceDir: 'webextension',
  verbose: true,
  build: {
    overwriteDest: true
  },
  run: {
    firefox: 'nightly'
  }
};
