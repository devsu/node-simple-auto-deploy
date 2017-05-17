const Promise = require('bluebird');
const path = require('path');
const Spy = require('jasmine-spy');
const SimpleDeploy = require('./simple-deploy');
const fs = Promise.promisifyAll(require('fs'));
const rimraf = Promise.promisify(require('rimraf'));
const touch = Promise.promisify(require('touch'));

/* eslint-disable max-len */

describe('SimpleDeploy', () => {
  let simpleDeploy, source, target, sourceFile1, sourceFile2, targetFile1, targetFile2,
    sourceFolder, targetFolder, sourceFileInFolder, targetFileInFolder, sourceModulesFolder,
    targetModulesFolder, sourceGitFolder, targetGitFolder;

  beforeEach(() => {
    source = './foo';
    target = './bar';
    sourceFile1 = path.join(source, 'file.txt');
    targetFile1 = path.join(target, 'file.txt');
    sourceFile2 = path.join(source, 'file2.txt');
    targetFile2 = path.join(target, 'file2.txt');
    sourceFolder = path.join(source, 'my-folder');
    targetFolder = path.join(target, 'my-folder');
    sourceFileInFolder = path.join(sourceFolder, 'anotherfile.txt');
    targetFileInFolder = path.join(targetFolder, 'anotherfile.txt');
    sourceModulesFolder = path.join(source, 'node_modules');
    targetModulesFolder = path.join(target, 'node_modules');
    sourceGitFolder = path.join(source, '.git');
    targetGitFolder = path.join(target, '.git');
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
      simpleDeploy.exec = jasmine.createSpy().and.callFake((path, opt, callback) => {
        callback();
      });
      Promise.resolve().then(() => {
        return Promise.all([
          fs.mkdirAsync(source),
          fs.mkdirAsync(target),
        ]);
      }).then(() => {
        return Promise.all([
          fs.mkdirAsync(sourceFolder),
          fs.mkdirAsync(sourceModulesFolder),
          fs.mkdirAsync(sourceGitFolder),
        ]);
      }).then(() => {
        return Promise.all([
          touch(sourceFile1),
          touch(sourceFileInFolder),
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
          fs.statAsync(targetFile1),
          fs.statAsync(targetFolder),
          fs.statAsync(targetFileInFolder),
        ]);
      }).then(done).catch(done.fail);
    });

    it('should not sync node_modules', (done) => {
      whenSyncIsDone(() => {
        return fs.statAsync(targetModulesFolder);
      }).then(done.fail).catch(verifyFileDoesNotExist).then(done);
    });

    it('should not sync .git', (done) => {
      whenSyncIsDone(() => {
        return fs.statAsync(targetGitFolder);
      }).then(done.fail).catch(verifyFileDoesNotExist).then(done);
    });

    it('should run npm update && npm prune', (done) => {
      whenSyncIsDone(() => {
        const expectedOptions = {'cwd': path.join(process.cwd(), target), 'maxBuffer': 1024 * 1024};
        expect(simpleDeploy.exec.calls.count() <= 2).toBeTruthy();
        expect(simpleDeploy.exec).toHaveBeenCalledWith('npm update && npm prune', expectedOptions, jasmine.any(Function));
      }).then(done).catch(done.fail);
    });

    describe('when a file is added', () => {
      beforeEach((done) => {
        touch(sourceFile2, done);
      });

      it('should sync the folder', (done) => {
        whenSyncIsDone(() => {
          return fs.statAsync(targetFile2);
        }).then(done).catch(done.fail);
      });
    });

    describe('when a file/folder is removed', () => {
      beforeEach((done) => {
        rimraf(sourceFolder).then(done).catch(done.fail);
      });

      it('should delete the removed file/folder', (done) => {
        whenSyncIsDone(() => {
          return fs.statAsync(targetFolder);
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

    describe('exec npm update', () => {
      let originalLog, originalError;

      beforeEach(() => {
        originalLog = console.log;
        originalError = console.error;
        console.log = Spy.create();
        console.error = Spy.create();
      });

      afterEach(() => {
        console.log = originalLog;
        console.error = originalError;
      });

      describe('returns stdout', () => {
        it('should log stdout', (done) => {
          simpleDeploy.exec = jasmine.createSpy().and.callFake((path, opt, callback) => {
            callback(null, 'whatever');
          });
          whenSyncIsDone(() => {
            expect(console.log).toHaveBeenCalledWith('whatever');
          }).then(done).catch(done.fail);
        });
      });

      describe('returns stderr', () => {
        it('should log stderr', (done) => {
          simpleDeploy.exec = jasmine.createSpy().and.callFake((path, opt, callback) => {
            callback(null, null, 'something happened!');
          });
          whenSyncIsDone(() => {
            expect(console.error).toHaveBeenCalledWith('something happened!');
          }).then(done).catch(done.fail);
        });
      });

      describe('returns error', () => {
        it('should log error', (done) => {
          simpleDeploy.exec = jasmine.createSpy().and.callFake((path, opt, callback) => {
            callback(new Error('whatever'));
          });
          whenSyncIsDone(() => {
            expect(console.error).toHaveBeenCalledWith(new Error('whatever'));
          }).then(done).catch(done.fail);
        });
      });
    });

    describe('is updating modules', () => {
      it('should wait before next update', (done) => {
        /* eslint-disable no-underscore-dangle */
        simpleDeploy._updateModules();
        simpleDeploy._updateModules();
        simpleDeploy._updateModules();
        simpleDeploy._updateModules();
        process.nextTick(() => {
          simpleDeploy._updateModules();
          simpleDeploy._updateModules();
          simpleDeploy._updateModules();
          simpleDeploy._updateModules();
        });
        /* eslint-enable no-underscore-dangle */
        whenSyncIsDone(() => {
          expect(simpleDeploy.exec.calls.count() <= 2).toBeTruthy();
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
