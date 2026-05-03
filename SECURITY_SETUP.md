## OpenAI Secret Setup

Do not commit API keys to this repo.

Set the OpenAI key in Firebase Secret Manager before deploying functions:

```bash
export OPENAI_API_KEY="sk-..."
./scripts/set-openai-secret.sh
firebase deploy --only functions
```

The backend reads the key only from the `OPENAI_API_KEY` Firebase Functions secret.

## App Check (optional hardening)

To reduce abuse of authenticated callables (for example `generateAiRoutine`), enable [Firebase App Check](https://firebase.google.com/docs/app-check) for your web app and enforce it for Cloud Functions in the Firebase console. The client already logs whether App Check is attached on AI requests; after you register a provider (reCAPTCHA v3 or Enterprise), initialize App Check in `public/app.js` next to `initializeApp` and register the site key from the console.
