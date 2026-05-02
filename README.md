# Couple Wishlist App

A full-stack wishlist and planning app for couples, friends, or small groups. Users sign in with Google, connect with invite codes, switch between multiple shared connections, and plan wishlist or scheduled items together.

## Features

- Google login with Firebase Authentication
- Firestore-backed users, connections, and wishlist items
- Multi-connection switching without re-entering invite codes
- Wishlist and Scheduled tabs
- Categories for movies, restaurants, trips, and hotels
- Calendar view for scheduled items
- Docker-based local development

## Tech Stack

- Frontend: React, Vite, Tailwind CSS, Firebase Web SDK
- Backend: Node.js, Express, Firebase Admin SDK
- Database/Auth: Firebase Authentication and Firestore
- DevOps: Docker and Docker Compose

## Project Structure

```text
couple-wishlist/
  client/
    src/
      App.jsx
      firebase.js
      index.css
      main.jsx
    Dockerfile
    package.json
    vite.config.js
    .env.example
  server/
    src/
      firebase.js
      index.js
    Dockerfile
    package.json
    .env.example
  docker-compose.yml
  .env.example
  .gitignore
  README.md
```

## Local Setup With Docker

Prerequisite: Docker.

1. Create a Firebase project.
2. Enable Google sign-in in Firebase Authentication.
3. Create a Firestore database.
4. Create a Firebase Admin service account key.
5. Copy the root environment example:

```bash
cp .env.example .env
```

6. Fill in `.env` with your Firebase web config and Firebase Admin SDK JSON.
7. Start the app:

```bash
docker-compose up --build
```

Local URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5001`
- Health check: `http://localhost:5001/api/health`

## Environment Variables

Root `.env` is used by Docker Compose for local development.

Frontend:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_API_BASE_URL=
```

Backend:

```bash
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
FIREBASE_SERVICE_ACCOUNT_JSON=
```

Notes:

- Keep `VITE_API_BASE_URL` empty for Docker local development. Vite proxies `/api` to the server container.
- In production, set `VITE_API_BASE_URL` to the deployed backend URL.
- `FIREBASE_SERVICE_ACCOUNT_JSON` should be a single-line JSON string and must never be committed.

## Deployment

### Frontend: Vercel

1. Create a new Vercel project from this repository.
2. Set the root directory to `client`.
3. Add the frontend environment variables from `client/.env.example`.
4. Set `VITE_API_BASE_URL` to your Render backend URL.
5. Deploy.

### Backend: Render

1. Create a new Web Service from this repository.
2. Set the root directory to `server`.
3. Set the build command:

```bash
npm install
```

4. Set the start command:

```bash
npm start
```

5. Add backend environment variables from `server/.env.example`.
6. Set `CLIENT_ORIGIN` to your Vercel frontend URL.
7. Deploy.

## Screenshots

Add screenshots here after deployment:

- Login page
- Dashboard
- Connection switcher
- Calendar view

## Development Notes

- Do not commit `.env` files or Firebase service account JSON files.
- Run `docker-compose up --build` after changing dependencies or Dockerfiles.
- Use `npm run build` in `client` before frontend deployment.
