import * as fs from 'fs'
import {
  cleanupJob,
  prepareJob,
  runContainerStep,
  runScriptStep
} from '../src/hooks'
import { TestHelper } from './test-setup'
import * as k8s from '@kubernetes/client-node'
import { generateCerts } from '../src/k8s/certs'
import { ChildProcess, exec, execSync } from 'child_process'
import { runScriptByGrpc } from '../src/k8s/utils'
import { MTLSCertAndPrivateKey } from '../src/k8s/certs'
import process from 'process'
import { cpToPod, execPodStep } from '../src/k8s'
import path from 'path'

const kc = new k8s.KubeConfig()
kc.loadFromDefault()

const forward = new k8s.PortForward(kc)

jest.useRealTimers()

let testHelper: TestHelper

let prepareJobData: any

let prepareJobOutputFilePath: string
describe('e2e', () => {
  beforeEach(async () => {
    testHelper = new TestHelper()
    await testHelper.initialize()

    prepareJobData = testHelper.getPrepareJobDefinition()
    prepareJobOutputFilePath = testHelper.createFile('prepare-job-output.json')
  })
  afterEach(async () => {
    await testHelper.cleanup()
  })
  it('should prepare job, run script step, run container step then cleanup without errors', async () => {
    await expect(
      prepareJob(prepareJobData.args, prepareJobOutputFilePath)
    ).resolves.not.toThrow()

    const scriptStepData = testHelper.getRunScriptStepDefinition()

    const prepareJobOutputJson = fs.readFileSync(prepareJobOutputFilePath)
    const prepareJobOutputData = JSON.parse(prepareJobOutputJson.toString())

    await expect(
      runScriptStep(scriptStepData.args, prepareJobOutputData.state, null)
    ).resolves.not.toThrow()

    const runContainerStepData = testHelper.getRunContainerStepDefinition()

    await expect(
      runContainerStep(runContainerStepData.args)
    ).resolves.not.toThrow()

    await expect(cleanupJob()).resolves.not.toThrow()
  })
})

describe('script-executor', () => {
  async function startServer(port: number): Promise<ChildProcess> {
    const server = exec(
      'node /tmp/node_modules/ml-velocity-script-executor/dist/index.js',
      {
        env: {
          ...process.env,
          SCRIPT_EXECUTOR_ROOT_CERT_PATH: '/tmp/certs/ca.crt',
          SCRIPT_EXECUTOR_SERVER_CERT_PATH: '/tmp/certs/server.crt',
          SCRIPT_EXECUTOR_SERVER_KEY_PATH: '/tmp/certs/server.key',
          SCRIPT_EXECUTOR_SERVER_PORT: `${port}`,
          GRPC_VERBOSITY: 'debug',
          GRPC_TRACE: 'all'
        }
      }
    )
    await new Promise<void>(resolve =>
      server.stdout?.on('data', data => {
        if (`${data}`.includes('Server running')) {
          console.log(`Server is running!`)
          resolve()
        }
      })
    )
    return server
  }

  function cleanupChildProcess(childProcess: ChildProcess) {
    childProcess.stdout?.destroy()
    childProcess.stderr?.destroy()
    childProcess.stdin?.destroy()

    childProcess.kill()
    childProcess.unref()
  }

  let certs: MTLSCertAndPrivateKey
  beforeAll(() => {
    certs = generateCerts()
    if (!fs.existsSync('/tmp/certs')) {
      fs.mkdirSync('/tmp/certs', { recursive: true })
    }

    fs.writeFileSync('/tmp/certs/ca.crt', certs.caCertAndkey.cert)
    fs.writeFileSync('/tmp/certs/server.crt', certs.serverCertAndKey.cert)
    fs.writeFileSync('/tmp/certs/server.key', certs.serverCertAndKey.privateKey)

    execSync('npm install ml-velocity-script-executor', {
      cwd: '/tmp'
    })
  })

  afterAll(() => {
    fs.rmSync('/tmp/certs', { recursive: true, force: true })
  })

  it('should execute script successfully with certs', async () => {
    const serverProcess = await startServer(50051)
    try {
      await expect(
        runScriptByGrpc(
          'ls',
          certs.caCertAndkey.cert,
          certs.clientCertAndKey.cert,
          certs.clientCertAndKey.privateKey,
          'localhost'
        )
      ).resolves.not.toThrow()
    } finally {
      cleanupChildProcess(serverProcess)
    }
  })

  it('should not execute script successfully with the wrong certs', async () => {
    const serverProcess = await startServer(50052)
    try {
      // Generate a new random client cert
      const newCerts = generateCerts()

      await expect(
        runScriptByGrpc(
          'ls',
          newCerts.caCertAndkey.cert,
          newCerts.clientCertAndKey.cert,
          newCerts.clientCertAndKey.privateKey,
          'localhost',
          50052
        )
      ).rejects.toThrow('UNAVAILABLE')

      await expect(
        runScriptByGrpc(
          'ls',
          certs.caCertAndkey.cert,
          newCerts.clientCertAndKey.cert,
          newCerts.clientCertAndKey.privateKey,
          'localhost',
          50052
        )
      ).rejects.toThrow('UNAVAILABLE')
    } finally {
      cleanupChildProcess(serverProcess)
    }
  })
})

describe('cpToPod', () => {
  it('should copy local files to container without error', async () => {
    testHelper = new TestHelper()
    const pod = await testHelper.createTestJobPod()
    expect(pod.metadata?.name).toBeTruthy()
    expect(pod.spec?.containers[0].name).toBeTruthy()
    const tempTestDir = fs.mkdtempSync('test')
    fs.writeFileSync(path.join(tempTestDir, 'foo'), 'abc')
    fs.writeFileSync(path.join(tempTestDir, 'bar'), 'abc')

    await expect(
      cpToPod(
        pod.metadata?.name!!,
        pod.spec?.containers[0].name!!,
        tempTestDir,
        '/tmp'
      )
    ).resolves.not.toThrow()
  })
})
