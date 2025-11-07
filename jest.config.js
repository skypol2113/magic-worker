module.exports = {
    testEnvironment: 'node',
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
      '**/*.js',
      '!node_modules/**',
      '!coverage/**',
      '!**/*.test.js'
    ],
    testMatch: [
      '**/__tests__/**/*.js',
      '**/*.test.js'
    ]
  };