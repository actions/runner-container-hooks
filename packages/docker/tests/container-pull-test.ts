import { containerPull } from '../src/dockerCommands'

jest.useRealTimers()

describe('container pull', () => {
  it('should fail', async () => {
    const arg = { image: 'does-not-exist' }
    await expect(containerPull(arg.image, '')).rejects.toThrow()
  })
  it('should succeed', async () => {
    const arg = { image: 'ubuntu:latest' }
    await expect(containerPull(arg.image, '')).resolves.not.toThrow()
  })
})
