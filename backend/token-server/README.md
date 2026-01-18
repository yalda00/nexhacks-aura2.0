# Token Server

## Running the server

1. `cd backend/token-server`
2. `npm install`
3. `npm run start`

The server listens on `0.0.0.0:3000` and preserves the existing `GET /token` route that returns LiveKit JWTs.

## Exposing port 3000 via ngrok

1. Ensure `ngrok` is installed.
2. From the same directory, run `npm run ngrok`.
3. ngrok prints a forwarding URL such as `https://abcd1234.ngrok-free.app` that tunnels to `localhost:3000`.

## iOS token endpoint

Point the iOS app to the ngrok URL followed by `/token`, for example:

```
https://abcd1234.ngrok-free.app/token?room=demo&identity=test
```

The app can swap in the ngrok host that was provided by step 2 above without changing any routes.
