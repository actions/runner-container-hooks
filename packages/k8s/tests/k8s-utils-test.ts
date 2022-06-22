import * as fs from 'fs'
import { writeEntryPointScript } from '../src/k8s/utils'
import { TestHelper } from './test-setup'

let testHelper: TestHelper

describe('k8s utils', () => {
  describe('write entrypoint', () => {
    beforeEach(async () => {
      testHelper = new TestHelper()
      await testHelper.initialize()
    })
    it('should not throw', () => {
      expect(() =>
        writeEntryPointScript(
          '/test',
          'sh',
          ['-e', 'script.sh'],
          ['/prepend/path'],
          {
            SOME_ENV: 'SOME_VALUE'
          }
        )
      ).not.toThrow()
    })

    it('should throw if RUNNER_TEMP is not set', () => {
      delete process.env.RUNNER_TEMP
      expect(() =>
        writeEntryPointScript(
          '/test',
          'sh',
          ['-e', 'script.sh'],
          ['/prepend/path'],
          {
            SOME_ENV: 'SOME_VALUE'
          }
        )
      ).toThrow()
    })

    it('should return object with containerPath and runnerPath', () => {
      const { containerPath, runnerPath } = writeEntryPointScript(
        '/test',
        'sh',
        ['-e', 'script.sh'],
        ['/prepend/path'],
        {
          SOME_ENV: 'SOME_VALUE'
        }
      )
      expect(containerPath).toMatch(/\/__w\/_temp\/.*\.sh/)
      const re = new RegExp(`${process.env.RUNNER_TEMP}/.*\.sh`)
      expect(runnerPath).toMatch(re)
    })

    it('should write entrypoint path and the file should exist', () => {
      const { runnerPath } = writeEntryPointScript(
        '/test',
        'sh',
        ['-e', 'script.sh'],
        ['/prepend/path'],
        {
          SOME_ENV: 'SOME_VALUE'
        }
      )
      expect(fs.existsSync(runnerPath)).toBe(true)
    })
  })
})
