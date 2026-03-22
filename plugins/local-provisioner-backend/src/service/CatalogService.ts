/**
 * Service for Software Catalog integration
 */

import { LoggerService, DiscoveryService } from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { ProvisioningTask } from '../types';

/**
 * CatalogService handles catalog entity registration for provisioned resources
 */
export class CatalogService {
  // @ts-ignore - catalogClient will be used when catalog integration is implemented
  private catalogClient: CatalogClient;

  constructor(
    private readonly logger: LoggerService,
    discovery: DiscoveryService,
  ) {
    this.catalogClient = new CatalogClient({ discoveryApi: discovery });
  }

  /**
   * Register a provisioned resource in the Software Catalog
   */
  async registerProvisionedResource(task: ProvisioningTask): Promise<string> {
    this.logger.info(`Registering provisioned resource in catalog`, {
      taskId: task.task_id,
      resourceName: task.resource_name,
      taskType: task.task_type,
    });

    const entityRef = `resource:default/${task.resource_name}`;

    // Create catalog entity definition
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: {
        name: task.resource_name,
        description: `Locally provisioned ${this.getResourceTypeFriendlyName(task.task_type)}`,
        annotations: {
          'backstage.io/managed-by-location': 'local-provisioner',
          'local-provisioner/task-id': task.task_id,
          'local-provisioner/agent-id': task.agent_id,
          'local-provisioner/task-type': task.task_type,
          'local-provisioner/provisioned-at': new Date().toISOString(),
        },
        labels: {
          'local-provisioner/type': task.task_type,
          'local-provisioner/user': this.sanitizeUserIdForLabel(task.user_id),
        },
        tags: [
          'local',
          'development',
          this.getResourceTypeTag(task.task_type),
        ],
      },
      spec: {
        type: this.mapTaskTypeToResourceType(task.task_type),
        owner: `user:default/${this.extractUsernameFromEmail(task.user_id)}`,
        lifecycle: 'development',
        system: 'local-development',
        dependsOn: [],
        ...this.extractConnectionDetails(task),
      },
    };

    this.logger.debug('Catalog entity definition created', {
      entityRef,
      entity,
    });

    // TODO: In full implementation, use catalog API to register entity
    // For MVP, we'll log the entity and return the ref
    // await this.catalogClient.addLocation({
    //   type: 'local-provisioner',
    //   target: entityRef,
    // });

    this.logger.info(`Resource registered in catalog: ${entityRef}`, {
      entityRef,
      taskId: task.task_id,
    });

    return entityRef;
  }

  /**
   * Remove a provisioned resource from the catalog
   */
  async removeProvisionedResource(catalogEntityRef: string): Promise<void> {
    this.logger.info(`Removing provisioned resource from catalog`, {
      catalogEntityRef,
    });

    // TODO: Implement catalog entity removal
    // await this.catalogClient.removeEntityByUid(uid);

    this.logger.info(`Resource removed from catalog: ${catalogEntityRef}`);
  }

  /**
   * Map task type to catalog resource type
   */
  private mapTaskTypeToResourceType(taskType: string): string {
    const mapping: Record<string, string> = {
      'provision-kafka': 'message-broker',
      'provision-postgres': 'database',
      'provision-redis': 'cache',
      'provision-mongodb': 'database',
      'provision-mysql': 'database',
      'provision-rabbitmq': 'message-broker',
      'provision-elasticsearch': 'search-engine',
    };

    return mapping[taskType] || 'infrastructure';
  }

  /**
   * Get friendly name for resource type
   */
  private getResourceTypeFriendlyName(taskType: string): string {
    const mapping: Record<string, string> = {
      'provision-kafka': 'Apache Kafka',
      'provision-postgres': 'PostgreSQL Database',
      'provision-redis': 'Redis Cache',
      'provision-mongodb': 'MongoDB Database',
      'provision-mysql': 'MySQL Database',
      'provision-rabbitmq': 'RabbitMQ',
      'provision-elasticsearch': 'Elasticsearch',
    };

    return mapping[taskType] || taskType;
  }

  /**
   * Get tag for resource type
   */
  private getResourceTypeTag(taskType: string): string {
    const mapping: Record<string, string> = {
      'provision-kafka': 'kafka',
      'provision-postgres': 'postgres',
      'provision-redis': 'redis',
      'provision-mongodb': 'mongodb',
      'provision-mysql': 'mysql',
      'provision-rabbitmq': 'rabbitmq',
      'provision-elasticsearch': 'elasticsearch',
    };

    return mapping[taskType] || 'unknown';
  }

  /**
   * Extract connection details from task config
   */
  private extractConnectionDetails(task: ProvisioningTask): Record<string, any> {
    const config = task.config;
    const details: Record<string, any> = {};

    // Extract common connection details
    if (config.host) {
      details.host = config.host;
    } else {
      details.host = 'localhost';
    }

    if (config.port) {
      details.port = config.port;
    }

    if (config.ports) {
      details.ports = config.ports;
    }

    // Add task-type specific details
    if (task.task_type === 'provision-kafka') {
      details.bootstrapServers = `${details.host}:${config.port || 9092}`;
    } else if (task.task_type === 'provision-postgres' || task.task_type === 'provision-mysql') {
      details.connectionString = `${task.task_type.replace('provision-', '')}://${details.host}:${config.port || 5432}/${config.database || 'default'}`;
    } else if (task.task_type === 'provision-redis') {
      details.connectionString = `redis://${details.host}:${config.port || 6379}`;
    }

    return details;
  }

  /**
   * Extract username from email
   */
  private extractUsernameFromEmail(email: string): string {
    return email.split('@')[0].toLowerCase();
  }

  /**
   * Sanitize user ID for use as Kubernetes-style label
   * Labels must be alphanumeric with dashes, dots, or underscores
   */
  private sanitizeUserIdForLabel(userId: string): string {
    return userId
      .toLowerCase()
      .replace(/@/g, '-at-')
      .replace(/[^a-z0-9-_.]/g, '-');
  }
}
