# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Frontend (doc-ocr-frontend)
- `cd doc-ocr-frontend && npm run dev` - Start React development server with HMR
- `cd doc-ocr-frontend && npm run build` - Build React app for production 
- `cd doc-ocr-frontend && npm run lint` - Run ESLint on frontend files
- `cd doc-ocr-frontend && npm run preview` - Preview production build locally

### Full Stack (Docker)
- `docker-compose up` - Start both frontend and backend services
- `docker-compose up --build` - Rebuild and start services
- `docker-compose down` - Stop all services

### Backend (doc-ocr-backend)
- Backend runs on FastAPI with Uvicorn server
- Direct Python execution: `cd doc-ocr-backend && python app/main.py`

## Project Architecture

This is a full-stack OCR application with Docker containerization:

**Frontend (`doc-ocr-frontend/`):**
- React 18 + Vite application for document upload and OCR result visualization
- Uses Axios for API communication with backend
- PDF.js for PDF rendering and overlay of OCR bounding boxes
- File upload supporting images (JPG, PNG, etc.) and PDF documents

**Backend (`doc-ocr-backend/`):**
- FastAPI service providing OCR processing endpoints
- PaddleOCR for text detection and recognition
- PyMuPDF for PDF to image conversion 
- Supports both single images and multi-page PDF processing
- Returns structured JSON with bounding boxes, text, and confidence scores

**Docker Architecture:**
- Multi-service setup with `doc-ocr-backend` and `doc-ocr-frontend` containers
- Backend exposes port 8000, frontend on configurable port (default 5173)
- Shared network `ocr_network` for inter-service communication
- Volume mounts for development hot-reloading
- Persistent volume for PaddleOCR model caching

## Key Files

**Frontend:**
- `doc-ocr-frontend/src/App.jsx` - Main application component handling file upload and OCR workflow
- `doc-ocr-frontend/src/components/FileUploader.jsx` - File selection and upload component
- `doc-ocr-frontend/src/components/DocumentViewer.jsx` - Document display with OCR overlay
- `doc-ocr-frontend/.env` - Environment configuration for API URL

**Backend:**
- `doc-ocr-backend/app/main.py` - FastAPI application with OCR endpoints
- `doc-ocr-backend/requirements.txt` - Python dependencies including PaddleOCR, FastAPI
- `doc-ocr-backend/Dockerfile` - Backend container configuration

**Infrastructure:**
- `docker-compose.yml` - Multi-service orchestration
- `credentials/` - Service account keys (do not commit changes)

## API Integration

- Frontend communicates with backend via `/api/ocr/process/` endpoint
- Backend expects multipart/form-data file uploads
- Returns structured OCR results with page-wise detections
- CORS configured for cross-origin requests in development

## Performance Notes

- **PDF Processing**: Large PDFs may take several minutes to process
- **Timeouts**: Frontend configured with 5-minute timeout for PDF processing
- **Image Quality**: PDF pages rendered at 120 DPI for optimal speed/quality balance
- **Memory**: PaddleOCR models are cached for better performance