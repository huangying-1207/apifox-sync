const { expect } = require('chai');
const {
  containsChinese,
  convertToCamelCase,
  getDefaultSummary,
  getDefaultParamDescription,
  getDefaultPropDescription,
  getDefaultResponseDescription
} = require('../dist/utils/helper');

describe('Helper Functions', () => {
  describe('containsChinese', () => {
    it('should detect Chinese characters in strings', () => {
      expect(containsChinese('中文')).to.be.true;
      expect(containsChinese('Chinese')).to.be.false;
      expect(containsChinese('中英文mixed')).to.be.true;
    });

    it('should handle empty string', () => {
      expect(containsChinese('')).to.be.false;
    });
  });

  describe('convertToCamelCase', () => {
    it('should convert dash-separated names to camelCase', () => {
      expect(convertToCamelCase('user-name')).to.equal('UserName');
    });

    it('should convert underscore-separated names to camelCase', () => {
      expect(convertToCamelCase('user_name')).to.equal('UserName');
    });

    it('should handle single word', () => {
      expect(convertToCamelCase('user')).to.equal('User');
    });
  });

  describe('getDefaultSummary', () => {
    it('should generate default summary for GET method', () => {
      expect(getDefaultSummary('/users', 'get')).to.include('查询');
    });

    it('should generate default summary for POST method', () => {
      expect(getDefaultSummary('/users', 'post')).to.include('新增');
    });

    it('should generate default summary for PUT method', () => {
      expect(getDefaultSummary('/users', 'put')).to.include('更新');
    });

    it('should generate default summary for DELETE method', () => {
      expect(getDefaultSummary('/users', 'delete')).to.include('删除');
    });
  });

  describe('getDefaultParamDescription', () => {
    it('should generate parameter description', () => {
      expect(getDefaultParamDescription('user_id')).to.equal('UserId参数');
    });
  });

  describe('getDefaultPropDescription', () => {
    it('should generate property description', () => {
      expect(getDefaultPropDescription('user_name')).to.equal('UserName字段');
    });
  });

  describe('getDefaultResponseDescription', () => {
    it('should return success description for 200 status', () => {
      expect(getDefaultResponseDescription('200')).to.equal('成功');
    });

    it('should return created description for 201 status', () => {
      expect(getDefaultResponseDescription('201')).to.equal('创建成功');
    });

    it('should return error description for 400 status', () => {
      expect(getDefaultResponseDescription('400')).to.equal('请求参数错误');
    });

    it('should return not found description for 404 status', () => {
      expect(getDefaultResponseDescription('404')).to.equal('资源不存在');
    });
  });
});
