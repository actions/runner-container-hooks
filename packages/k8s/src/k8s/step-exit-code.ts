import { V1Status } from '@kubernetes/client-node'

// Kubernetes remotecommand's structured status, not the HTTP status code or a
// message substring, is the authoritative process outcome. Unknown/malformed
// statuses must remain infrastructure failures rather than silently succeeding.
export function commandExitCode(status: V1Status): number | undefined {
  if (status?.status === 'Success') return 0
  if (status?.status !== 'Failure' || status.reason !== 'NonZeroExitCode') {
    return undefined
  }
  const causes = status.details?.causes
  if (!causes || causes.length !== 1 || causes[0].reason !== 'ExitCode') {
    return undefined
  }
  const value = causes[0].message
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/.test(value)) {
    return undefined
  }
  const code = Number(value)
  return code <= 255 ? code : undefined
}
