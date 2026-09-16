import { defineServerConfig } from '@modern-js/server-runtime';
import { resolve } from 'node:path';
import { createApi } from './core/api';
import { Store } from './core/store';

// One persistent database and API instance per server process, including dev reloads.
const state = globalThis as typeof globalThis & { __coachApi?: ReturnType<typeof createApi> };
export default defineServerConfig({
  middlewares: [
    {
      name: 'coach-api',
      handler: async (c, next) => {
        if (!c.req.path.startsWith('/api/')) {
          await next();
          return;
        }
        state.__coachApi ??= createApi(
          new Store(resolve(process.env.COACH_DB_PATH || '.data/coach.sqlite')),
        );
        return state.__coachApi(c.req.raw);
      },
    },
  ],
});
