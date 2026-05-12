module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
    mocha: true
  },
  extends: [
    'eslint:recommended',
    'plugin:prettier/recommended'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'prettier/prettier': 'error',
    'no-console': 'off',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-undef': 'error'
  },
  overrides: [
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: [
        'plugin:@typescript-eslint/recommended',
        'plugin:prettier/recommended'
      ],
      rules: {
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off'
      }
    }
  ]
};
