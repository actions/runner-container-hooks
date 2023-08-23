import * as fs from 'fs'
import { containerPorts, POD_VOLUME_NAME } from '../src/k8s'
import * as k8s from '@kubernetes/client-node'
import {
  containerVolumes,
  generateContainerName,
  writeEntryPointScript,
  mergeContainerWithOptions,
  mergePodSpecWithOptions,
  readExtensionFromFile,
  ENV_HOOK_TEMPLATE_PATH
} from '../src/k8s/utils'
import { TestHelper, TableTest } from './test-setup'

let testHelper: TestHelper

describe('k8s utils', () => {
  describe('write entrypoint', () => {
    const cases = [] as TableTest[]

    cases.push({
      name: 'should not throw',
      fn: () => {
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
      }
    })

    cases.push({
      name: 'should throw if RUNNER_TEMP is not set',
      fn: () => {
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
      }
    })

    cases.push({
      name: 'should throw if environment variable name contains double quote',
      fn: () => {
        expect(() =>
          writeEntryPointScript(
            '/test',
            'sh',
            ['-e', 'script.sh'],
            ['/prepend/path'],
            {
              'SOME"_ENV': 'SOME_VALUE'
            }
          )
        ).toThrow()
      }
    })

    cases.push({
      name: 'should throw if environment variable name contains =',
      fn: () => {
        expect(() =>
          writeEntryPointScript(
            '/test',
            'sh',
            ['-e', 'script.sh'],
            ['/prepend/path'],
            {
              'SOME=ENV': 'SOME_VALUE'
            }
          )
        ).toThrow()
      }
    })

    cases.push({
      name: 'should throw if environment variable name contains single quote',
      fn: () => {
        expect(() =>
          writeEntryPointScript(
            '/test',
            'sh',
            ['-e', 'script.sh'],
            ['/prepend/path'],
            {
              "SOME'_ENV": 'SOME_VALUE'
            }
          )
        ).toThrow()
      }
    })

    cases.push({
      name: 'should throw if environment variable name contains dollar',
      fn: () => {
        expect(() =>
          writeEntryPointScript(
            '/test',
            'sh',
            ['-e', 'script.sh'],
            ['/prepend/path'],
            {
              SOME_$_ENV: 'SOME_VALUE'
            }
          )
        ).toThrow()
      }
    })

    cases.push({
      name: 'should escape double quote, dollar and backslash in environment variable values',
      fn: () => {
        const { runnerPath } = writeEntryPointScript(
          '/test',
          'sh',
          ['-e', 'script.sh'],
          ['/prepend/path'],
          {
            DQUOTE: '"',
            BACK_SLASH: '\\',
            DOLLAR: '$'
          }
        )
        expect(fs.existsSync(runnerPath)).toBe(true)
        const script = fs.readFileSync(runnerPath, 'utf8')
        expect(script).toContain('"DQUOTE=\\"')
        expect(script).toContain('"BACK_SLASH=\\\\"')
        expect(script).toContain('"DOLLAR=\\$"')
      }
    })

    cases.push({
      name: 'should return object with containerPath and runnerPath',
      fn: () => {
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
      }
    })

    cases.push({
      name: 'should write entrypoint path and the file should exist',
      fn: () => {
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
      }
    })

    describe('k8s config', () => {
      beforeEach(async () => {
        testHelper = new TestHelper('k8s')
        await testHelper.initialize()
      })

      afterEach(async () => {
        await testHelper.cleanup()
      })

      cases.forEach(e => {
        it(e.name, e.fn)
      })
    })

    describe('docker config', () => {
      beforeEach(async () => {
        testHelper = new TestHelper('docker')
        await testHelper.initialize()
      })

      afterEach(async () => {
        await testHelper.cleanup()
      })

      cases.forEach(e => {
        it(e.name, e.fn)
      })
    })
  })

  describe('container volumes', () => {
    const cases = [] as TableTest[]

    cases.push({
      name: 'should throw if container action and GITHUB_WORKSPACE env is not set',
      fn: () => {
        delete process.env.GITHUB_WORKSPACE
        expect(() => containerVolumes([], true, true)).toThrow()
        expect(() => containerVolumes([], false, true)).toThrow()
      }
    })

    cases.push({
      name: 'should always have work mount',
      fn: () => {
        let volumes = containerVolumes([], true, true)
        expect(volumes.find(e => e.mountPath === '/__w')).toBeTruthy()
        volumes = containerVolumes([], true, false)
        expect(volumes.find(e => e.mountPath === '/__w')).toBeTruthy()
        volumes = containerVolumes([], false, true)
        expect(volumes.find(e => e.mountPath === '/__w')).toBeTruthy()
        volumes = containerVolumes([], false, false)
        expect(volumes.find(e => e.mountPath === '/__w')).toBeTruthy()
      }
    })

    cases.push({
      name: 'should have container action volumes',
      fn: () => {
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
        fileCommands = volumes.find(
          e => e.mountPath === '/github/file_commands'
        )
        expect(workspace).toBeTruthy()
        expect(workspace?.subPath).toBe('repo/repo')
        expect(fileCommands).toBeTruthy()
        expect(fileCommands?.subPath).toBe('_temp/_runner_file_commands')
      }
    })

    cases.push({
      name: 'should have externals, github home and github workflow mounts if job container',
      fn: () => {
        const volumes = containerVolumes()
        expect(volumes.find(e => e.mountPath === '/__e')).toBeTruthy()
        expect(volumes.find(e => e.mountPath === '/github/home')).toBeTruthy()
        expect(
          volumes.find(e => e.mountPath === '/github/workflow')
        ).toBeTruthy()
      }
    })

    cases.push({
      name: 'should throw if user volume source volume path is not in workspace',
      fn: () => {
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
      }
    })

    cases.push({
      name: `all volumes should have name ${POD_VOLUME_NAME}`,
      fn: () => {
        let volumes = containerVolumes([], true, true)
        expect(volumes.every(e => e.name === POD_VOLUME_NAME)).toBeTruthy()
        volumes = containerVolumes([], true, false)
        expect(volumes.every(e => e.name === POD_VOLUME_NAME)).toBeTruthy()
        volumes = containerVolumes([], false, true)
        expect(volumes.every(e => e.name === POD_VOLUME_NAME)).toBeTruthy()
        volumes = containerVolumes([], false, false)
        expect(volumes.every(e => e.name === POD_VOLUME_NAME)).toBeTruthy()
      }
    })

    cases.push({
      name: 'should parse container ports',
      fn: () => {
        const tt = [
          {
            spec: '8080:80',
            want: {
              containerPort: 80,
              hostPort: 8080,
              protocol: 'TCP'
            }
          },
          {
            spec: '8080:80/udp',
            want: {
              containerPort: 80,
              hostPort: 8080,
              protocol: 'UDP'
            }
          },
          {
            spec: '8080/udp',
            want: {
              containerPort: 8080,
              hostPort: undefined,
              protocol: 'UDP'
            }
          },
          {
            spec: '8080',
            want: {
              containerPort: 8080,
              hostPort: undefined,
              protocol: 'TCP'
            }
          }
        ]

        for (const tc of tt) {
          const got = containerPorts({ portMappings: [tc.spec] })
          for (const [key, value] of Object.entries(tc.want)) {
            expect(got[0][key]).toBe(value)
          }
        }
      }
    })

    cases.push({
      name: 'should throw when ports are out of range (0, 65536)',
      fn: () => {
        expect(() => containerPorts({ portMappings: ['65536'] })).toThrow()
        expect(() => containerPorts({ portMappings: ['0'] })).toThrow()
        expect(() => containerPorts({ portMappings: ['65536/udp'] })).toThrow()
        expect(() => containerPorts({ portMappings: ['0/udp'] })).toThrow()
        expect(() => containerPorts({ portMappings: ['1:65536'] })).toThrow()
        expect(() => containerPorts({ portMappings: ['65536:1'] })).toThrow()
        expect(() =>
          containerPorts({ portMappings: ['1:65536/tcp'] })
        ).toThrow()
        expect(() =>
          containerPorts({ portMappings: ['65536:1/tcp'] })
        ).toThrow()
        expect(() => containerPorts({ portMappings: ['1:'] })).toThrow()
        expect(() => containerPorts({ portMappings: [':1'] })).toThrow()
        expect(() => containerPorts({ portMappings: ['1:/tcp'] })).toThrow()
        expect(() => containerPorts({ portMappings: [':1/tcp'] })).toThrow()
      }
    })

    cases.push({
      name: 'should throw on multi ":" splits',
      fn: () => {
        expect(() => containerPorts({ portMappings: ['1:1:1'] })).toThrow()
      }
    })

    cases.push({
      name: 'should throw on multi "/" splits',
      fn: () => {
        expect(() =>
          containerPorts({ portMappings: ['1:1/tcp/udp'] })
        ).toThrow()
        expect(() => containerPorts({ portMappings: ['1/tcp/udp'] })).toThrow()
      }
    })

    describe('k8s config', () => {
      beforeEach(async () => {
        testHelper = new TestHelper('k8s')
        await testHelper.initialize()
      })

      afterEach(async () => {
        await testHelper.cleanup()
      })

      cases.forEach(e => {
        it(e.name, e.fn)
      })
    })

    describe('docker config', () => {
      beforeEach(async () => {
        testHelper = new TestHelper('docker')
        await testHelper.initialize()
      })

      afterEach(async () => {
        await testHelper.cleanup()
      })

      cases.forEach(e => {
        it(e.name, e.fn)
      })
    })
  })

  describe('generate container name', () => {
    it('should return the container name from image string', () => {
      expect(
        generateContainerName('public.ecr.aws/localstack/localstack')
      ).toEqual('localstack')
      expect(
        generateContainerName(
          'public.ecr.aws/url/with/multiple/slashes/postgres:latest'
        )
      ).toEqual('postgres')
      expect(generateContainerName('postgres')).toEqual('postgres')
      expect(generateContainerName('postgres:latest')).toEqual('postgres')
      expect(generateContainerName('localstack/localstack')).toEqual(
        'localstack'
      )
      expect(generateContainerName('localstack/localstack:latest')).toEqual(
        'localstack'
      )
    })

    it('should throw on invalid image string', () => {
      expect(() =>
        generateContainerName('localstack/localstack/:latest')
      ).toThrow()
      expect(() => generateContainerName(':latest')).toThrow()
    })
  })

  describe('merge specs', () => {
    describe('read extension', () => {
      beforeEach(async () => {
        testHelper = new TestHelper('k8s')
        await testHelper.initialize()
      })

      afterEach(async () => {
        await testHelper.cleanup()
      })

      it('should throw if env variable is set but file does not exist', () => {
        process.env[ENV_HOOK_TEMPLATE_PATH] =
          '/path/that/does/not/exist/data.yaml'
        expect(() => readExtensionFromFile()).toThrow()
      })

      it('should return undefined if env variable is not set', () => {
        delete process.env[ENV_HOOK_TEMPLATE_PATH]
        expect(readExtensionFromFile()).toBeUndefined()
      })

      it('should throw if file is empty', () => {
        let filePath = testHelper.createFile('data.yaml')
        process.env[ENV_HOOK_TEMPLATE_PATH] = filePath
        expect(() => readExtensionFromFile()).toThrow()
      })

      it('should throw if file is not valid yaml', () => {
        let filePath = testHelper.createFile('data.yaml')
        fs.writeFileSync(filePath, 'invalid yaml')
        process.env[ENV_HOOK_TEMPLATE_PATH] = filePath
        expect(() => readExtensionFromFile()).toThrow()
      })

      it('should return object if file is valid', () => {
        let filePath = testHelper.createFile('data.yaml')
        fs.writeFileSync(
          filePath,
          `
apiVersion: v1
metadata:
  labels:
    label-name: label-value
  annotations:
    annotation-name: annotation-value
spec:
  containers:
    - name: test
      image: node:14.16
    - name: job
      image: ubuntu:latest`
        )

        process.env[ENV_HOOK_TEMPLATE_PATH] = filePath
        const extension = readExtensionFromFile()
        expect(extension).toBeDefined()
      })
    })

    it('should merge container spec', () => {
      const base = {
        image: 'node:14.16',
        name: 'test',
        env: [
          {
            name: 'TEST',
            value: 'TEST'
          }
        ],
        ports: [
          {
            containerPort: 8080,
            hostPort: 8080,
            protocol: 'TCP'
          }
        ]
      } as k8s.V1Container

      const from = {
        ports: [
          {
            containerPort: 9090,
            hostPort: 9090,
            protocol: 'TCP'
          }
        ],
        env: [
          {
            name: 'TEST_TWO',
            value: 'TEST_TWO'
          }
        ],
        image: 'ubuntu:latest',
        name: 'overwrite'
      } as k8s.V1Container

      const expectContainer = {
        name: base.name,
        image: from.image,
        ports: [
          ...(base.ports as k8s.V1ContainerPort[]),
          ...(from.ports as k8s.V1ContainerPort[])
        ],
        env: [...(base.env as k8s.V1EnvVar[]), ...(from.env as k8s.V1EnvVar[])]
      }

      const expectJobContainer = JSON.parse(JSON.stringify(expectContainer))
      expectJobContainer.name = base.name
      mergeContainerWithOptions(base, from)
      expect(base).toStrictEqual(expectContainer)
    })

    it('should merge pod spec', () => {
      const base = {
        containers: [
          {
            image: 'node:14.16',
            name: 'test',
            env: [
              {
                name: 'TEST',
                value: 'TEST'
              }
            ],
            ports: [
              {
                containerPort: 8080,
                hostPort: 8080,
                protocol: 'TCP'
              }
            ]
          }
        ],
        restartPolicy: 'Never'
      } as k8s.V1PodSpec

      const from = {
        securityContext: {
          runAsUser: 1000,
          fsGroup: 2000
        },
        restartPolicy: 'Always',
        volumes: [
          {
            name: 'work',
            emptyDir: {}
          }
        ],
        containers: [
          {
            image: 'ignore:14.16',
            name: 'ignore',
            env: [
              {
                name: 'TEST',
                value: 'TEST'
              }
            ],
            ports: [
              {
                containerPort: 8080,
                hostPort: 8080,
                protocol: 'TCP'
              }
            ]
          }
        ],
        container: {} // field does not exist on v1PodSpec but will be passed by the runner
      } as k8s.V1PodSpec

      const expected = JSON.parse(JSON.stringify(base))
      expected.securityContext = from.securityContext
      expected.restartPolicy = from.restartPolicy
      expected.volumes = from.volumes

      mergePodSpecWithOptions(base, from)

      expect(base).toStrictEqual(expected)
    })
  })
})
