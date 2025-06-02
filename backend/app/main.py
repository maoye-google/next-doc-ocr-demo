import os
import io
import fitz  # PyMuPDF
from PIL import Image
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from paddleocr import PaddleOCR
from typing import List, Tuple, Any, Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize PaddleOCR
# This should be done once globally.
# use_gpu can be set based on environment variable or configuration
# For simplicity, keeping it False as per spec for default.
try:
    logger.info("Initializing PaddleOCR...")
    # Default to English, enable angle classification, disable GPU by default
    # Make sure your Docker image has the correct models or they will be downloaded on first run.
    # To specify model directory: ocr = PaddleOCR(det_model_dir='path/to/det_model', rec_model_dir='path/to/rec_model', cls_model_dir='path/to/cls_model', lang="en", use_angle_cls=True, use_gpu=False)
    # For CJK languages you might use lang='ch' or lang='japan' etc.
    ocr_instance = PaddleOCR(lang="en", use_angle_cls=True, use_gpu=False, show_log=True)
    logger.info("PaddleOCR initialized successfully.")
except Exception as e:
    logger.error(f"Error initializing PaddleOCR: {e}")
    ocr_instance = None

app = FastAPI(title="OCR Backend Service", version="1.0.0")

# CORS Configuration
# Adjust origins as needed for your frontend.
# Using "*" for development purposes.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# --- Pydantic Models for API Response ---

class OCRDetection(BaseModel):
    box: List[List[float]] = Field(..., description="Bounding box coordinates [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]")
    text: str = Field(..., description="Recognized text string")
    score: float = Field(..., description="Confidence score of the recognition")

class PageResult(BaseModel):
    page_number: int = Field(..., description="Page index (starting from 1)")
    detections: List[OCRDetection] = Field(..., description="List of detected text objects on the page")

class OCRResponse(BaseModel):
    success: bool = Field(..., description="Boolean indicating success")
    message: str = Field(..., description="Status or error message")
    results: Optional[List[PageResult]] = Field(None, description="OCR results per page")

# --- Helper Functions ---

def process_image_with_ocr(image_bytes: bytes) -> List[OCRDetection]:
    """Processes a single image (in bytes) using PaddleOCR and returns detections."""
    if not ocr_instance:
        raise HTTPException(status_code=500, detail="OCR service not initialized.")
    
    try:
        # Convert image bytes to a NumPy array
        image = Image.open(io.BytesIO(image_bytes))
        if image.mode == 'P' or image.mode == 'RGBA': # Convert palette or RGBA images to RGB
             image = image.convert('RGB')
        img_np = np.array(image)

        logger.info(f"Performing OCR on image with shape: {img_np.shape}")
        result = ocr_instance.ocr(img_np, cls=True) # cls=True uses the text angle classifier
        logger.info(f"PaddleOCR raw result: {result}") # Log raw result for debugging

        detections = []
        # PaddleOCR can return None if no text is found, or a list of lists.
        # Structure: result = [[box, (text, score)], [box, (text, score)], ...] for each detected line.
        # Sometimes result is [[[box, (text, score)], ...]] (nested list for an image)
        
        ocr_lines = result[0] if result and len(result) == 1 and isinstance(result[0], list) else result

        if ocr_lines: # Ensure ocr_lines is not None
            for line_info in ocr_lines:
                if line_info and len(line_info) == 2:
                    box = line_info[0]
                    text, score = line_info[1]
                    
                    # Ensure box is a list of 4 points, each point is [x, y]
                    # PaddleOCR box format: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
                    # Ensure all coordinates are floats
                    formatted_box = [[float(p[0]), float(p[1])] for p in box]

                    detections.append(OCRDetection(box=formatted_box, text=str(text), score=float(score)))
        return detections
    except Exception as e:
        logger.error(f"Error during OCR processing for an image: {e}", exc_info=True)
        # Depending on the error, you might want to re-raise or return empty detections
        raise HTTPException(status_code=500, detail=f"OCR processing failed for an image: {str(e)}")


def convert_pdf_to_images(file_bytes: bytes) -> List[bytes]:
    """Converts PDF file bytes into a list of image bytes (PNG format)."""
    images = []
    try:
        pdf_document = fitz.open(stream=file_bytes, filetype="pdf")
        for page_num in range(len(pdf_document)):
            page = pdf_document.load_page(page_num)
            # Render page to a pixmap (image)
            # Higher DPI for better OCR quality, e.g., 300 DPI
            pix = page.get_pixmap(dpi=300) 
            img_bytes = pix.tobytes("png") # Output as PNG bytes
            images.append(img_bytes)
        pdf_document.close()
    except Exception as e:
        logger.error(f"Error converting PDF to images: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"PDF processing failed: {str(e)}")
    return images

# --- API Endpoints ---

@app.get("/", summary="Root endpoint", response_model=dict)
async def read_root():
    """Returns a welcome message for the OCR backend service."""
    return {"message": "OCR Backend Service is running"}

@app.post("/ocr/process/", summary="Process an uploaded file (image or PDF) for OCR", response_model=OCRResponse)
async def ocr_process_file(file: UploadFile = File(...)):
    """
    Accepts an image or PDF file, performs OCR, and returns structured results.
    """
    if not ocr_instance:
        logger.error("OCR endpoint called but OCR instance is not available.")
        return OCRResponse(success=False, message="OCR service is not initialized or failed to load.", results=None)

    logger.info(f"Received file: {file.filename}, content type: {file.content_type}")

    # Validate file type
    if not file.content_type.startswith("image/") and file.content_type != "application/pdf":
        logger.warning(f"Invalid file type uploaded: {file.content_type}")
        raise HTTPException(status_code=400, detail=f"Invalid file type: {file.content_type}. Please upload an image or PDF.")

    try:
        contents = await file.read()
        await file.close() # Close the file as soon as possible

        all_page_results = []

        if file.content_type.startswith("image/"):
            logger.info(f"Processing uploaded image: {file.filename}")
            detections = process_image_with_ocr(contents)
            all_page_results.append(PageResult(page_number=1, detections=detections))
            message = "Image processed successfully."

        elif file.content_type == "application/pdf":
            logger.info(f"Processing uploaded PDF: {file.filename}")
            if not contents:
                 raise HTTPException(status_code=400, detail="Received empty PDF file.")
            
            image_bytes_list = convert_pdf_to_images(contents)
            if not image_bytes_list:
                logger.warning(f"PDF {file.filename} resulted in no images after conversion.")
                return OCRResponse(success=False, message="PDF processing failed to produce images.", results=None)

            for i, img_bytes in enumerate(image_bytes_list):
                logger.info(f"Performing OCR on page {i+1} of PDF {file.filename}")
                detections = process_image_with_ocr(img_bytes)
                all_page_results.append(PageResult(page_number=i + 1, detections=detections))
            message = f"PDF processed successfully, {len(image_bytes_list)} pages found."
        
        logger.info(f"Successfully processed {file.filename}. Pages: {len(all_page_results)}")
        return OCRResponse(success=True, message=message, results=all_page_results)

    except HTTPException as he:
        # Re-raise HTTPExceptions to be handled by FastAPI
        logger.error(f"HTTPException during processing {file.filename}: {he.detail}")
        raise he 
    except Exception as e:
        logger.error(f"An unexpected error occurred while processing {file.filename}: {e}", exc_info=True)
        return OCRResponse(success=False, message=f"An unexpected error occurred: {str(e)}", results=None)

if __name__ == "__main__":
    # This part is for local development testing (not used by Uvicorn in Docker)
    import uvicorn
    logger.info("Starting Uvicorn server for local development on http://localhost:8000")
    # Note: PaddleOCR model download might happen on first run here.
    uvicorn.run(app, host="0.0.0.0", port=8000)
