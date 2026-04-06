import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';

/**
 * Scaffolder action: kubernetes:get-ingress-domain
 *
 * Reads K8s target config from app-config (scaffolder.targets.kubernetes[0])
 * and outputs all values needed for deployment templates.
 *
 * The platform admin configures this once in app-config.yaml / .env.
 * Works with any DNS setup: nip.io, ExternalDNS, Route53, Cloudflare, Tailscale MagicDNS.
 */
export function createGetIngressDomainAction(options?: { config?: Config }) {
  return createTemplateAction({
    id: 'kubernetes:get-ingress-domain',
    description: 'Read K8s target config (ingress domain, storage class, ingress class) from platform config',
    schema: {
      input: z => z.object({}),
      output: z => z.object({
        ingressDomain: z.string(),
        ingressClass: z.string(),
        storageClass: z.string(),
      }),
    },
    async handler(ctx) {
      const config = options?.config;

      const k8sTargets = config?.getOptionalConfigArray('scaffolder.targets.kubernetes');
      const k8sTarget = k8sTargets?.[0];

      const ingressDomain =
        k8sTarget?.getOptionalString('ingressDomain') ??
        process.env.SCAFFOLDER_INGRESS_DOMAIN ??
        'localhost';

      const ingressClass =
        k8sTarget?.getOptionalString('ingressClass') ??
        'nginx';

      const storageClass =
        k8sTarget?.getOptionalString('storageClass') ??
        'longhorn';

      ctx.logger.info(`K8s target config — ingressDomain: ${ingressDomain}, ingressClass: ${ingressClass}, storageClass: ${storageClass}`);

      ctx.output('ingressDomain', ingressDomain);
      ctx.output('ingressClass', ingressClass);
      ctx.output('storageClass', storageClass);
    },
  });
}
