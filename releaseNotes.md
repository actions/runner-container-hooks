<!-- ## Features -->
## Bugs

- Fix argument order for 'docker pull' [#85]
- Do not overwrite entrypoint if it has already been set or if it is Service container [#83]
- Throw if an entrypoint is not specified for container step [#77]
- Include sha256 checksums in releaseNotes [#98]
- Escape backtick in writeEntryPointScript [#101]
- Implement yaml extensions overwriting the default pod/container spec [#75]

<!-- ## Misc -->

## SHA-256 Checksums

The SHA-256 checksums for the packages included in this build are shown below:

- actions-runner-hooks-docker-<HOOK_VERSION>.zip <DOCKER_SHA>
- actions-runner-hooks-k8s-<HOOK_VERSION>.zip <K8S_SHA>
