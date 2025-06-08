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
import base64
import json
import uuid
from datetime import datetime
import asyncio
from pymongo import MongoClient
from kafka import KafkaProducer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment variables
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017/ocr_demo")

# Global variables for connections
kafka_producer = None
mongo_client = None
mongo_db = None
job_polling_task = None

# Initialize PaddleOCR
# This should be done once globally.
# use_gpu can be set based on environment variable or configuration
# For simplicity, keeping it False as per spec for default.
try:
    logger.info("Initializing PaddleOCR...")
    print("=== Starting PaddleOCR initialization ===")
    # Try minimal initialization
    ocr_instance = PaddleOCR(lang='japan')
    logger.info(f"PaddleOCR instance type: {type(ocr_instance)}")
    logger.info(f"PaddleOCR methods: {[method for method in dir(ocr_instance) if not method.startswith('_')]}")
    logger.info("PaddleOCR initialized successfully.")
    print("=== PaddleOCR initialization completed ===")
except Exception as e:
    logger.error(f"Error initializing PaddleOCR: {e}")
    print(f"=== PaddleOCR initialization failed: {e} ===")
    ocr_instance = None

app = FastAPI(title="OCR Backend Service", version="2.0.0")

@app.on_event("startup")
async def startup_event():
    """Initialize connections and start background tasks on startup"""
    global job_polling_task
    logger.info("=== APPLICATION STARTUP EVENT TRIGGERED ===")
    print("=== APPLICATION STARTUP EVENT TRIGGERED ===")  # Also print to stdout
    
    try:
        init_connections()
        logger.info("=== CONNECTIONS INITIALIZED ===")
        print("=== CONNECTIONS INITIALIZED ===")
        
        # Start job completion monitoring
        job_polling_task = asyncio.create_task(job_completion_monitor())
        logger.info("=== JOB POLLING TASK STARTED ===")
        print("=== JOB POLLING TASK STARTED ===")
        
    except Exception as e:
        logger.error(f"=== STARTUP FAILED: {e} ===")
        print(f"=== STARTUP FAILED: {e} ===")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up connections on shutdown"""
    if job_polling_task:
        job_polling_task.cancel()
    if kafka_producer:
        kafka_producer.close()
    if mongo_client:
        mongo_client.close()

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

class ManualOCRRequest(BaseModel):
    page_data: str = Field(..., description="Base64 encoded image data")
    coordinates: dict = Field(..., description="Selection coordinates {startX, startY, endX, endY}")
    page_index: int = Field(..., description="Page index (0-based)")

class ManualOCRResponse(BaseModel):
    success: bool = Field(..., description="Boolean indicating success")
    message: str = Field(..., description="Status or error message")
    detections: Optional[List[OCRDetection]] = Field(None, description="OCR results for the selected area")

class LLMProcessRequest(BaseModel):
    llm_model: str = Field(..., description="LLM model to use (gemini-2.0-flash, gemini-2.5-pro)")

class LLMProcessResponse(BaseModel):
    success: bool = Field(..., description="Boolean indicating success")
    message: str = Field(..., description="Status message")
    job_id: Optional[str] = Field(None, description="Job ID for tracking")

class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: dict
    results: Optional[dict] = None

class DocumentHistory(BaseModel):
    documents: List[dict]
    total: int

# --- Database and Messaging Functions ---

def init_database_schema():
    """Initialize database collections and indexes"""
    if mongo_db is None:
        logger.warning("MongoDB not available for schema initialization")
        return
    
    try:
        # Create indexes for better performance
        logger.info("Initializing database schema...")
        
        # Jobs collection indexes
        mongo_db.jobs.create_index("job_id", unique=True)
        mongo_db.jobs.create_index("status")
        mongo_db.jobs.create_index("created_at")
        
        # Page results collection indexes
        mongo_db.page_results.create_index([("job_id", 1), ("page_number", 1)], unique=True)
        mongo_db.page_results.create_index("job_id")
        
        # Final results collection indexes
        mongo_db.final_results.create_index("job_id", unique=True)
        
        logger.info("Database schema initialized successfully")
        
    except Exception as e:
        logger.error(f"Failed to initialize database schema: {e}")

def init_connections():
    """Initialize database and message queue connections"""
    global kafka_producer, mongo_client, mongo_db
    
    logger.info("=== INITIALIZING CONNECTIONS ===")
    
    try:
        # Initialize MongoDB
        logger.info(f"=== CONNECTING TO MONGODB ===")
        logger.info(f"MongoDB URL: {MONGODB_URL}")
        mongo_client = MongoClient(MONGODB_URL)
        mongo_db = mongo_client.get_default_database()
        
        # Test MongoDB connection
        mongo_client.admin.command('ping')
        logger.info("=== MONGODB CONNECTION SUCCESSFUL ===")
        
        # Initialize database schema
        init_database_schema()
        
        # Initialize Kafka Producer with retry logic
        logger.info(f"=== CONNECTING TO KAFKA ===")
        logger.info(f"Kafka bootstrap servers: {KAFKA_BOOTSTRAP_SERVERS}")
        
        max_retries = 5
        retry_delay = 2
        
        for attempt in range(max_retries):
            try:
                kafka_producer = KafkaProducer(
                    bootstrap_servers=[KAFKA_BOOTSTRAP_SERVERS],
                    value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                    retries=3,
                    request_timeout_ms=30000,
                    api_version=(0, 10, 1)
                )
                logger.info("=== KAFKA PRODUCER INITIALIZED SUCCESSFULLY ===")
                logger.info(f"=== KAFKA PRODUCER OBJECT: {kafka_producer} ===")
                break
            except Exception as kafka_error:
                logger.warning(f"=== KAFKA CONNECTION ATTEMPT {attempt + 1}/{max_retries} FAILED ===")
                logger.warning(f"Error: {kafka_error}")
                if attempt < max_retries - 1:
                    logger.info(f"=== RETRYING IN {retry_delay} SECONDS ===")
                    import time
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    logger.error("=== ALL KAFKA CONNECTION ATTEMPTS FAILED ===")
                    raise kafka_error
        
        logger.info("=== ALL CONNECTIONS INITIALIZED ===")
        
    except Exception as e:
        logger.error(f"=== CONNECTION INITIALIZATION FAILED ===")
        logger.error(f"Error: {e}")
        logger.error(f"Exception type: {type(e).__name__}")
        logger.error(f"=== KAFKA PRODUCER STATUS AFTER ERROR: {kafka_producer} ===")
        # Continue without distributed features for demo

def create_job_record(job_id: str, filename: str, file_type: str, total_pages: int, llm_model: str) -> dict:
    """Create a new job record in MongoDB"""
    job_record = {
        "job_id": job_id,
        "file_name": filename,
        "file_type": file_type,
        "total_pages": total_pages,
        "processed_pages": 0,
        "llm_model": llm_model,
        "processing_type": "llm",
        "status": "processing",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "completed_at": None,
        "analysis_duration_seconds": None
    }
    
    if mongo_db is not None:
        mongo_db.jobs.insert_one(job_record)
        logger.info(f"Created job record: {job_id}")
    
    return job_record

def publish_page_to_kafka(job_id: str, page_number: int, image_data: str, llm_model: str):
    """Publish page image to Kafka for processing"""
    if not kafka_producer:
        logger.error("=== KAFKA PRODUCER NOT AVAILABLE ===")
        logger.error(f"Attempted to publish page {page_number} for job {job_id} but Kafka producer is None")
        return
        
    message = {
        "job_id": job_id,
        "page_number": page_number,
        "image_data": image_data[:100] + "..." if len(image_data) > 100 else image_data,  # Truncate for logging
        "llm_model": llm_model
    }
    
    logger.info(f"=== SENDING TO KAFKA ===")
    logger.info(f"Topic: page-processing-topic")
    logger.info(f"Job ID: {job_id}")
    logger.info(f"Page: {page_number}")
    logger.info(f"Model: {llm_model}")
    logger.info(f"Image data length: {len(image_data)} characters")
    logger.info(f"Kafka producer status: {kafka_producer is not None}")
    
    # Create the actual message (with full image data)
    full_message = {
        "job_id": job_id,
        "page_number": page_number,
        "image_data": image_data,
        "llm_model": llm_model
    }
    
    try:
        future = kafka_producer.send('page-processing-topic', value=full_message)
        kafka_producer.flush()
        logger.info(f"=== KAFKA SEND SUCCESS ===")
        logger.info(f"Successfully published page {page_number} for job {job_id} to Kafka")
        logger.info(f"Message size: {len(json.dumps(full_message))} bytes")
    except Exception as e:
        logger.error(f"=== KAFKA SEND FAILED ===")
        logger.error(f"Failed to publish to Kafka: {e}")
        logger.error(f"Exception type: {type(e).__name__}")
        logger.error(f"Kafka producer bootstrap servers: {KAFKA_BOOTSTRAP_SERVERS}")

def publish_aggregation_signal(job_id: str, llm_model: str, total_pages: int):
    """Publish aggregation signal to Kafka"""
    if not kafka_producer:
        logger.error("=== KAFKA PRODUCER NOT AVAILABLE FOR AGGREGATION ===")
        logger.error(f"Attempted to publish aggregation for job {job_id} but Kafka producer is None")
        return
        
    message = {
        "job_id": job_id,
        "llm_model": llm_model,
        "total_pages": total_pages
    }
    
    logger.info(f"=== SENDING AGGREGATION SIGNAL TO KAFKA ===")
    logger.info(f"Topic: aggregation-trigger-topic")
    logger.info(f"Job ID: {job_id}")
    logger.info(f"Model: {llm_model}")
    logger.info(f"Total Pages: {total_pages}")
    
    try:
        future = kafka_producer.send('aggregation-trigger-topic', value=message)
        kafka_producer.flush()
        logger.info(f"=== AGGREGATION SIGNAL SENT SUCCESS ===")
        logger.info(f"Published aggregation signal for job {job_id}")
    except Exception as e:
        logger.error(f"=== AGGREGATION SIGNAL SEND FAILED ===")
        logger.error(f"Failed to publish aggregation signal: {e}")
        logger.error(f"Exception type: {type(e).__name__}")

async def job_completion_monitor():
    """Background task to monitor job completion every 5 seconds"""
    while True:
        try:
            await asyncio.sleep(5)  # 5-second polling interval
            
            if mongo_db is None:
                continue
                
            # Find jobs that are processing
            processing_jobs = mongo_db.jobs.find({"status": "processing"})
            
            for job in processing_jobs:
                job_id = job["job_id"]
                total_pages = job["total_pages"]
                
                # Count completed pages
                completed_pages = mongo_db.page_results.count_documents({
                    "job_id": job_id,
                    "status": "completed"
                })
                
                # Update progress
                mongo_db.jobs.update_one(
                    {"job_id": job_id},
                    {"$set": {"processed_pages": completed_pages, "updated_at": datetime.utcnow()}}
                )
                
                # Check if all pages are completed
                if completed_pages >= total_pages:
                    logger.info(f"Job {job_id} ready for aggregation")
                    publish_aggregation_signal(job_id, job["llm_model"], total_pages)
                    
        except Exception as e:
            logger.error(f"Error in job completion monitor: {e}")

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
            pix = page.get_pixmap(dpi=300)  # Reduced from 150 to 120 for better speed 
            # pix = page.get_pixmap(dpi=120)  # Reduced from 150 to 120 for better speed 
            img_bytes = pix.tobytes("png") # Output as PNG bytes
            images.append(img_bytes)
        pdf_document.close()
    except Exception as e:
        logger.error(f"Error converting PDF to images: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"PDF processing failed: {str(e)}")
    return images

def process_cropped_area_with_ocr(image_bytes: bytes, coordinates: dict) -> List[OCRDetection]:
    """Processes a cropped area of an image using PaddleOCR and returns detections."""
    try:
        if not ocr_instance:
            raise HTTPException(status_code=500, detail="OCR service not initialized.")
        
        # Convert image bytes to PIL Image
        image = Image.open(io.BytesIO(image_bytes))
        if image.mode == 'P' or image.mode == 'RGBA':
            image = image.convert('RGB')
        
        # Crop the image to the specified coordinates
        startX = int(coordinates['startX'])
        startY = int(coordinates['startY'])
        endX = int(coordinates['endX'])
        endY = int(coordinates['endY'])
        
        # Ensure coordinates are within image bounds
        startX = max(0, min(startX, image.width))
        startY = max(0, min(startY, image.height))
        endX = max(startX, min(endX, image.width))
        endY = max(startY, min(endY, image.height))
        
        cropped_image = image.crop((startX, startY, endX, endY))
        
        # Convert to numpy array for PaddleOCR
        img_np = np.array(cropped_image)
        
        logger.info(f"Processing cropped area: ({startX},{startY}) to ({endX},{endY}), cropped size: {img_np.shape}")
        
        # Perform OCR on the cropped area
        result = ocr_instance.ocr(img_np)
        
        detections = []
        
        # Handle the new PaddleOCR API - check if result is a list containing a dictionary
        if isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict):
            result = result[0]  # Extract the dictionary from the list
        
        if isinstance(result, dict):
            # Extract polygons and recognized text
            if 'rec_polys' in result and 'rec_texts' in result and 'rec_scores' in result:
                polygons = result['rec_polys']
                texts = result['rec_texts']
                scores = result['rec_scores']
                
                # Process each detection and adjust coordinates back to original image space
                for i, (polygon, text, score) in enumerate(zip(polygons, texts, scores)):
                    # Convert polygon to box format and adjust coordinates
                    if len(polygon) >= 4:
                        # Adjust coordinates back to original image space
                        adjusted_box = [
                            [float(polygon[j][0]) + startX, float(polygon[j][1]) + startY] 
                            for j in range(4)
                        ]
                        detections.append(OCRDetection(box=adjusted_box, text=str(text), score=float(score)))
                        
        elif isinstance(result, list):
            # Handle legacy format
            if len(result) > 0 and isinstance(result[0], list):
                ocr_lines = result[0]
            else:
                ocr_lines = result
                
            for line_info in ocr_lines:
                if line_info and len(line_info) == 2:
                    box = line_info[0]
                    text, score = line_info[1]
                    
                    # Adjust coordinates back to original image space
                    adjusted_box = [
                        [float(p[0]) + startX, float(p[1]) + startY] 
                        for p in box
                    ]
                    detections.append(OCRDetection(box=adjusted_box, text=str(text), score=float(score)))
        
        logger.info(f"Manual OCR found {len(detections)} detections in cropped area")
        return detections
        
    except Exception as e:
        logger.error(f"Error during manual OCR processing: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Manual OCR processing failed: {str(e)}")

# --- Enhanced OCR Processing for LLM ---

def process_file_for_llm(file_bytes: bytes, filename: str, content_type: str, llm_model: str) -> str:
    """Process file and send pages to distributed LLM processing"""
    job_id = str(uuid.uuid4())
    
    logger.info(f"=== STARTING LLM PROCESSING ===")
    logger.info(f"Job ID: {job_id}")
    logger.info(f"Filename: {filename}")
    logger.info(f"Content Type: {content_type}")
    logger.info(f"LLM Model: {llm_model}")
    logger.info(f"File size: {len(file_bytes)} bytes")
    
    try:
        logger.info(f"=== CHECKING CONTENT TYPE: {content_type} ===")
        print(f"=== CHECKING CONTENT TYPE: {content_type} ===")
        
        if content_type.startswith("image/"):
            # Single image
            logger.info(f"=== PROCESSING SINGLE IMAGE: {filename} ===")
            print(f"=== PROCESSING SINGLE IMAGE: {filename} ===")
            image_data = base64.b64encode(file_bytes).decode('utf-8')
            logger.info(f"Base64 encoded image length: {len(image_data)} characters")
            
            logger.info("=== CREATING JOB RECORD FOR IMAGE ===")
            create_job_record(job_id, filename, "image", 1, llm_model)
            logger.info("=== PUBLISHING IMAGE TO KAFKA ===")
            publish_page_to_kafka(job_id, 1, image_data, llm_model)
            
        elif content_type == "application/pdf":
            # Multi-page PDF
            logger.info(f"=== PROCESSING PDF: {filename} ===")
            print(f"=== PROCESSING PDF: {filename} ===")
            
            logger.info("=== CALLING convert_pdf_to_images ===")
            print("=== CALLING convert_pdf_to_images ===")
            image_bytes_list = convert_pdf_to_images(file_bytes)
            total_pages = len(image_bytes_list)
            
            logger.info(f"=== PDF CONVERTED TO {total_pages} PAGES ===")
            print(f"=== PDF CONVERTED TO {total_pages} PAGES ===")
            
            logger.info("=== CREATING JOB RECORD FOR PDF ===")
            create_job_record(job_id, filename, "pdf", total_pages, llm_model)
            
            for i, img_bytes in enumerate(image_bytes_list):
                logger.info(f"=== PROCESSING PAGE {i + 1}/{total_pages} ===")
                print(f"=== PROCESSING PAGE {i + 1}/{total_pages} ===")
                
                try:
                    logger.info(f"=== ENCODING PAGE {i + 1} TO BASE64 ===")
                    print(f"=== ENCODING PAGE {i + 1} TO BASE64 ===")
                    image_data = base64.b64encode(img_bytes).decode('utf-8')
                    logger.info(f"Page {i + 1} base64 length: {len(image_data)} characters")
                    print(f"Page {i + 1} base64 length: {len(image_data)} characters")
                    
                    logger.info(f"=== PUBLISHING PAGE {i + 1} TO KAFKA ===")
                    print(f"=== PUBLISHING PAGE {i + 1} TO KAFKA ===")
                    publish_page_to_kafka(job_id, i + 1, image_data, llm_model)
                    logger.info(f"=== PAGE {i + 1} KAFKA PUBLISH COMPLETED ===")
                    print(f"=== PAGE {i + 1} KAFKA PUBLISH COMPLETED ===")
                    
                except Exception as page_error:
                    logger.error(f"=== ERROR PROCESSING PAGE {i + 1} ===")
                    logger.error(f"Error: {page_error}")
                    logger.error(f"Exception type: {type(page_error).__name__}")
                    print(f"=== ERROR PROCESSING PAGE {i + 1}: {page_error} ===")
                    raise page_error
        else:
            logger.error(f"=== UNSUPPORTED CONTENT TYPE: {content_type} ===")
            print(f"=== UNSUPPORTED CONTENT TYPE: {content_type} ===")
                
        logger.info(f"=== LLM PROCESSING JOB STARTED ===")
        logger.info(f"Job ID: {job_id} for file: {filename}")
        return job_id
        
    except Exception as e:
        logger.error(f"=== LLM PROCESSING FAILED ===")
        logger.error(f"Error processing file for LLM: {e}")
        logger.error(f"Exception type: {type(e).__name__}")
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")

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

@app.post("/api/ocr/manual/", summary="Process manually selected area for OCR", response_model=ManualOCRResponse)
async def ocr_manual_area(request: ManualOCRRequest):
    """
    Accepts base64 image data and coordinates for a manually selected area,
    performs OCR on that specific area, and returns structured results.
    """
    logger.info("=== MANUAL OCR ENDPOINT CALLED ===")
    
    if not ocr_instance:
        logger.error("Manual OCR endpoint called but OCR instance is not available.")
        return ManualOCRResponse(success=False, message="OCR service is not initialized or failed to load.", detections=None)

    try:
        # Decode base64 image data
        image_data = base64.b64decode(request.page_data.split(',')[1] if ',' in request.page_data else request.page_data)
        
        logger.info(f"Processing manual selection: coordinates={request.coordinates}, page_index={request.page_index}")
        
        # Process the cropped area
        detections = process_cropped_area_with_ocr(image_data, request.coordinates)
        
        message = f"Manual OCR processed successfully, found {len(detections)} text regions."
        logger.info(f"Manual OCR completed: {len(detections)} detections")
        
        return ManualOCRResponse(success=True, message=message, detections=detections)

    except Exception as e:
        logger.error(f"An unexpected error occurred during manual OCR: {e}", exc_info=True)
        return ManualOCRResponse(success=False, message=f"An unexpected error occurred: {str(e)}", detections=None)

@app.post("/api/llm/process/", summary="Process an uploaded file with LLM", response_model=LLMProcessResponse)
async def llm_process_file(file: UploadFile = File(...), llm_model: str = Form(...)):
    """
    Accepts an image or PDF file, processes it with distributed LLM pipeline.
    """
    logger.info("=== LLM ENDPOINT CALLED ===")
    print("=== LLM ENDPOINT CALLED ===")  # Also print to stdout
    logger.info(f"=== LLM PROCESSING REQUESTED ===")
    logger.info(f"File: {file.filename}")
    logger.info(f"Model: {llm_model}")
    logger.info(f"Content Type: {file.content_type}")
    print(f"=== LLM processing requested: {file.filename}, model: {llm_model} ===")
    
    # Pass model name directly to processing service without validation
    
    # Validate file type
    if not file.content_type.startswith("image/") and file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail=f"Invalid file type: {file.content_type}")
    
    try:
        logger.info("=== READING FILE CONTENTS ===")
        print("=== READING FILE CONTENTS ===")
        contents = await file.read()
        await file.close()
        logger.info(f"=== FILE READ COMPLETE - SIZE: {len(contents)} bytes ===")
        print(f"=== FILE READ COMPLETE - SIZE: {len(contents)} bytes ===")
        
        # Check Kafka producer status before processing
        logger.info(f"=== KAFKA PRODUCER STATUS: {kafka_producer is not None} ===")
        print(f"=== KAFKA PRODUCER STATUS: {kafka_producer is not None} ===")
        
        # Process file for distributed LLM processing
        logger.info("=== CALLING process_file_for_llm ===")
        print("=== CALLING process_file_for_llm ===")
        job_id = process_file_for_llm(contents, file.filename, file.content_type, llm_model)
        logger.info(f"=== process_file_for_llm RETURNED JOB ID: {job_id} ===")
        print(f"=== process_file_for_llm RETURNED JOB ID: {job_id} ===")
        
        return LLMProcessResponse(
            success=True,
            message="LLM processing started",
            job_id=job_id
        )
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error in LLM processing: {e}")
        return LLMProcessResponse(
            success=False,
            message=f"Processing failed: {str(e)}",
            job_id=None
        )

@app.get("/api/documents/{job_id}/status", summary="Get job status", response_model=JobStatus)
async def get_job_status(job_id: str):
    """
    Get the current status of a processing job.
    """
    if mongo_db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Get job record
        job = mongo_db.jobs.find_one({"job_id": job_id})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        progress = {
            "total_pages": job["total_pages"],
            "processed_pages": job["processed_pages"],
            "percentage": (job["processed_pages"] / job["total_pages"]) * 100 if job["total_pages"] > 0 else 0
        }
        
        results = None
        if job["status"] == "completed":
            # Get final results
            final_result = mongo_db.final_results.find_one({"job_id": job_id})
            if final_result:
                results = {
                    "document_overview": final_result.get("document_overview"),
                    "markdown_content": final_result.get("markdown_content")
                }
        
        return JobStatus(
            job_id=job_id,
            status=job["status"],
            progress=progress,
            results=results
        )
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error getting job status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get job status")

@app.get("/api/documents/history", summary="Get document processing history", response_model=DocumentHistory)
async def get_document_history():
    """
    Get the history of all processed documents.
    """
    if mongo_db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Get all jobs, sorted by creation time (newest first)
        jobs = list(mongo_db.jobs.find().sort("created_at", -1))
        
        documents = []
        for job in jobs:
            # Calculate duration if completed
            duration_seconds = None
            if job.get("completed_at") and job.get("created_at"):
                duration = job["completed_at"] - job["created_at"]
                duration_seconds = int(duration.total_seconds())
            
            documents.append({
                "job_id": job["job_id"],
                "file_name": job["file_name"],
                "file_type": job["file_type"],
                "total_pages": job["total_pages"],
                "processing_type": job["processing_type"],
                "llm_model": job.get("llm_model"),
                "status": job["status"],
                "created_at": job["created_at"].isoformat(),
                "completed_at": job["completed_at"].isoformat() if job.get("completed_at") else None,
                "duration_seconds": duration_seconds
            })
        
        return DocumentHistory(
            documents=documents,
            total=len(documents)
        )
        
    except Exception as e:
        logger.error(f"Error getting document history: {e}")
        raise HTTPException(status_code=500, detail="Failed to get document history")

@app.delete("/api/documents/all", summary="Delete all documents")
async def delete_all_documents():
    """
    Delete all document processing records and results.
    """
    if mongo_db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Delete all collections
        mongo_db.jobs.delete_many({})
        mongo_db.page_results.delete_many({})
        mongo_db.final_results.delete_many({})
        
        logger.info("Deleted all document records")
        return {"message": "All documents deleted successfully"}
        
    except Exception as e:
        logger.error(f"Error deleting documents: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete documents")

@app.get("/api/documents/{job_id}/results", summary="Get specific document results")
async def get_document_results(job_id: str):
    """
    Get the complete results for a specific document.
    """
    if mongo_db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Get job record
        job = mongo_db.jobs.find_one({"job_id": job_id})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        if job["status"] != "completed":
            raise HTTPException(status_code=400, detail="Job not completed yet")
        
        # Get final results
        final_result = mongo_db.final_results.find_one({"job_id": job_id})
        if not final_result:
            raise HTTPException(status_code=404, detail="Results not found")
        
        # Get page results
        page_results = list(mongo_db.page_results.find({"job_id": job_id}).sort("page_number", 1))
        
        return {
            "job_id": job_id,
            "document_overview": final_result.get("document_overview"),
            "markdown_content": final_result.get("markdown_content"),
            "page_results": [{
                "page_number": page["page_number"],
                "extracted_text": page["extracted_text"],
                "confidence_score": page["confidence_score"]
            } for page in page_results],
            "processing_info": {
                "model": job["llm_model"],
                "total_pages": job["total_pages"],
                "created_at": job["created_at"].isoformat(),
                "completed_at": job["completed_at"].isoformat() if job.get("completed_at") else None
            }
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error getting document results: {e}")
        raise HTTPException(status_code=500, detail="Failed to get document results")

if __name__ == "__main__":
    # This part is for local development testing (not used by Uvicorn in Docker)
    import uvicorn
    logger.info("Starting Uvicorn server for local development on http://localhost:8000")
    # Note: PaddleOCR model download might happen on first run here.
    # Initialize connections before starting
    init_connections()
    uvicorn.run(app, host="0.0.0.0", port=8000)
