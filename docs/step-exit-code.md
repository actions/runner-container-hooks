# Separating workload status from Kubernetes hook failures

This patch adds an opt-in protocol extension for `run_script_step` and
`run_container_step`. The runner must advertise `supportsStepExitCode: true` at
the top level of its hook input. After completing a workload, the Kubernetes
hook writes `{ "exitCode": N }` to the existing response file and exits zero.
The patched runner reads that code and records the normal step outcome. This
preserves the command's actual status and streamed output without attributing
an ordinary command failure to the runner infrastructure.

Only a structured Kubernetes remotecommand `Success` or a `Failure` with
`reason: NonZeroExitCode` and exactly one `ExitCode` cause is accepted. Nonzero
codes must be decimal integers from 1 through 255. Missing or malformed status,
transport errors, authorization errors, and setup/merge failures still fail the
hook. Setup commands do not opt into workload-status handling. Generated
wrappers also emit a per-invocation launch marker on stderr only after their
hook-owned setup succeeds and immediately before `exec`. The hook consumes that
marker without changing the surrounding output bytes and requires it before
accepting either a zero or nonzero wrapper status. A failed wrapper `rm`, `cd`,
or workspace `mv` therefore remains a hook failure, not a workload result.
The entrypoint's shell launch statuses (for example, 126/127) are workload
results once setup has completed. No exit status is reserved for the wrapper;
legacy invocations do not emit markers.

Compatibility is fail-closed: absent or false capability uses the existing
nonzero hook failure path; a legacy runner cannot silently ignore the response
and mark a failed workload successful. A response-write failure also fails the
hook. No runner version string is used for inference.

This patch deliberately does not suppress all hook exceptions, deploy any
runner, or change the Docker hook implementation. It requires the corresponding
runner protocol patch for improved classification. It preserves existing copy
warning and step-pod cleanup behavior; those policies are not changed here.

Validation includes unit-level structured-status, capability, response-write,
exec callback/transport, script/file-command, and dispatcher tests. Mocked
Kubernetes outcomes are not a live Kubernetes/GitHub end-to-end validation.
