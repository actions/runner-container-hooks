import * as fs from 'fs'
import { POD_VOLUME_NAME } from '../src/k8s'
import { containerVolumes, writeEntryPointScript } from '../src/k8s/utils'
import { TestHelper } from './test-setup'

let testHelper: TestHelper

describe('k8s utils', () => {
  describe('write entrypoint', () => {
    beforeEach(async () => {
      testHelper = new TestHelper()
      await testHelper.initialize()
    })

    afterEach(async () => {
      await testHelper.cleanup()
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
      const re = new RegExp(`${process.env.RUNNER_TEMP}/.*\\.sh`)
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

  describe('container volumes', () => {
    beforeEach(async () => {
      testHelper = new TestHelper()
      await testHelper.initialize()
    })

    afterEach(async () => {
      await testHelper.cleanup()
    })

    it('should throw if container action and GITHUB_WORKSPACE env is not set', () => {
      delete process.env.GITHUB_WORKSPACE
      expect(() => containerVolumes([], true, true)).toThrow()
      expect(() => containerVolumes([], false, true)).toThrow()
    })

    it('should always have work mount', () => {
      let volumes = containerVolumes([], true, true)
      expect(volumes.find(e => e.mountPath === '/__w')).toBeTruthy()
      volumes = containerVolumes([], true, false)
      expect(volumes.find(e => e.mountPath === '/__w')).toBeTruthy()
      volumes = containerVolumes([], false, true)
      expect(volumes.find(e => e.mountPath === '/__w')).toBeTruthy()
      volumes = containerVolumes([], false, false)
      expect(volumes.find(e => e.mountPath === '/__w')).toBeTruthy()
    })

    it('should have container action volumes', () => {
      let volumes = containerVolumes([], true, true)
      let workspace = volumes.find(e => e.mountPath === '/github/workspace')
      let fileCommands = volumes.find(
        e => e.mountPath === '/github/file_commands'
      )
      expect(workspace).toBeTruthy()
      expect(workspace?.subPath).toBe('repo/repo')
      expect(fileCommands).toBeTruthy()
      expect(fileCommands?.subPath).toBe('_temp/_runner_file_commands')

      volumes = containerVolumes([], false, true)
      workspace = volumes.find(e => e.mountPath === '/github/workspace')
      fileCommands = volumes.find(e => e.mountPath === '/github/file_commands')
      expect(workspace).toBeTruthy()
      expect(workspace?.subPath).toBe('repo/repo')
      expect(fileCommands).toBeTruthy()
      expect(fileCommands?.subPath).toBe('_temp/_runner_file_commands')
    })

    it('should have externals, github home and github workflow mounts if job container', () => {
      const volumes = containerVolumes()
      expect(volumes.find(e => e.mountPath === '/__e')).toBeTruthy()
      expect(volumes.find(e => e.mountPath === '/github/home')).toBeTruthy()
      expect(volumes.find(e => e.mountPath === '/github/workflow')).toBeTruthy()
    })

    it('should throw if user volume source volume path is not in workspace', () => {
      expect(() =>
        containerVolumes(
          [
            {
              sourceVolumePath: '/outside/of/workdir'
            }
          ],
          true,
          false
        )
      ).toThrow()
    })

    it(`all volumes should have name ${POD_VOLUME_NAME}`, () => {
      let volumes = containerVolumes([], true, true)
      expect(volumes.every(e => e.name === POD_VOLUME_NAME)).toBeTruthy()
      volumes = containerVolumes([], true, false)
      expect(volumes.every(e => e.name === POD_VOLUME_NAME)).toBeTruthy()
      volumes = containerVolumes([], false, true)
      expect(volumes.every(e => e.name === POD_VOLUME_NAME)).toBeTruthy()
      volumes = containerVolumes([], false, false)
      expect(volumes.every(e => e.name === POD_VOLUME_NAME)).toBeTruthy()
    })
  })
})
