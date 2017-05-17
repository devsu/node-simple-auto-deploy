const path = require('path');
const watch = require('node-watch');
const Rsync = require('rsync');
const Promise = require('bluebird');
const exec = require('child_process').exec;

const DELAY_BEFORE_SYNC = 50;
const DELAY_BEFORE_NPM_UPDATE = 200;

module.exports = class {
  constructor(source, target) {
    if (!source || !target) {
      throw new Error('source and destination are required.');
    }

    this.source = this._getAbsolutePath(source);
    this.target = this._getAbsolutePath(target);
    this.rsync = new Rsync()
      .flags('av')
      .exclude(['node_modules/', '.git/'])
      .delete()
      .source(path.join(this.source, path.sep))
      .destination(this.target);
    this.rsync = Promise.promisifyAll(this.rsync);
    this.exec = exec;
  }

  _getAbsolutePath(pathString) {
    if (path.isAbsolute(pathString)) {
      return pathString;
    }
    return path.join(process.cwd(), pathString);
  }

  watch() {
    this._sync();
    console.log('initial synchronization');
    return watch(this.source, (action, file) => {
      console.log(action, file);
      this._sync();
    });
  }

  isProcessing() {
    return this._isProcessing;
  }

  isSynchronizing() {
    return this._isSynchronizing;
  }

  isUpdatingModules() {
    return this._isUpdatingModules;
  }

  _scheduleSync() {
    if (this._nextSync) {
      clearTimeout(this._nextSync);
    }
    this._nextSync = setTimeout(() => {
      this._nextSync = null;
      this._sync();
    }, DELAY_BEFORE_SYNC);
  }

  _sync() {
    if (this.isProcessing()) {
      return this._scheduleSync();
    }
    this._isProcessing = true;
    this._isSynchronizing = true;

    process.nextTick(() => {
      this.rsync.executeAsync().then(() => {
        this._scheduleUpdateModules();
        this._isSynchronizing = false;
      }).catch((error) => {
        console.error(error);
        this._isSynchronizing = false;
        this._isProcessing = false;
      });
    });
  }

  _scheduleUpdateModules() {
    if (this._nextUpdateModules) {
      clearTimeout(this._nextUpdateModules);
    }
    this._nextUpdateModules = setTimeout(() => {
      this._updateModules();
    }, DELAY_BEFORE_NPM_UPDATE);
  }

  _updateModules() {
    if (this.isSynchronizing() || this.isUpdatingModules()) {
      return this._scheduleUpdateModules();
    }

    this._isUpdatingModules = true;

    process.nextTick(() => {
      const options = {'cwd': this.target};
      // console.log(' - running npm update && npm prune');
      this.exec('npm update && npm prune', options, (error, stdout, stderr) => {
        if (stdout) {
          console.log(stdout);
        }
        if (stderr) {
          console.error(stderr);
        }
        if (error) {
          console.error(error);
        }
        // console.log(' - done');
        this._isUpdatingModules = false;
        this._isProcessing = false;
      });
    });
  }
};
