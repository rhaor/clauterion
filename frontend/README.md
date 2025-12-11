# Clauterion web client

Minimal React + TypeScript + Vite starter with Firebase Auth/Firestore, Tailwind, React Query, and routing for:
- Email/password auth
- Topic list + creation
- Topic detail with conversation thread + send-to-Claude call (callable function)

## Quick start
1) Copy `env.sample` to `.env.local` and fill your Firebase project values.
2) Install dependencies:
   ```bash
   npm install
   ```
3) Run the dev server:
   ```bash
   npm run dev
   ```

## Where things live
- `src/lib/firebase.ts` – client SDK init (Auth, Firestore, Functions).
- `src/features/auth` – auth context + route guard.
- `src/pages` – `Login`, `Topics`, `TopicDetail`.
- `src/services` – Firestore helpers and callable function client.
- `src/components/layout/AppShell.tsx` – top nav + routed content.

## Notes
- The callable function name is `createAssistantMessage` (defined in `functions/src/index.ts`). Claude key stays server-side.
- Styling uses Tailwind with a light baseline; customize in `tailwind.config.js` and `src/index.css`.
