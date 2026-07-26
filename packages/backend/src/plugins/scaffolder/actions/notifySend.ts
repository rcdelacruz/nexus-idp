import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { NotificationService } from '@backstage/plugin-notifications-node';

/**
 * Scaffolder action: notification:send
 *
 * Sends an in-app notification to a user. Used by the teardown-app template
 * so the initiating user learns the outcome without keeping the task page
 * open — ArgoCD cascade + namespace deletion can take 2-3 minutes.
 */
export function createNotifySendAction(options: { notification: NotificationService }) {
  const { notification } = options;

  return createTemplateAction({
    id: 'notification:send',
    description: 'Send an in-app notification to a user',
    schema: {
      input: z =>
        z.object({
          recipientEntityRef: z.string().describe('User entity ref, e.g. user:default/jane.doe'),
          title: z.string(),
          description: z.string().optional(),
          severity: z.enum(['critical', 'high', 'normal', 'low']).default('normal'),
          link: z.string().optional().describe('Link included in the notification, e.g. the task log URL'),
        }),
    },
    async handler(ctx) {
      const { recipientEntityRef, title, description, link } = ctx.input;
      // zod's schema-level .default() is a type/UI contract only — Backstage
      // does not apply it to ctx.input for unpassed fields at runtime.
      const severity = ctx.input.severity ?? 'normal';

      await notification.send({
        recipients: { type: 'entity', entityRef: recipientEntityRef },
        payload: {
          title,
          description,
          severity,
          link,
          topic: 'teardown-app',
        },
      });

      ctx.logger.info(`Notification sent to ${recipientEntityRef}: ${title}`);
    },
  });
}
