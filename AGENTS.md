# Repository Guidelines

## Project Structure

GeoMap helps students study geographic features and practice locating them on physical and political maps. Read the [product specification](docs/product-spec.md) before changing learning flows, grading, or release scope. Use the [glossary](GLOSSARY.md) when naming learning concepts.

- `backend/geomap/` contains the FastAPI app, training and grading logic, and PostgreSQL access. Geographic datasets and their sources live in `backend/geomap/data/`.
- `frontend/src/` contains the React UI, API client, Leaflet maps, and Three.js globe. Static imagery, terrain, and vector assets live in `frontend/public/`.

## Build and Local Development

- From the repository root, run `docker compose up --build -d --wait` with Docker running to build the API and start it with PostgreSQL.
- From `frontend/`, use Node.js 22.12+ and run `npm ci` to install locked dependencies, `npm run dev` to start Vite, and `npm run build` to create the production bundle in `frontend/dist/`.

Open `/russia` or `/world` on the Vite server. See the [README](README.md) for local configuration and API details.

## Coding Style and Naming

Use four spaces and `snake_case` for Python functions, and two spaces, single quotes, and no trailing semicolons in JavaScript and JSX. Name React components in `PascalCase`, for example `MapView`. Keep HTTP and request validation in `api.py`, training and grading rules in Python modules, and database queries in `storage.py`.

## Testing

- Run the [documented Compose test command](README.md#проверки) from the repository root with services running. Pytest exercises FastAPI in `backend/tests/` using an isolated PostgreSQL schema for database tests.
- From `frontend/`, install Chromium with `npx playwright install chromium`, then run `npm test` with the API running. Playwright runs the specs in `frontend/tests/` and starts Vite if needed.

Name pytest functions `test_<behavior>` and use descriptive Playwright titles in `*.spec.js`. For grading changes, cover correct and incorrect answers, including a point on the boundary when relevant. Run the affected checks before opening a pull request.

## Commits and Pull Requests

Use Conventional Commits, for example `feat(frontend): add political world map`. In each pull request, explain the change and how you verified it, link the relevant issue when one exists, and attach before-and-after screenshots for visible changes.
