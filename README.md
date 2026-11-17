# onebody-muzic
## Backend

The NestJS/PostgreSQL API is in [onebodymusic-backend](onebodymusic-backend/README.md). See the [Render deployment guide](onebodymusic-backend/docs/DEPLOYMENT.md) for environment settings, production scripts, safe migrations, verification and troubleshooting. The root `render.yaml` defines the API and managed PostgreSQL services.

## Frontend

The mobile-first React PWA is in [`onebodymusic-frontend`](onebodymusic-frontend/README.md).
With the backend running on port 3000:

```sh
cd onebodymusic-frontend
npm ci
cp .env.example .env
npm run dev
```

Open http://localhost:5173. See the frontend README for production hosting,
authentication behavior, PWA scope and browser test instructions.
