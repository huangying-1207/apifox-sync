const { expect } = require('chai');
const sinon = require('sinon');
const ErrorHandler = require('../src/utils/errorHandler');

describe('Error Handler', () => {
  describe('handleNetworkError', () => {
    it('should handle network errors', () => {
      const consoleErrorStub = sinon.stub(console, 'error');

      const error = new Error('Network error');
      error.response = {
        status: 404,
        data: 'Not found',
        headers: {}
      };

      ErrorHandler.handleNetworkError(error);

      expect(consoleErrorStub.called).to.be.true;
      consoleErrorStub.restore();
    });
  });

  describe('handleFileError', () => {
    it('should handle file errors', () => {
      const consoleErrorStub = sinon.stub(console, 'error');

      const error = new Error('File not found');
      error.code = 'ENOENT';

      ErrorHandler.handleFileError(error, 'test.txt');

      expect(consoleErrorStub.called).to.be.true;
      consoleErrorStub.restore();
    });
  });

  describe('handleScanError', () => {
    it('should handle scan errors', () => {
      const consoleErrorStub = sinon.stub(console, 'error');

      const error = new Error('Scan failed');
      error.code = 'EACCES';

      ErrorHandler.handleScanError(error, '/path/to/code');

      expect(consoleErrorStub.called).to.be.true;
      consoleErrorStub.restore();
    });
  });

  describe('createCustomError', () => {
    it('should create custom errors', () => {
      const error = ErrorHandler.createCustomError(
        'VALIDATION_ERROR',
        'Invalid input',
        { field: 'name' }
      );

      expect(error).to.be.an('error');
      expect(error.message).to.equal('Invalid input');
      expect(error.type).to.equal('VALIDATION_ERROR');
      expect(error.field).to.equal('name');
    });
  });
});
