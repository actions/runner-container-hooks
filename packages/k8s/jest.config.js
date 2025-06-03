// eslint-disable-next-line import/no-commonjs
module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx', 'jsx', 'node'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*-test.ts'],
  testRunner: 'jest-circus/runner',
  transformIgnorePatterns: ['/node_modules/(?!(@kubernetes/client-node|openid-client|oauth4webapi|jose)/)', '/hooklib/lib/'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  setupFilesAfterEnv: ['./jest.setup.js'],
  verbose: true
}
