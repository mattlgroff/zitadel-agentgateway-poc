FROM python:3.13-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.7.11 /uv /bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

FROM python:3.13-slim
WORKDIR /app
ENV PATH=/app/.venv/bin:$PATH
COPY --from=build /app/.venv ./.venv
COPY app ./app
RUN useradd --create-home app
USER app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000"]
