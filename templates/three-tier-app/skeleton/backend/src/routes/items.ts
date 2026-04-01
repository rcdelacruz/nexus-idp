import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/connection';

export const itemRoutes = Router();

const CreateItemSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
});

const UpdateItemSchema = CreateItemSchema.partial();

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  search: z.string().optional(),
});

// List items
itemRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, status, search } = QuerySchema.parse(req.query);
    const offset = (page - 1) * limit;

    let query = db('items').orderBy('created_at', 'desc');
    let countQuery = db('items');

    if (status) {
      query = query.where('status', status);
      countQuery = countQuery.where('status', status);
    }
    if (search) {
      query = query.where('name', 'ilike', `%${search}%`);
      countQuery = countQuery.where('name', 'ilike', `%${search}%`);
    }

    const [items, [{ count }]] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery.count('id as count'),
    ]);

    res.json({
      items,
      pagination: {
        page,
        limit,
        total: Number(count),
        totalPages: Math.ceil(Number(count) / limit),
      },
    });
  } catch (err) { next(err); }
});

// Get single item
itemRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await db('items').where('id', req.params.id).first();
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.json(item);
  } catch (err) { next(err); }
});

// Create item
itemRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateItemSchema.parse(req.body);
    const [item] = await db('items').insert(data).returning('*');
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// Update item
itemRoutes.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = UpdateItemSchema.parse(req.body);
    const [item] = await db('items')
      .where('id', req.params.id)
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.json(item);
  } catch (err) { next(err); }
});

// Delete item
itemRoutes.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await db('items').where('id', req.params.id).delete();
    if (!deleted) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    res.status(204).send();
  } catch (err) { next(err); }
});
