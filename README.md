# SupplyChain Sentinel

> AI-Powered Software Supply Chain Security, Vulnerability Triage, and Remediation Planning

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React_19-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev/)
[![FalkorDB](https://img.shields.io/badge/FalkorDB-Graph_Database-red?style=flat-square)](https://www.falkordb.com/)
[![OSV](https://img.shields.io/badge/OSV.dev-Vulnerability_Intel-blue?style=flat-square)](https://osv.dev/)
[![Render](https://img.shields.io/badge/Backend-Render-46E3B7?style=flat-square&logo=render&logoColor=white)](https://render.com)
[![Vercel](https://img.shields.io/badge/Frontend-Vercel-000000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com)

---

## Live Deployments

- **Web Application:** [https://supply-chain-sentinel-five.vercel.app](https://supply-chain-sentinel-five.vercel.app)
- **Backend API:** [https://supplychain-sentinel-api.onrender.com](https://supplychain-sentinel-api.onrender.com)
- **API Health Check:** [https://supplychain-sentinel-api.onrender.com/health](https://supplychain-sentinel-api.onrender.com/health)

---

## Overview

Modern web applications depend on hundreds of nested direct and transitive packages. When critical vulnerabilities strike, standard tabular scanners fail to communicate how malicious dependencies entered the codebase or what breaks upon updating them.

**SupplyChain Sentinel** pairs autonomous multi-agent pipelines with a graph-native database (**FalkorDB**) to map entire dependency trees, detect known CVEs/GHSAs via **OSV**, isolate supply-chain attack vectors, and produce breaking-change-aware remediation plans.

---

## Core Features

- **Interactive Topological Dependency Matrix:**
  Explore deep dependency hierarchies with pan-and-drag navigation, mouse-wheel zooming, a live radar mini-map, and automated multi-column wrapping for large trees (250+ packages).
- **Supply Chain Attack Vector Tracing:**
  Trace any transitive vulnerability back to the exact root package that introduced it (`Root -> Intermediate -> Vulnerability`).
- **Autonomous Multi-Agent Pipeline:**
  - **Scanner Agent:** Ingests `package-lock.json` manifests and matches packages against real-time OSV vulnerability feeds.
  - **Triage Agent:** Categorizes CVEs by exploitability, scope (production vs. dev), and institutional risk appetite.
  - **Remediation Agent:** Synthesizes SemVer-compatible upgrade matrices with breaking-change warnings.
- **Institutional Agent Memory:**
  Graph-persisted memory ledger for false positives, accepted risks, and validated remediation rules.
- **Model Context Protocol (MCP) Server:**
  Exposes triage and remediation tools directly to external AI assistants via SSE/HTTP (`/mcp`).

---

## Architecture

```text
 +---------------------------------------------------------+
 |       React + Vite Frontend (Cyberpunk UI / Vercel)     |
 +----------------------------+----------------------------+
                              | HTTPS / REST / SSE
                              v
 +---------------------------------------------------------+
 |        Express + TypeScript API Gateway (Render)        |
 +----------------------------+----------------------------+
 |  Autonomous Agent Pipeline |  Repository Ingestion      |
 |  (Scanner, Triager, Fixer) |  & Lockfile Parser         |
 +─────────────+──────────────+─────────────+──────────────+
               | Cypher Queries             | Live Queries
               v                            v
 +---------------------------+ +---------------------------+
 │   FalkorDB Graph Engine   | |     OSV.dev API Feed      |
 │  (Nodes, Edges, Memory)   | |  (Known CVEs & GHSAs)     |
 +---------------------------+ +---------------------------+
```

---

## Quick Start (Local Development)

### Prerequisites

- **Node.js** `>= 20.0.0` and `npm`
- **FalkorDB** instance (Local Docker or FalkorDB Cloud)

### 1. Clone Repository

```bash
git clone https://github.com/ABHI-SHEK-001/Supply_Chain_Sentinel.git
cd Supply_Chain_Sentinel
```

### 2. Start FalkorDB (Docker)

```bash
docker run -p 6379:6379 -it --rm falkordb/falkordb:latest
```

### 3. Setup and Start Backend

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

> **Verify Database Connection:** Run `npm run verify:graph` inside `server/` to test your connection and read permissions.

### 4. Setup and Start Frontend

Open a second terminal:

```bash
cd client
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## Environment Variables

### Backend (`server/.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Port for the Express API server |
| `NODE_ENV` | `development` | Environment mode (`development`, `production`, `test`) |
| `HOST` | `127.0.0.1` | Binding host (`0.0.0.0` in production) |
| `CORS_ORIGIN` | `http://localhost:3000` | Permitted frontend origins (comma-separated) |
| `GRAPH_NAME` | `sentinel` | Target FalkorDB graph identifier |
| `FALKORDB_HOST` | `127.0.0.1` | FalkorDB hostname (or cloud endpoint) |
| `FALKORDB_PORT` | `6379` | FalkorDB port number |
| `FALKORDB_USERNAME` | `default` | FalkorDB user (optional) |
| `FALKORDB_PASSWORD` | `—` | FalkorDB password (required for cloud instances) |
| `FALKORDB_TLS` | `false` | Enable TLS encryption (`true` for FalkorDB Cloud) |
| `FALKORDB_URL` | `—` | Single connection string (`falkors://...`) |
| `OSV_TIMEOUT_MS` | `10000` | Timeout per OSV query in milliseconds |

### Frontend (`client/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `""` *(uses Vite proxy in dev)* | Deployed backend URL (e.g. `https://api.onrender.com`) |

---

## Deployment Guide

### Frontend on Vercel
1. Import repository and set **Root Directory** to `client`.
2. Framework Preset: **Vite**.
3. Build Command: `npm run build`.
4. Output Directory: `dist`.
5. Environment Variable:
   - `VITE_API_BASE_URL` = `https://your-backend-api.onrender.com`

### Backend on Render
1. Create a **Web Service** with **Root Directory** set to `server`.
2. Runtime: **Node**.
3. Build Command: `npm install && npm run build`.
4. Start Command: `npm start`.
5. Health Check Path: `/health`.
6. Add environment variables: `NODE_ENV=production`, `GRAPH_NAME=supplychain_sentinel`, `CORS_ORIGIN=https://your-frontend.vercel.app`, and your FalkorDB Cloud credentials.

---

## Testing

```bash
# Run server test suite (220+ unit tests)
cd server
npm test

# Run TypeScript typechecks
npm run typecheck

# Verify graph database connectivity
npm run verify:graph
```

---

## Security

- Database credentials and API secrets are never committed to version control.
- In production, the backend enforces secure host and database validation safeguards to prevent unauthorized exposure.
