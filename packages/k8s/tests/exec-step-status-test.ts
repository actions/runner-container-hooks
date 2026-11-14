const mockExec = jest.fn()
jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromDefault() {}
    getContexts() {
      return [{ namespace: 'unit-test' }]
    }
    makeApiClient() {
      return {}
    }
  },
  Exec: class {
    exec(...args: unknown[]) {
      return mockExec(...args)
    }
  }
}))
import { execPodStep } from '../src/k8s'

const status = {
  status: 'Failure',
  reason: 'NonZeroExitCode',
  details: { causes: [{ reason: 'ExitCode', message: '17' }] }
}
function respond(value: unknown) {
  mockExec.mockImplementation(async (...args) => {
    args[8](value)
    return Promise.resolve({})
  })
}

test('opted-in workload exit is returned, streams still forwarded', async () => {
  respond(status)
  await expect(
    execPodStep(['false'], 'pod', 'container', undefined, true)
  ).resolves.toBe(17)
  expect(mockExec.mock.calls[0][4]).toBe(process.stdout)
  expect(mockExec.mock.calls[0][5]).toBe(process.stderr)
})
test('setup commands and legacy behavior still throw on nonzero', async () => {
  respond(status)
  await expect(execPodStep(['false'], 'pod', 'container')).rejects.toThrow()
})
test('transport failure remains failure even when opted in', async () => {
  mockExec.mockRejectedValue(new Error('ECONNRESET'))
  await expect(
    execPodStep(['false'], 'pod', 'container', undefined, true)
  ).rejects.toThrow('ECONNRESET')
})
test('authorization status remains failure even when opted in', async () => {
  respond({ status: 'Failure', reason: 'Forbidden', message: 'forbidden' })
  await expect(
    execPodStep(['false'], 'pod', 'container', undefined, true)
  ).rejects.toThrow('forbidden')
})
test('successful status resolves zero', async () => {
  respond({ status: 'Success', code: 200 })
  await expect(
    execPodStep(['true'], 'pod', 'container', undefined, true)
  ).resolves.toBe(0)
})
