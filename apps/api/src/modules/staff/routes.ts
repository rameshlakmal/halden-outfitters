import {
  AuditEntry,
  CouponCreate,
  CouponEdit,
  Dashboard,
  DASHBOARD_RANGES,
  Id,
  Problem,
  ProductCreate,
  ProductEdit,
  RateEdit,
  ROLES,
  SetRole,
  ShippingRate,
  StaffCoupon,
  StaffCustomer,
  StaffProduct,
  StockAdjust,
  StockMovement,
  TaxSetting,
  Total,
} from '@halden/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { needsUser, requireRole } from '../../core/auth.js';
import { parseIfMatch, StaffService } from './service.js';

const security: Record<string, string[]>[] = [{ session: [] }, { bearer: [] }];
const tags = ['Staff'];
const params = z.object({ id: Id });
const listQuery = z.object({ cursor: Id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable(), total: Total });
const ok = { 401: Problem, 403: Problem, 404: Problem };

export const staffRoutes: FastifyPluginAsyncZod = async (app) => {
  const staff = new StaffService(app.ctx);

  // ---------- products and stock ----------

  app.get(
    '/staff/products',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Products with stock (staff)',
        security,
        querystring: listQuery.extend({
          q: z.string().trim().max(80).optional(),
          lowStock: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
        }),
        response: { 200: page(StaffProduct), ...ok },
      },
    },
    async (req) => {
      requireRole(req, 'support', 'warehouse', 'admin');
      return staff.products(
        { q: req.query.q, lowStock: req.query.lowStock },
        req.query.cursor ?? null,
        req.query.limit,
      );
    },
  );

  app.post(
    '/staff/products',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Add a product (admin)',
        description:
          'With at least one photo (uploaded to Vercel Blob by the admin app, or a path under /images/) and its opening ' +
          'stock. The SKU and the address (slug) must be unused.',
        security,
        body: ProductCreate,
        response: { 201: StaffProduct, 400: Problem, ...ok },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await staff.createProduct(requireRole(req, 'admin'), req.body, req.now)),
  );

  app.get(
    '/staff/products/:id',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'One product; the ETag is its version',
        security,
        params,
        response: { 200: StaffProduct, ...ok },
      },
    },
    async (req, reply) => {
      requireRole(req, 'support', 'warehouse', 'admin');
      const p = await staff.product(req.params.id);
      reply.header('etag', `"${p.version}"`);
      return p;
    },
  );

  app.patch(
    '/staff/products/:id',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Edit a product (admin); needs If-Match',
        description:
          'Send `If-Match: "<version>"` with the version you loaded. If someone saved since, you get 412 and nothing changes. ' +
          'Orders keep the price they were placed at.',
        security,
        params,
        headers: z.object({ 'if-match': z.string().optional() }),
        body: ProductEdit,
        response: { 200: StaffProduct, 400: Problem, ...ok, 412: Problem, 428: Problem },
      },
    },
    async (req, reply) => {
      const user = requireRole(req, 'admin');
      const p = await staff.editProduct(req.params.id, user, parseIfMatch(req.headers['if-match']), req.body, req.now);
      reply.header('etag', `"${p.version}"`);
      return p;
    },
  );

  app.post(
    '/staff/products/:id/stock',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Restock, count or write off stock (warehouse)',
        security,
        params,
        body: StockAdjust,
        response: { 200: StaffProduct, 400: Problem, ...ok },
      },
    },
    async (req) => staff.adjustStock(req.params.id, requireRole(req, 'warehouse', 'admin'), req.body, req.now),
  );

  app.get(
    '/staff/products/:id/movements',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Stock movements, newest first',
        security,
        params,
        response: { 200: z.object({ items: z.array(StockMovement) }), ...ok },
      },
    },
    async (req) => {
      requireRole(req, 'support', 'warehouse', 'admin');
      await staff.product(req.params.id);
      return { items: await staff.movements(req.params.id) };
    },
  );

  // ---------- dashboard ----------

  app.get(
    '/staff/dashboard',
    {
      schema: {
        tags,
        summary: 'Dashboard numbers for the last 7, 30 or 90 days (staff)',
        security,
        querystring: z.object({
          days: z.coerce
            .number()
            .pipe(z.union(DASHBOARD_RANGES.map((d) => z.literal(d))))
            .default(30),
        }),
        response: { 200: Dashboard, 400: Problem, 401: Problem, 403: Problem },
      },
    },
    async (req) => {
      requireRole(req, 'support', 'warehouse', 'admin');
      return staff.dashboard(req.query.days, req.now);
    },
  );

  // ---------- coupons, shipping, tax (admin) ----------

  app.get(
    '/staff/coupons',
    {
      schema: {
        tags,
        summary: 'Coupons with their uses (admin)',
        security,
        response: { 200: z.object({ items: z.array(StaffCoupon) }), 401: Problem, 403: Problem },
      },
    },
    async (req) => {
      requireRole(req, 'admin');
      return { items: await staff.coupons() };
    },
  );

  app.post(
    '/staff/coupons',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Create a coupon (admin)',
        description: 'The code, kind and value are fixed once created; everything else can be edited later.',
        security,
        body: CouponCreate,
        response: { 201: StaffCoupon, 400: Problem, ...ok },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await staff.createCoupon(requireRole(req, 'admin'), req.body, req.now)),
  );

  app.patch(
    '/staff/coupons/:code',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Edit a coupon: switch it on or off, its limits, schedule and rules (admin)',
        security,
        params: z.object({ code: z.string().regex(/^[A-Z0-9]{3,20}$/) }),
        body: CouponEdit,
        response: { 200: StaffCoupon, 400: Problem, ...ok },
      },
    },
    async (req) => staff.editCoupon(req.params.code, requireRole(req, 'admin'), req.body, req.now),
  );

  app.get(
    '/staff/shipping-rates',
    {
      schema: {
        tags,
        summary: 'Shipping rates by zone (admin)',
        security,
        response: { 200: z.object({ items: z.array(ShippingRate) }), 401: Problem, 403: Problem },
      },
    },
    async (req) => {
      requireRole(req, 'admin');
      return { items: await staff.rates() };
    },
  );

  app.put(
    '/staff/shipping-rates/:zone/:method',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Change a shipping rate (admin)',
        description: 'New orders use it; placed orders keep what they were charged.',
        security,
        params: z.object({ zone: z.string().regex(/^[a-z_]+$/), method: z.enum(['standard', 'express']) }),
        body: RateEdit,
        response: { 200: ShippingRate, 400: Problem, ...ok },
      },
    },
    async (req) => staff.editRate(req.params.zone, req.params.method, requireRole(req, 'admin'), req.body, req.now),
  );

  app.get(
    '/staff/tax',
    {
      schema: {
        tags,
        summary: 'The tax rate (admin)',
        security,
        response: { 200: TaxSetting, 401: Problem, 403: Problem },
      },
    },
    async (req) => {
      requireRole(req, 'admin');
      return { ratePercent: await staff.taxRate() };
    },
  );

  app.put(
    '/staff/tax',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Change the tax rate (admin)',
        description: 'Placed orders keep the rate they were charged.',
        security,
        body: TaxSetting,
        response: { 200: TaxSetting, 400: Problem, 401: Problem, 403: Problem },
      },
    },
    async (req) => ({ ratePercent: await staff.setTaxRate(requireRole(req, 'admin'), req.body.ratePercent, req.now) }),
  );

  // ---------- customers and roles ----------

  app.get(
    '/staff/customers',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Find customers and staff (support)',
        security,
        querystring: listQuery.extend({ q: z.string().trim().max(80).optional(), role: z.enum(ROLES).optional() }),
        response: { 200: page(StaffCustomer), 401: Problem, 403: Problem },
      },
    },
    async (req) => {
      requireRole(req, 'support', 'admin');
      return staff.customers({ q: req.query.q, role: req.query.role }, req.query.cursor ?? null, req.query.limit);
    },
  );

  app.put(
    '/staff/customers/:id/role',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: "Change an account's role (admin); signs it out everywhere",
        security,
        params,
        body: SetRole,
        response: { 204: z.null(), 400: Problem, ...ok },
      },
    },
    async (req, reply) => {
      await staff.setRole(req.params.id, requireRole(req, 'admin'), req.body.role, req.now);
      return reply.code(204).send(null);
    },
  );

  // ---------- audit ----------

  app.get(
    '/staff/audit',
    {
      preValidation: needsUser,
      schema: {
        tags,
        summary: 'Audit log, newest first (admin)',
        security,
        querystring: listQuery.extend({
          entityType: z.string().max(40).optional(),
          entityId: z.string().max(60).optional(),
          actorId: Id.optional(),
        }),
        response: { 200: page(AuditEntry), 401: Problem, 403: Problem },
      },
    },
    async (req) => {
      requireRole(req, 'admin');
      const { entityType, entityId, actorId, cursor, limit } = req.query;
      return staff.auditLog({ entityType, entityId, actorId }, cursor ?? null, limit);
    },
  );
};
