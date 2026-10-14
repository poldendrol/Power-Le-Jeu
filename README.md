# Power, le jeu (version numérique)

Browser version of the 1981 board game *Power*, playable with 2 to 4 friends over the internet.
One player creates a room and shares the link; everyone writes up to 5 secret orders per turn,
and all orders resolve at the same time.

## Run locally

    npm install
    npm run dev        # builds, then serves on http://localhost:3000
    npm test           # rules tests

## Layout

- `src/shared/rules.ts` – units, orders, exchanges, méga-missiles, conflicts, Power and flags, following http://jeuxstrategie.free.fr/Power_complet.php
- `src/shared/board.ts` – the board as a grid of sectors, copied from a screenshot of the original
- `src/server/index.ts` – HTTP + WebSocket server, game rooms kept in memory
- `src/client/main.ts` – browser UI (board as SVG)

## Deploy

`render.yaml` deploys the app as a free Render web service from a GitHub repo.
