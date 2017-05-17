const index = require('./index');
const SimpleDeploy = require('./lib/simple-deploy');

describe('module', () => {
  it('should expose the SimpleDeploy class', () => {
    expect(index.SimpleDeploy).toEqual(SimpleDeploy);
  });
});
