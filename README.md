# Clauterion prototype

Web prototype for exploring AI interactions with Firebase Auth/Firestore, a React client, and a Firebase Function placeholder for Claude.

## Structure
- `frontend/` – React + TypeScript + Vite + Tailwind + React Query. Routes for login, topic list/create, and topic detail with message thread and Claude call.
- `functions/` – Firebase Function `createAssistantMessage` with Zod validation and a placeholder response (replace with real Claude API call).

## Setup
1) Frontend
   - Copy `frontend/env.sample` to `frontend/.env.local` and fill your Firebase project values.
   - Install deps: `cd frontend && npm install`.
   - Run dev server: `npm run dev`.
2) Functions
   - Install deps: `cd functions && npm install`.
   - Set secret for Claude: `firebase functions:config:set claude.key="sk-..."` or add via Firebase console.
   - Build once: `npm run build`. Deploy with `firebase deploy --only functions` (after initializing Firebase in this repo).

## Notes
- Client calls the callable function named `createAssistantMessage` for Claude replies; it stores messages under `topics/{topicId}/messages`.
- The function currently returns a placeholder response. Swap in the real Claude API call using the secret.
- Keep Firebase keys client-side only for the web SDK; the Claude key must stay in Functions config.

