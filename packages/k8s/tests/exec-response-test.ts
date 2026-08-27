import { requireExecExitCode } from '../src/k8s/exec-response'

describe('requireExecExitCode', () => {
  it('returns a zero exit code', () => {
    expect(requireExecExitCode({ code: 0 })).toBe(0)
  })

  it('returns a nonzero exit code', () => {
    expect(requireExecExitCode({ code: 23 })).toBe(23)
  })

  it('rejects a successful response without an exit code', () => {
    expect(() => requireExecExitCode({})).toThrow(
      'execPodStep completed without an exit code'
    )
  })
})
