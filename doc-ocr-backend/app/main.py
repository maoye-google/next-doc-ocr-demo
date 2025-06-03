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
    print("=== Starting PaddleOCR initialization ===")
    # Try minimal initialization
    ocr_instance = PaddleOCR(lang='en')
    logger.info(f"PaddleOCR instance type: {type(ocr_instance)}")
    logger.info(f"PaddleOCR methods: {[method for method in dir(ocr_instance) if not method.startswith('_')]}")
    logger.info("PaddleOCR initialized successfully.")
    print("=== PaddleOCR initialization completed ===")
except Exception as e:
    logger.error(f"Error initializing PaddleOCR: {e}")
    print(f"=== PaddleOCR initialization failed: {e} ===")
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
    language: Optional[str] = Field(None, description="Detected language of the text")

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
    print("=== FUNCTION START: process_image_with_ocr ===")
    logger.info("=== Starting process_image_with_ocr function ===")
    
    try:
        if not ocr_instance:
            print("=== OCR INSTANCE IS NONE IN FUNCTION ===")
            raise HTTPException(status_code=500, detail="OCR service not initialized.")
        
        print("=== STEP 1: About to process image bytes ===")
        # Convert image bytes to a NumPy array
        image = Image.open(io.BytesIO(image_bytes))
        print("=== STEP 2: Opened image with PIL ===")
        if image.mode == 'P' or image.mode == 'RGBA': # Convert palette or RGBA images to RGB
             image = image.convert('RGB')
        print("=== STEP 3: Converted image mode if needed ===")
        img_np = np.array(image)
        print("=== STEP 4: Converted to numpy array ===")
        print(f"=== Image shape: {img_np.shape} ===")

        print("=== STEP 5: About to call PaddleOCR ===")
        logger.info(f"Performing OCR on image with shape: {img_np.shape}")
        result = ocr_instance.ocr(img_np) # Remove cls parameter for compatibility
        print("=== STEP 6: PaddleOCR call completed ===")
        print(f"=== STEP 7: Result type: {type(result)} ===")
        logger.info(f"PaddleOCR raw result type: {type(result)}")
        
        if isinstance(result, dict):
            print(f"=== STEP 8: Result is dict with keys: {list(result.keys())} ===")
            logger.info(f"PaddleOCR result keys: {result.keys()}")
        else:
            print(f"=== STEP 8: Result is not dict, value: {result} ===")
            logger.info(f"PaddleOCR result value: {result}")

        detections = []
        print("=== STEP 9: Starting result processing ===")
        
        # Handle the new PaddleOCR API - check if result is a list containing a dictionary
        if isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict):
            print("=== STEP 10: Result is list containing dictionary ===")
            result = result[0]  # Extract the dictionary from the list
        
        if isinstance(result, dict):
            logger.info("Processing new PaddleOCR dictionary format")
            
            # Extract polygons and recognized text
            if 'rec_polys' in result and 'rec_texts' in result and 'rec_scores' in result:
                polygons = result['rec_polys']
                texts = result['rec_texts']
                scores = result['rec_scores']
                
                logger.info(f"Found {len(polygons)} polygons, {len(texts)} texts, {len(scores)} scores")
                
                # Process each detection
                for i, (polygon, text, score) in enumerate(zip(polygons, texts, scores)):
                    logger.info(f"Detection {i}: text='{text}', score={score}")
                    
                    # Convert polygon to box format [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
                    # polygon is a numpy array of shape (N, 2) where N >= 4
                    if len(polygon) >= 4:
                        # Take first 4 points to create a box
                        formatted_box = [[float(polygon[j][0]), float(polygon[j][1])] for j in range(4)]
                        detections.append(OCRDetection(box=formatted_box, text=str(text), score=float(score)))
                    else:
                        logger.warning(f"Polygon {i} has insufficient points: {len(polygon)}")
                        
            else:
                logger.warning(f"Expected keys not found in result. Available keys: {list(result.keys())}")
                
        elif isinstance(result, list):
            logger.info("Processing legacy PaddleOCR list format")
            # Handle the old list format for backwards compatibility
            if len(result) > 0 and isinstance(result[0], list):
                ocr_lines = result[0]
            else:
                ocr_lines = result
                
            for i, line_info in enumerate(ocr_lines):
                if line_info and len(line_info) == 2:
                    box = line_info[0]
                    text, score = line_info[1]
                    
                    logger.info(f"Detected text: '{text}' with score: {score}")
                    formatted_box = [[float(p[0]), float(p[1])] for p in box]
                    detections.append(OCRDetection(box=formatted_box, text=str(text), score=float(score)))
        else:
            logger.warning(f"Unexpected result type: {type(result)}")
            
        logger.info(f"Final detection count: {len(detections)}")
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
            # Use lower DPI for faster processing of large PDFs
            pix = page.get_pixmap(dpi=120)  # Reduced from 150 to 120 for better speed 
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

@app.post("/api/ocr/process/", summary="Process an uploaded file (image or PDF) for OCR", response_model=OCRResponse)
async def ocr_process_file(file: UploadFile = File(...)):
    """
    Accepts an image or PDF file, performs OCR, and returns structured results.
    """
    logger.info("=== OCR ENDPOINT CALLED ===")
    print("=== OCR ENDPOINT CALLED ===")  # Extra debug
    print(f"=== OCR instance status: {ocr_instance is not None} ===")
    logger.info(f"OCR instance status: {ocr_instance is not None}")
    if not ocr_instance:
        logger.error("OCR endpoint called but OCR instance is not available.")
        print("=== OCR INSTANCE IS NONE ===")
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
            print(f"=== About to call process_image_with_ocr for {file.filename} ===")
            detections = process_image_with_ocr(contents)
            print(f"=== process_image_with_ocr returned {len(detections)} detections ===")
            logger.info(f"Got {len(detections)} detections from OCR")
            all_page_results.append(PageResult(page_number=1, detections=detections))
            message = "Image processed successfully."

        elif file.content_type == "application/pdf":
            logger.info(f"Processing uploaded PDF: {file.filename}")
            if not contents:
                 raise HTTPException(status_code=400, detail="Received empty PDF file.")
            
            logger.info(f"Converting PDF {file.filename} to images...")
            image_bytes_list = convert_pdf_to_images(contents)
            logger.info(f"PDF converted to {len(image_bytes_list)} images")
            if not image_bytes_list:
                logger.warning(f"PDF {file.filename} resulted in no images after conversion.")
                return OCRResponse(success=False, message="PDF processing failed to produce images.", results=None)

            for i, img_bytes in enumerate(image_bytes_list):
                logger.info(f"Performing OCR on page {i+1}/{len(image_bytes_list)} of PDF {file.filename}")
                detections = process_image_with_ocr(img_bytes)
                all_page_results.append(PageResult(page_number=i + 1, detections=detections))
                logger.info(f"Completed OCR for page {i+1}, found {len(detections)} text regions")
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
