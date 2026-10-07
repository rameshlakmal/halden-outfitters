// @ts-check
// The whole API as one serverless function. vercel.json sends every /api/* request here.
import { createHandler } from '../lib/router.js';
import { accountRoutes } from '../lib/routes/account.js';
import { adminRoutes } from '../lib/routes/admin.js';
import { cartRoutes } from '../lib/routes/cart.js';
import { catalogRoutes } from '../lib/routes/catalog.js';
import { orderRoutes } from '../lib/routes/orders.js';

export default createHandler([...catalogRoutes, ...cartRoutes, ...accountRoutes, ...orderRoutes, ...adminRoutes]);
