import { createTemplateAction } from '@backstage/plugin-scaffolder-node';

/**
 * Scaffolder action: kubernetes:get-ingress-domain
 *
 * Reads the ingress domain from app-config (scaffolder.ingressDomain)
 * and outputs it for use in template values.
 *
 * The platform admin configures this once in app-config.yaml / .env.
 * Works with any DNS setup: nip.io, ExternalDNS, Route53, Cloudflare, Tailscale MagicDNS.
 */
export function createGetIngressDomainAction() {
  return createTemplateAction({
    id: 'kubernetes:get-ingress-domain',
    description: 'Read ingress domain from platform config',
    schema: {
      input: z => z.object({}),
      output: z => z.object({
        ingressDomain: z.string(),
      }),
    },
    async handler(ctx) {
      const domain = process.env.SCAFFOLDER_INGRESS_DOMAIN ?? 'localhost';

      ctx.logger.info(`Ingress domain: ${domain}`);
      ctx.output('ingressDomain', domain);
    },
  });
}
