## Runner Container Hooks
The Runner Container Hooks repo provides a set of packages that implement the container hooks feature in the [actions/runner](https://github.com/actions/runner). These can be used as is, or you can use them as a guide to implement your own hooks.

More information on how to implement your own hooks can be found in the [adr](https://github.com/actions/runner/pull/1891). The `examples` folder provides example inputs for each hook.

## Background 

Three projects are included in the `packages` folder
- k8s: A kubernetes hook implementation that spins up pods dynamically to run a job. More details can be found in the [readme](./packages/k8s/README.md)
- docker: A hook implementation of the runner's docker implementation. More details can be found in the [readme](./packages/docker/README.md)
- hooklib: a shared library which contains typescript definitions and utilities that the other projects consume

### Requirements

We welcome contributions.  See [how to contribute to get started](./CONTRIBUTING.md).

## License 

This project is licensed under the terms of the MIT open source license. Please refer to [MIT](./LICENSE.md) for the full terms.

## Maintainers 

See the [Codeowners](./CODEOWNERS)

## Support

Find a bug? Please file an issue in this repository using the issue templates.

## Code of Conduct

See our [Code of Conduct](./CODE_OF_CONDUCT.MD)