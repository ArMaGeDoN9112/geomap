# Repository Guidelines

## Project Purpose

GeoMap helps school students learn where geographic features are and practice pointing them out on a map. The first release uses a physical map of Russia and one preset list that teachers can share by link. For changes to learning flows or release scope, read the [product specification](docs/product-spec.md). Use the [glossary](GLOSSARY.md) when naming learning concepts.

## Project Structure

- `backend/` houses the FastAPI application and its PostgreSQL integration.
- `frontend/` houses the React application, including the map interface and learning interactions. It accesses application data through the FastAPI API.

## Backend Architecture and Coding Style

Keep FastAPI handlers focused on HTTP and request validation. Put learning and exercise rules in ordinary Python functions or modules, and keep PostgreSQL queries in the data access code. For example, a handler receives a submitted answer, while the exercise logic decides whether it is correct. Group related code by feature and use names that describe the behavior it owns.

## Build, Test, and Development Commands

Frontend language, local setup, migrations, testing, and linting tools are pending decisions by the project owner. Once chosen, document the commands for installing dependencies, running locally, building, and testing. State where to run each command and list its prerequisites.

## Testing

Once the test tooling is set up, name tests for the behavior they verify and run the relevant checks before opening a pull request. For changes to exercise logic, cover correct and incorrect answers.

## Commits and Pull Requests

Commit rules: conventional commits. In each pull request, explain the change and how it was verified. Link the relevant issue when one exists, and include before-and-after screenshots for visible changes.
