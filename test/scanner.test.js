const { expect } = require('chai');
const sinon = require('sinon');
const ApiScanner = require('../dist/core/scanner/ApiScanner').default;

describe('API Scanner', () => {
  describe('Spring Boot Code Scanner', () => {
    it('should scan Spring Boot code for APIs', async () => {
      const scanner = new ApiScanner();
      const scanStub = sinon.stub(scanner, 'scanCodeByFramework').resolves([]);

      await scanner.scanCodeForChanges('./testdata/springboot', 'springboot');

      expect(scanStub.calledOnce).to.be.true;
      scanStub.restore();
    });
  });

  describe('Node.js Code Scanner', () => {
    it('should scan Node.js code for APIs', async () => {
      const scanner = new ApiScanner();
      const scanStub = sinon.stub(scanner, 'scanCodeByFramework').resolves([]);

      await scanner.scanCodeForChanges('./testdata/nodejs', 'nodejs');

      expect(scanStub.calledOnce).to.be.true;
      scanStub.restore();
    });
  });

  describe('Django Code Scanner', () => {
    it('should scan Django code for APIs', async () => {
      const scanner = new ApiScanner();
      const scanStub = sinon.stub(scanner, 'scanCodeByFramework').resolves([]);

      await scanner.scanCodeForChanges('./testdata/django', 'django');

      expect(scanStub.calledOnce).to.be.true;
      scanStub.restore();
    });
  });

  describe('Unsupported Framework', () => {
    it('should throw error for unsupported framework', async () => {
      const scanner = new ApiScanner();
      try {
        await scanner.scanCodeForChanges('./testdata', 'unsupported');
        expect.fail('Should throw an error');
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });
});
