import { describe, it, expect } from 'vitest';

describe('Health', () => {
  it('should export health routes', async () => {
    const { healthRoutes } = await import('../routes/health');
    expect(healthRoutes).toBeDefined();
  });
});

describe('Items', () => {
  it('should export item routes', async () => {
    const { itemRoutes } = await import('../routes/items');
    expect(itemRoutes).toBeDefined();
  });
});

describe('Error Handler', () => {
  it('should export error handler', async () => {
    const { errorHandler } = await import('../middleware/errorHandler');
    expect(errorHandler).toBeDefined();
    expect(typeof errorHandler).toBe('function');
  });
});
