# React + Vite Starter App

## Overview
A fresh React + TypeScript application scaffolded with Vite. This is a clean starting point for building a web application.

## Tech Stack
- **Frontend**: React 19, TypeScript
- **Build tool**: Vite 8
- **Package manager**: npm (Node.js 20)

## Project Structure
```
/
├── src/              # React source code
│   ├── App.tsx       # Root component
│   ├── main.tsx      # Entry point
│   └── assets/       # Static assets
├── public/           # Public static files
├── index.html        # HTML entry point
├── vite.config.ts    # Vite configuration (port 5000, host 0.0.0.0)
└── package.json      # Dependencies and scripts
```

## Development
- Runs on port 5000 (configured for Replit preview)
- Host set to `0.0.0.0` with `allowedHosts: true` for proxy compatibility

## Deployment
- Configured as a static site
- Build command: `npm run build`
- Output directory: `dist`
