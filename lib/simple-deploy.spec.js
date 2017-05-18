const Promise = require('bluebird');
const path = require('path');
const Spy = require('jasmine-spy');
const proxyquire = require('proxyquire');
const fs = Promise.promisifyAll(require('fs'));
const rimraf = Promise.promisify(require('rimraf'));
const touch = Promise.promisify(require('touch'));
const childProcess = require('child_process');

/* eslint-disable max-len */

describe('SimpleDeploy', () => {
  let SimpleDeploy, simpleDeploy, source, target, originalSpawn, childStub;

  beforeEach(() => {
    originalSpawn = childProcess.spawn;
    childStub = {
      'stdout': {},
      'stderr': {},
    };
    childStub.stdout.pipe = Spy.create();
    childStub.stderr.pipe = Spy.create();
    childStub.on = Spy.create().and.callFake((event, method) => {
      process.nextTick(method);
    });
    childProcess.spawn = Spy.returnValue(childStub);
    SimpleDeploy = proxyquire('./simple-deploy', {'child_process': childProcess});
    source = './foo';
    target = './bar';
  });

  afterEach(() => {
    childProcess.spawn = originalSpawn;
  });

  describe('constructor()', () => {
    describe('no params', () => {
      it('should fail with error', () => {
        expect(() => {
          simpleDeploy = new SimpleDeploy();
        }).toThrowError('source and destination are required.');
      });
    });

    describe('only source is passed', () => {
      it('should fail with error', () => {
        expect(() => {
          simpleDeploy = new SimpleDeploy(source);
        }).toThrowError('source and destination are required.');
      });
    });

    describe('source and target are passed', () => {
      it('should not fail', () => {
        simpleDeploy = new SimpleDeploy(source, target);
      });
      describe('paths are relative', () => {
        it('should set source and target properties considering cwd()', () => {
          const expectedSource = path.join(process.cwd(), source);
          const expectedTarget = path.join(process.cwd(), target);
          simpleDeploy = new SimpleDeploy(source, target);
          expect(simpleDeploy.source).toEqual(expectedSource);
          expect(simpleDeploy.target).toEqual(expectedTarget);
        });
      });
      describe('paths are absolute', () => {
        it('should set source and target properties as they are', () => {
          source = '/tmp/a';
          target = '/tmp/b';
          simpleDeploy = new SimpleDeploy(source, target);
          expect(simpleDeploy.source).toEqual(source);
          expect(simpleDeploy.target).toEqual(target);
        });
      });
    });
  });

  describe('watch()', () => {
    let watcher;

    beforeEach((done) => {
      simpleDeploy = new SimpleDeploy(source, target);
      Promise.resolve().then(() => {
        return Promise.all([
          fs.mkdirAsync(source),
          fs.mkdirAsync(target),
        ]);
      }).then(() => {
        return Promise.all([
          fs.mkdirAsync(path.join(source, 'my-folder')),
          fs.mkdirAsync(path.join(source, 'node_modules')),
          fs.mkdirAsync(path.join(source, '.git')),
        ]);
      }).then(() => {
        return Promise.all([
          touch(path.join(source, 'file1.txt')),
          touch(path.join(source, 'node_modules', 'another.txt')),
          touch(path.join(source, 'my-folder', 'my-file.txt')),
        ]);
      }).then(() => {
        watcher = simpleDeploy.watch();
      }).then(done).catch(done.fail);
    });

    afterEach((done) => {
      Promise.all([
        rimraf(source),
        rimraf(target),
      ]).then(() => {
        watcher.close();
      }).then(done).catch(done.fail);
    });

    it('should sync the folder', (done) => {
      whenSyncIsDone(() => {
        return Promise.all([
          fs.statAsync(path.join(target, 'file1.txt')),
          fs.statAsync(path.join(target, 'my-folder')),
          fs.statAsync(path.join(target, 'my-folder', 'my-file.txt')),
        ]);
      }).then(done).catch(done.fail);
    });

    it('should not sync node_modules', (done) => {
      whenSyncIsDone(() => {
        return fs.statAsync(path.join(target, 'node_modules', 'another.txt'));
      }).then(done.fail).catch(verifyFileDoesNotExist).then(done);
    });

    it('should not sync .git', (done) => {
      whenSyncIsDone(() => {
        return fs.statAsync(path.join(target, '.git'));
      }).then(done.fail).catch(verifyFileDoesNotExist).then(done);
    });

    describe('when a file is added', () => {
      beforeEach((done) => {
        touch(path.join(source, 'file2.txt'), done);
      });

      it('should sync the folder', (done) => {
        whenSyncIsDone(() => {
          return fs.statAsync(path.join(target, 'file2.txt'));
        }).then(done).catch(done.fail);
      });
    });

    describe('when a file/folder is removed', () => {
      beforeEach((done) => {
        rimraf(path.join(source, 'my-folder')).then(done).catch(done.fail);
      });

      it('should delete the removed file/folder', (done) => {
        whenSyncIsDone(() => {
          return fs.statAsync(path.join(target, 'my-folder'));
        }).then(done.fail).catch(verifyFileDoesNotExist).then(done);
      });
    });

    describe('rsync.execute returns an error', () => {
      let originalError;

      beforeEach(() => {
        originalError = console.error;
        console.error = Spy.create();
        simpleDeploy.rsync.executeAsync = Spy.reject('error!');
      });

      afterEach(() => {
        console.error = originalError;
      });

      it('should log the error', (done) => {
        whenSyncIsDone(() => {
          expect(console.error).toHaveBeenCalledTimes(1);
          expect(console.error).toHaveBeenCalledWith('error!');
        }).then(done).catch(done.fail);
      });
    });

    it('should run npm update & npm prune', (done) => {
      whenSyncIsDone(() => {
        const expectedOptions = {'cwd': path.join(process.cwd(), target)};
        const count = childProcess.spawn.calls.count();
        expect(count === 2 || count === 4).toBeTruthy();
        expect(childProcess.spawn).toHaveBeenCalledWith('npm', ['update'], expectedOptions);
        expect(childProcess.spawn).toHaveBeenCalledWith('npm', ['prune'], expectedOptions);
      }).then(done).catch(done.fail);
    });

    it('should pipe stdout and stderr', (done) => {
      whenSyncIsDone(() => {
        const countOut = childStub.stdout.pipe.calls.count();
        const countErr = childStub.stderr.pipe.calls.count();
        expect(countOut === 2 || countOut === 4).toBeTruthy();
        expect(countErr === 2 || countErr === 4).toBeTruthy();
        expect(childStub.stdout.pipe).toHaveBeenCalledWith(process.stdout);
        expect(childStub.stderr.pipe).toHaveBeenCalledWith(process.stderr);
      }).then(done).catch(done.fail);
    });

    it('should touch a simple-deploy-done file in the target', (done) => {
      // This is required for other scripts to know it finished the first time
      rimraf(path.join(target, 'simple-deploy-done')).then(() => {
        return whenSyncIsDone(() => {
          return fs.statAsync(path.join(target, 'simple-deploy-done'));
        });
      }).then(done).catch(done.fail);
    });

    describe('is updating modules', () => {
      it('should wait before next update', (done) => {
        /* eslint-disable no-underscore-dangle */
        for (let i = 0; i < 20; i++) {
          simpleDeploy._updateModules();
          process.nextTick(() => {
            simpleDeploy._updateModules();
          });
        }
        /* eslint-enable no-underscore-dangle */
        whenSyncIsDone(() => {
          const count = childProcess.spawn.calls.count();
          expect(count === 2 || count === 4).toBeTruthy();
        }).then(done).catch(done.fail);
      });
    });

    function whenSyncIsDone(verificationMethod) {
      return new Promise((resolve, reject) => {
        const wait = () => {
          if (simpleDeploy.isProcessing()) {
            return setTimeout(wait, 100);
          }
          Promise.resolve().then(verificationMethod).then(resolve).catch(reject);
        };
        wait();
      });
    }

    function verifyFileDoesNotExist(error) {
      expect(error.message).toMatch(/no such file or directory/);
      return Promise.resolve();
    }
  });
});

/* eslint-enable max-len */
