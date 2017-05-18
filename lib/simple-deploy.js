const path = require('path');
const watch = require('node-watch');
const Rsync = require('rsync');
const Promise = require('bluebird');
const childProcess = require('child_process');

const DELAY_BEFORE_SYNC = 50;
const DELAY_BEFORE_NPM_UPDATE = 200;

module.exports = class {
  constructor(source, target) {
    if (!source || !target) {
      throw new Error('source and destination are required.');
    }

    console.log(`SimpleDeploy "${source}" > "${target}"`);
    this.source = this._getAbsolutePath(source);
    this.target = this._getAbsolutePath(target);
    this.rsync = new Rsync()
      .flags('av')
      .exclude(['node_modules/', '.git/'])
      .delete()
      .source(path.join(this.source, path.sep))
      .destination(this.target);
    this.rsync = Promise.promisifyAll(this.rsync);
  }

  _getAbsolutePath(pathString) {
    if (path.isAbsolute(pathString)) {
      return pathString;
    }
    return path.join(process.cwd(), pathString);
  }

  watch() {
    this._sync();
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
      this._spawn('npm', ['update']).then(() => {
        return this._spawn('npm', ['prune']);
      }).then(() => {
        this._isUpdatingModules = false;
        this._isProcessing = false;
      });
    });
  }

  _spawn(command, args) {
    const options = {'cwd': this.target};
    const child = childProcess.spawn(command, args, options);
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    return new Promise((resolve) => {
      child.on('close', resolve);
    });
  }
};
