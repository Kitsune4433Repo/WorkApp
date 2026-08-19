import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

export const knowledgeBaseRouter = Router();
knowledgeBaseRouter.use(requireAuth);

knowledgeBaseRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string) ?? '';
    const category = req.query.category as string | undefined;
    const params: unknown[] = [q];
    let extra = '';
    if (category) {
      params.push(category);
      extra = `AND category = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, title, category, tags, ts_headline('english', content, query) AS snippet,
              ts_rank(search_vector, query) AS rank
         FROM knowledge_base_articles, plainto_tsquery('english', $1) query
        WHERE ($1 = '' OR search_vector @@ query) ${extra}
        ORDER BY rank DESC, updated_at DESC
        LIMIT 50`,
      params,
    );
    res.json(rows);
  }),
);

knowledgeBaseRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, title, content, category, tags, document_id, updated_at FROM knowledge_base_articles WHERE id = $1`,
      [req.params.id],
    );
    res.json(rows[0] ?? null);
  }),
);

const articleSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  documentId: z.string().uuid().optional(),
});

knowledgeBaseRouter.post(
  '/',
  requireRole('admin', 'crew_lead'),
  asyncHandler(async (req, res) => {
    const body = articleSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO knowledge_base_articles (title, content, category, tags, document_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [body.title, body.content, body.category, body.tags, body.documentId ?? null, req.user!.id],
    );
    res.status(201).json({ id: rows[0].id });
  }),
);

knowledgeBaseRouter.patch(
  '/:id',
  requireRole('admin', 'crew_lead'),
  asyncHandler(async (req, res) => {
    const body = articleSchema.partial().parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, col] of [
      ['title', 'title'],
      ['content', 'content'],
      ['category', 'category'],
      ['tags', 'tags'],
    ] as const) {
      const value = (body as Record<string, unknown>)[key];
      if (value !== undefined) {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length) {
      params.push(req.params.id);
      await pool.query(`UPDATE knowledge_base_articles SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
    }
    res.status(204).end();
  }),
);
