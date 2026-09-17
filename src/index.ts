import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { dramaRoutes } from './routes/drama.route';

const app = new Elysia()
  .use(cors())
  .use(dramaRoutes)
  .listen(3000);

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)