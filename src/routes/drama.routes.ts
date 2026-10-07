import { Elysia } from 'elysia';
import { DramaService } from '../services/drama.service';

const dramaService = new DramaService();

export const dramaRoutes = new Elysia({ prefix: '/api' })
  .get('/dramas', () => {
    return dramaService.fetchAllDramas();
  });