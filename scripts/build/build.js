'use strict';
// Node module dependencies
const fs = require('fs-extra'),
  queue = require('queue'),
  path = require('path'),
  exec = require('child_process').exec;
const nodeFs = require('fs');

// Constants for the build process. Paths and JSON files templates
const ROOT = path.resolve(__dirname, '..', '..'), // root ionic-native directory
  PLUGINS_PATH = path.resolve(ROOT, 'src', '@ionic-native', 'plugins'), // path to plugins source files
  CORE_PACKAGE_JSON = require(path.resolve(__dirname, 'core-package.json')), // core package.json
  PLUGIN_PACKAGE_JSON = require(path.resolve(__dirname, 'plugin-package.json')), // plugin package.json template
  PLUGIN_TS_CONFIG = require(path.resolve(__dirname, 'tsconfig-plugin.json')), // plugin tsconfig template
  BUILD_TMP = path.resolve(ROOT, '.tmp'), // tmp directory path
  BUILD_DIST_ROOT = path.resolve(ROOT, 'dist', '@ionic-native'), // dist directory root path
  BUILD_CORE_DIST = path.resolve(BUILD_DIST_ROOT, 'core'); // core dist directory path

// dependency versions
const ANGULAR_VERSION = '*',
  RXJS_VERSION = '^5.5.11',
  MIN_CORE_VERSION = '^4.11.0',
  IONIC_NATIVE_VERSION = require(path.resolve(ROOT, 'package.json')).version;

// package dependencies
const CORE_PEER_DEPS = {
  rxjs: RXJS_VERSION
};

const PLUGIN_PEER_DEPS = {
  '@ionic-native/core': MIN_CORE_VERSION,
  '@angular/core': ANGULAR_VERSION,
  rxjs: RXJS_VERSION
};

// set peer dependencies for all plugins
PLUGIN_PACKAGE_JSON.peerDependencies = PLUGIN_PEER_DEPS;

// Create tmp/dist directories
console.log('Making new TMP directory');
fs.mkdirpSync(BUILD_TMP);

// Prepare and copy the core module's package.json
console.log('Preparing core module package.json');
CORE_PACKAGE_JSON.version = IONIC_NATIVE_VERSION;
CORE_PACKAGE_JSON.peerDependencies = CORE_PEER_DEPS;
fs.writeJsonSync(
  path.resolve(BUILD_CORE_DIST, 'package.json'),
  CORE_PACKAGE_JSON
);

// Fetch a list of the plugins
const PLUGINS = fs.readdirSync(PLUGINS_PATH);

// Build specific list of plugins to build from arguments, if any
let pluginsToBuild = process.argv.slice(2);
let ignoreErrors = false;
let errors = [];

const index = pluginsToBuild.indexOf('ignore-errors');
if (index > -1) {
  ignoreErrors = true;
  pluginsToBuild.splice(index, 1);
  console.log(
    'Build will continue even if errors were thrown. Errors will be printed when build finishes.'
  );
}

if (!pluginsToBuild.length) {
  pluginsToBuild = PLUGINS;
}

// Create a queue to process tasks
const QUEUE = queue({
  concurrency: require('os').cpus().length
});

// Function to process a single plugin
const addPluginToQueue = pluginName => {
  QUEUE.push(callback => {
    console.log(`Building plugin: ${pluginName}`);

    const PLUGIN_BUILD_DIR = path.resolve(BUILD_TMP, 'plugins', pluginName),
      PLUGIN_SRC_PATH = path.resolve(PLUGINS_PATH, pluginName, 'index.ts');

    let tsConfigPath;

    fs.mkdirp(PLUGIN_BUILD_DIR) // create tmp build dir
      .then(() => fs.mkdirp(path.resolve(BUILD_DIST_ROOT, pluginName))) // create dist dir
      .then(() => {
        // Write tsconfig.json
        const tsConfig = JSON.parse(JSON.stringify(PLUGIN_TS_CONFIG));
        tsConfig.files = ["../../../src/@ionic-native/plugins/ble/index.ts"];
        tsConfig.include = ["../../../src/@ionic-native/plugins/ble/index.ts", "**/*"];
        tsConfig.exclude = ["node_modules", "bower_components", "jspm_packages"];

        // tsConfig.compilerOptions.paths['@ionic-native/core'] = [BUILD_CORE_DIST];

        tsConfigPath = path.resolve(PLUGIN_BUILD_DIR, 'tsconfig.json');

        // nodeFs.writeFileSync(tsConfigPath.replace('tsconfig.json', 'index.ts'), 'export {};');
        return fs.writeJson(tsConfigPath, tsConfig);
      })
      .then(() => {
        // clone package.json
        const packageJson = JSON.parse(JSON.stringify(PLUGIN_PACKAGE_JSON));

        packageJson.name = `@ionic-native/${pluginName}`;
        packageJson.version = IONIC_NATIVE_VERSION;

        return fs.writeJson(
          path.resolve(BUILD_DIST_ROOT, pluginName, 'package.json'),
          packageJson
        );
      })
      .then(() => {
        // compile the plugin
        exec(
          `npx ngc --transpile-only -p ${tsConfigPath}`,
          (err, stdout, stderr) => {
            if (err) {
              if (!ignoreErrors) {
                // oops! something went wrong.
                console.log(err);
                callback(`\n\nBuilding ${pluginName} failed.`);
                return;
              } else {
                errors.push(err);
              }
            }

            // we're done with this plugin!
            callback();
          }
        );
      })
      .catch(callback);
  }); // QUEUE.push end
};

pluginsToBuild.forEach(addPluginToQueue);

QUEUE.start(err => {
  if (err) {
    console.log('Error building plugins.');
    console.log(err);
    process.stderr.write(err);
    process.exit(1);
  } else if (errors.length) {
    errors.forEach(e => {
      console.log(e.message) && console.log('\n');
      process.stderr.write(err);
    });
    console.log('Build complete with errors');
    process.exit(1);
  } else {
    console.log('Done processing plugins!');
  }
});
