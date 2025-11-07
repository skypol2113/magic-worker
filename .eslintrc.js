module.exports = {
    env: {
      node: true,
      es2021: true,
      jest: true
    },
    extends: [
      'eslint:recommended',
      'airbnb-base'
    ],
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'no-console': 'off',
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
      'no-await-in-loop': 'off',
      'no-restricted-syntax': 'off',
      'max-len': ['error', { code: 120 }]
    },
    ignorePatterns: ['node_modules/', 'coverage/']
  };