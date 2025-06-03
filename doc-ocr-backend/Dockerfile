# Base image
FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Install system dependencies for PaddleOCR and PDF processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libgl1 \
    libglib2.0-0 \
    poppler-utils \
    # Additional dependencies that might be needed by PaddleOCR or its dependencies
    libxext6 \
    libsm6 \
    libxrender1 \
    libfontconfig1 \
    libice6 \
    # libgtk2.0-dev \ # Often needed for opencv-python UIs, but headless should be fine
    # Ensure all necessary build tools are present for pip installs
    gcc \
    g++ \
    make \
    # Clean up apt cache
    && rm -rf /var/lib/apt/lists/*

# Copy requirements.txt and install Python dependencies
COPY requirements.txt requirements.txt

# Install numpy first to avoid ABI conflicts
RUN pip install --no-cache-dir numpy==1.21.6

# Install remaining dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY ./app /app/app

# Expose port 8000
EXPOSE 8000

# Command to run FastAPI using uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]