# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development server with HMR
- `npm run build` - Build for production (runs TypeScript compilation + Vite build)
- `npm run lint` - Run ESLint on all files
- `npm run preview` - Preview production build locally

## Project Architecture

This is a React + TypeScript + Vite application with a minimal setup:

- **Build Tool**: Vite with React plugin for fast development and HMR
- **TypeScript Configuration**: Uses project references with separate configs for app (`tsconfig.app.json`) and node (`tsconfig.node.json`)
- **Entry Point**: `src/main.tsx` renders the root `App` component with React 19 StrictMode
- **Styling**: CSS modules approach with component-specific stylesheets

## Key Files

- `src/App.tsx` - Main application component
- `src/main.tsx` - Application entry point and root rendering
- `vite.config.ts` - Vite configuration with React plugin
- `credentials/claude-code-sa-key.json` - Service account credentials (do not commit changes to this file)

## TypeScript Setup

The project uses TypeScript 5.8 with strict configuration and React 19 types. The build process runs TypeScript compilation before Vite bundling.