import { HookData, Mount } from 'hooklib/lib'
import { env } from 'process'

export function applyCkoCustomisations(hookdata: HookData): HookData {

    // always propagate AWS environment variables down to container steps to ensure that have the same AWS creds as script steps
    const propagateEnvVars = [
        'AWS_DEFAULT_REGION',
        'AWS_REGION',
        'AWS_ROLE_ARN',
        'AWS_WEB_IDENTITY_TOKEN_FILE',
        'AWS_STS_REGIONAL_ENDPOINTS'
    ]

    // we need to mount the service account token into the container step's container so it can use the web identity token when making AWS requests
    const volumeMounts = [
        '/var/run/secrets/eks.amazonaws.com/serviceaccount/token'
    ]

    // only inject environment variables if they aren't already present in the hookdata
    // and if they exist in the currect environment
    for (const envVarName of propagateEnvVars) {
        if (envVarName in hookdata.environmentVariables) {
            continue;
        }

        if (!env[envVarName]) {
            continue;
        }

        hookdata.environmentVariables[envVarName] = env[envVarName];
    }

    for (const mountPath of volumeMounts) {
        hookdata.userMountVolumes.push(<Mount>{
            sourceVolumePath: mountPath,
            targetVolumePath: mountPath,
            readOnly: true
        })
    }

    return hookdata;
}