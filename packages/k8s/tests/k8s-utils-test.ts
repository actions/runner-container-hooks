import * as fs from 'fs'
import { containerPorts } from '../src/k8s'
import {
  containerVolumes,
  ensureRequiredNodeAffinity,
  fixArgs,
  workspaceRelativePath,
  generateContainerName,
  mergePodSpecWithOptions,
  mergeContainerWithOptions,
  readExtensionFromFile,
  ENV_HOOK_TEMPLATE_PATH
} from '../src/k8s/utils'
import * as k8s from '@kubernetes/client-node'
import { TestHelper } from './test-setup'

let testHelper: TestHelper

describe('k8s utils', () => {
  describe('container volumes', () => {
    beforeEach(async () => {
      testHelper = new TestHelper()
      await testHelper.initialize()
    })

    afterEach(async () => {
      await testHelper.cleanup()
    })

    it('should parse container ports', () => {
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
    })

    it('should throw when ports are out of range (0, 65536)', () => {
      expect(() => containerPorts({ portMappings: ['65536'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['0'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['65536/udp'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['0/udp'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['1:65536'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['65536:1'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['1:65536/tcp'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['65536:1/tcp'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['1:'] })).toThrow()
      expect(() => containerPorts({ portMappings: [':1'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['1:/tcp'] })).toThrow()
      expect(() => containerPorts({ portMappings: [':1/tcp'] })).toThrow()
    })

    it('should throw on multi ":" splits', () => {
      expect(() => containerPorts({ portMappings: ['1:1:1'] })).toThrow()
    })

    it('should throw on multi "/" splits', () => {
      expect(() => containerPorts({ portMappings: ['1:1/tcp/udp'] })).toThrow()
      expect(() => containerPorts({ portMappings: ['1/tcp/udp'] })).toThrow()
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

  describe('read extension', () => {
    beforeEach(async () => {
      testHelper = new TestHelper()
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
metadata:
  labels:
    label-name: label-value
  annotations:
    annotation-name: annotation-value
spec:
  containers:
    - name: test
      image: node:22
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
      image: 'node:22',
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
      image: base.image,
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
          image: 'node:22',
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
          image: 'ubuntu:latest',
          name: 'side-car',
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
      ]
    } as k8s.V1PodSpec

    const expected = JSON.parse(JSON.stringify(base))
    expected.securityContext = from.securityContext
    expected.restartPolicy = from.restartPolicy
    expected.volumes = from.volumes
    expected.containers.push(from.containers[0])

    mergePodSpecWithOptions(base, from)

    expect(base).toStrictEqual(expected)
  })
})

describe('container volumes path containment', () => {
  const workspacePath = '/home/runner/_work/repo/repo'
  let originalWorkspace: string | undefined
  let originalRunnerWorkspace: string | undefined

  beforeEach(() => {
    originalWorkspace = process.env.GITHUB_WORKSPACE
    originalRunnerWorkspace = process.env.RUNNER_WORKSPACE
    process.env.GITHUB_WORKSPACE = workspacePath
    process.env.RUNNER_WORKSPACE = '/home/runner/_work/repo'
  })

  afterEach(() => {
    if (originalWorkspace === undefined) {
      delete process.env.GITHUB_WORKSPACE
    } else {
      process.env.GITHUB_WORKSPACE = originalWorkspace
    }
    if (originalRunnerWorkspace === undefined) {
      delete process.env.RUNNER_WORKSPACE
    } else {
      process.env.RUNNER_WORKSPACE = originalRunnerWorkspace
    }
  })

  const subPathOf = (sourceVolumePath: string): string | undefined => {
    const mounts = containerVolumes([
      { sourceVolumePath, targetVolumePath: '/mnt/target', readOnly: false }
    ])
    return mounts[mounts.length - 1].subPath
  }

  it('should map the workspace root onto the work volume', () => {
    expect(subPathOf(workspacePath)).toBe('repo/repo')
  })

  it('should map a directory inside the workspace', () => {
    expect(subPathOf(`${workspacePath}/src`)).toBe('repo/repo/src')
  })

  it('should reject paths outside the work folder', () => {
    expect(() => subPathOf('/etc/passwd')).toThrow(
      'Volume mounts outside of the work folder are not supported'
    )
  })

  it('should reject parent directory traversal out of the workspace', () => {
    expect(() => subPathOf(`${workspacePath}/../../../../etc`)).toThrow(
      'Volume mounts outside of the work folder are not supported'
    )
  })

  it('should reject sibling directories that share the workspace prefix', () => {
    // `startsWith` would accept these and silently mount the wrong directory:
    // repo-evil/secrets previously mapped to subPath repo/repo/evil/secrets
    expect(() => subPathOf(`${workspacePath}-evil/secrets`)).toThrow(
      'Volume mounts outside of the work folder are not supported'
    )
    expect(() => subPathOf(`${workspacePath}XYZ`)).toThrow(
      'Volume mounts outside of the work folder are not supported'
    )
  })

  it('should allow a directory whose name begins with dots', () => {
    expect(subPathOf(`${workspacePath}/..foo`)).toBe('repo/repo/..foo')
  })

  it('should keep relative source paths untouched', () => {
    expect(subPathOf('some/relative/path')).toBe('some/relative/path')
  })
})

describe('work directory resolution', () => {
  // a repository named so that its name contains the work directory name:
  // lastIndexOf('_work/') lands inside the repository name and resolves the
  // checkout's parent instead of the checkout itself
  const workspacePath = '/home/runner/_work/my_work/my_work'
  let originalWorkspace: string | undefined
  let originalRunnerWorkspace: string | undefined

  beforeEach(() => {
    originalWorkspace = process.env.GITHUB_WORKSPACE
    originalRunnerWorkspace = process.env.RUNNER_WORKSPACE
    process.env.GITHUB_WORKSPACE = workspacePath
    process.env.RUNNER_WORKSPACE = '/home/runner/_work/my_work'
  })

  afterEach(() => {
    if (originalWorkspace === undefined) {
      delete process.env.GITHUB_WORKSPACE
    } else {
      process.env.GITHUB_WORKSPACE = originalWorkspace
    }
    if (originalRunnerWorkspace === undefined) {
      delete process.env.RUNNER_WORKSPACE
    } else {
      process.env.RUNNER_WORKSPACE = originalRunnerWorkspace
    }
  })

  it('should resolve the workspace relative to the work root', () => {
    expect(workspaceRelativePath(workspacePath)).toBe('my_work/my_work')
  })

  it('should mount the checkout for a container action', () => {
    const mounts = containerVolumes([], true, true)
    const workspaceMount = mounts.find(m => m.mountPath === '/github/workspace')
    expect(workspaceMount?.subPath).toBe('my_work/my_work')
  })

  it('should map a user mount inside a repository named like the work dir', () => {
    const mounts = containerVolumes([
      {
        sourceVolumePath: `${workspacePath}/src`,
        targetVolumePath: '/mnt/target',
        readOnly: false
      }
    ])
    expect(mounts[mounts.length - 1].subPath).toBe('my_work/my_work/src')
  })
})

describe('fixArgs', () => {
  it('should keep a sh -c script in a single argument', () => {
    expect(fixArgs(['sh', '-c', 'echo hello world'])).toEqual([
      'sh',
      '-c',
      'echo hello world'
    ])
  })

  it('should preserve positional parameters after a sh -c script', () => {
    // everything after the script is $0 and the positional parameters;
    // folding them into the script makes `printf "%s" "$1"` print
    // `labelpayload` rather than `payload`
    expect(
      fixArgs(['sh', '-c', 'printf "%s" "$1"', 'label', 'payload'])
    ).toEqual(['sh', '-c', 'printf "%s" "$1"', 'label', 'payload'])
  })

  it('should tokenize anything that is not a sh -c invocation', () => {
    expect(fixArgs(['echo', 'hello world'])).toEqual(['echo', 'hello', 'world'])
  })
})

describe('ensureRequiredNodeAffinity', () => {
  const nodeName = 'runner-node-1'
  const hostnameKey = 'kubernetes.io/hostname'
  const nodeField = { key: 'metadata.name', operator: 'In', values: [nodeName] }

  const requiredTerms = (
    spec: k8s.V1PodSpec
  ): k8s.V1NodeSelectorTerm[] | undefined =>
    spec.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
      ?.nodeSelectorTerms

  it('should add a required node term to an empty spec', () => {
    const spec = {} as k8s.V1PodSpec
    ensureRequiredNodeAffinity(spec, nodeName)

    const terms = requiredTerms(spec)
    expect(terms).toHaveLength(1)
    expect(terms?.[0].matchFields).toEqual([nodeField])
  })

  it('should select the node by name rather than by hostname label', () => {
    // the kubernetes.io/hostname label is seeded from the machine hostname
    // and is not guaranteed to equal the node name, so matching on it can
    // leave the pod Pending forever
    const spec = {} as k8s.V1PodSpec
    ensureRequiredNodeAffinity(spec, nodeName)

    const term = requiredTerms(spec)?.[0]
    expect(term?.matchFields).toEqual([nodeField])
    expect(term?.matchExpressions).toBeUndefined()
  })

  it('should re-assert the node term when an extension replaced affinity', () => {
    // mergePodSpecWithOptions assigns spec.affinity wholesale, so this is the
    // state the hook sees after a pod template sets its own affinity
    const spec = {
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  { key: 'disktype', operator: 'In', values: ['ssd'] }
                ]
              }
            ]
          }
        }
      }
    } as k8s.V1PodSpec

    ensureRequiredNodeAffinity(spec, nodeName)

    const terms = requiredTerms(spec)
    expect(terms).toHaveLength(1)
    expect(terms?.[0].matchFields).toEqual([nodeField])
    expect(terms?.[0].matchExpressions).toEqual([
      { key: 'disktype', operator: 'In', values: ['ssd'] }
    ])
  })

  it('should constrain every term because terms are OR-ed', () => {
    const spec = {
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  { key: 'disktype', operator: 'In', values: ['ssd'] }
                ]
              },
              {
                matchExpressions: [
                  { key: 'zone', operator: 'In', values: ['us-east-1a'] }
                ]
              }
            ]
          }
        }
      }
    } as k8s.V1PodSpec

    ensureRequiredNodeAffinity(spec, nodeName)

    const terms = requiredTerms(spec)
    expect(terms).toHaveLength(2)
    for (const term of terms ?? []) {
      expect(term.matchFields).toContainEqual(nodeField)
    }
  })

  it('should override a conflicting node name requirement', () => {
    const spec = {
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchFields: [
                  {
                    key: 'metadata.name',
                    operator: 'In',
                    values: ['other-node']
                  }
                ]
              }
            ]
          }
        }
      }
    } as k8s.V1PodSpec

    ensureRequiredNodeAffinity(spec, nodeName)

    expect(requiredTerms(spec)?.[0].matchFields).toEqual([nodeField])
  })

  it('should drop a conflicting hostname expression set by an extension', () => {
    // a hostname expression would be AND-ed with the node requirement and
    // could make the pod unschedulable
    const spec = {
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  { key: hostnameKey, operator: 'In', values: ['other-node'] }
                ]
              }
            ]
          }
        }
      }
    } as k8s.V1PodSpec

    ensureRequiredNodeAffinity(spec, nodeName)

    const term = requiredTerms(spec)?.[0]
    expect(term?.matchFields).toEqual([nodeField])
    expect(term?.matchExpressions).toBeUndefined()
  })

  it('should preserve unrelated affinity settings', () => {
    const spec = {
      affinity: {
        podAntiAffinity: {
          preferredDuringSchedulingIgnoredDuringExecution: [
            { weight: 50, podAffinityTerm: { topologyKey: hostnameKey } }
          ]
        }
      }
    } as k8s.V1PodSpec

    ensureRequiredNodeAffinity(spec, nodeName)

    expect(spec.affinity?.podAntiAffinity).toBeDefined()
    expect(requiredTerms(spec)).toHaveLength(1)
  })
})
