module.exports = {
  clearMocks: true,
  preset: 'ts-jest',
  moduleFileExtensions: ['js', 'ts'],
  testEnvironment: 'node',
  testMatch: ['**/*-test.ts'],
  testRunner: 'jest-circus/runner',
  verbose: true,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json'
      }
    ],
    // Transform ESM modules to CommonJS
    '^.+\\.(js|mjs)$': ['babel-jest', {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]]
    }]
  },
  transformIgnorePatterns: [
    // Transform these ESM packages
    'node_modules/(?!(shlex|@kubernetes/client-node|openid-client|oauth4webapi|jose|uuid)/)'
  ],
  setupFilesAfterEnv: ['./jest.setup.js']
}
