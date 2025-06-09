# 背景
昇腾CI bug: [pod初始化报错8020](https://github.com/ascend-gha-runners/docs/issues/11)

# 解决思路
Github ARC 创建 container pod 的源码是[runner-container-hooks](https://github.com/actions/runner-container-hooks)

我们 fork runner-container-hooks 仓库，修改源码，使得每次执行workflow之前先循环检查npu-smi命令。

# 实现流程
1. 集群中配置[configmap](https://github.com/opensourceways/ascend-ci-deployment/blob/main/cllouud/vllm-ascend/config/pre-execute-script-check-npu-configmap.yaml)，check.sh脚本检查npu-smi命令。

2. 使用以下命令构建本仓库。
```bash
npm run bootstrap

npm run build-all
```
3. 构建完成后，将`./packages/k8s/dist/index.js`放入`pvc`，`pvc`挂载到`runner pod`，使用`initContainers`替换默认index.js文件。


