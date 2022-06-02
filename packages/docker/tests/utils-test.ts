import { sanitize } from '../src/utils'

describe('Utilities', () => {
  it('should return sanitized image name', () => {
    expect(sanitize('ubuntu:latest')).toBe('ubuntulatest')
  })

  it('should return the same string', () => {
    const validStr = 'teststr8_one'
    expect(sanitize(validStr)).toBe(validStr)
  })
})
