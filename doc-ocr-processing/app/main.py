import os
import json
import base64
import logging
import asyncio
from typing import Dict, List, Any
from datetime import datetime
import uvicorn

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from kafka import KafkaConsumer, KafkaProducer
from pymongo import MongoClient
from google.cloud import aiplatform
import google.auth

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment variables
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017/ocr_demo")
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "demo-project")
GCP_LOCATION = os.getenv("GCP_LOCATION", "us-central1")

# Initialize FastAPI
app = FastAPI(title="OCR Processing Service", version="1.0.0")

# Global variables for connections
kafka_consumer = None
kafka_producer = None
mongo_client = None
mongo_db = None

class PageMessage(BaseModel):
    job_id: str
    page_number: int
    image_data: str
    llm_model: str

class AggregationMessage(BaseModel):
    job_id: str
    llm_model: str
    total_pages: int

def init_connections():
    """Initialize database and message queue connections with retry logic"""
    global kafka_consumer, kafka_producer, mongo_client, mongo_db
    
    max_retries = 10
    retry_delay = 5
    
    # Retry logic for connections
    for attempt in range(max_retries):
        try:
            # Initialize MongoDB
            logger.info(f"Connecting to MongoDB: {MONGODB_URL} (attempt {attempt + 1}/{max_retries})")
            mongo_client = MongoClient(MONGODB_URL, serverSelectionTimeoutMS=5000)
            mongo_db = mongo_client.get_default_database()
            
            # Test MongoDB connection
            mongo_client.admin.command('ping')
            logger.info("MongoDB connection successful")
            
            # Initialize Kafka Producer with retry
            logger.info(f"Connecting to Kafka: {KAFKA_BOOTSTRAP_SERVERS} (attempt {attempt + 1}/{max_retries})")
            kafka_producer = KafkaProducer(
                bootstrap_servers=[KAFKA_BOOTSTRAP_SERVERS],
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                api_version=(0, 10, 1),  # Use older API version for compatibility
                retries=3,
                request_timeout_ms=30000
            )
            logger.info("Kafka producer initialized")
            
            # Initialize GCP AI Platform
            try:
                aiplatform.init(project=GCP_PROJECT_ID, location=GCP_LOCATION)
                logger.info(f"GCP AI Platform initialized for project: {GCP_PROJECT_ID}")
            except Exception as e:
                logger.warning(f"GCP AI Platform initialization failed: {e}")
            
            # If we reach here, all connections successful
            logger.info("All connections initialized successfully")
            return
            
        except Exception as e:
            logger.error(f"Connection attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                logger.info(f"Retrying in {retry_delay} seconds...")
                import time
                time.sleep(retry_delay)
            else:
                logger.error("All connection attempts failed")
                raise

def process_page_with_vertex_ai(image_data: str, model: str) -> Dict[str, Any]:
    """Process a single page image with Vertex AI"""
    try:
        # For demo purposes, simulate Vertex AI processing
        # In real implementation, this would call the actual Vertex AI API
        logger.info(f"Processing page with model: {model}")
        
        # Simulate processing time
        import time
        time.sleep(2)
        
        # Return mock extraction result
        return {
            "extracted_text": f"Sample extracted text from {model}",
            "confidence_score": 0.95,
            "processing_model": model,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Vertex AI processing failed: {e}")
        return {
            "extracted_text": "Error during processing",
            "confidence_score": 0.0,
            "processing_model": model,
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

def aggregate_document_with_vertex_ai(page_results: List[Dict], model: str) -> Dict[str, Any]:
    """Aggregate all page results into final document summary"""
    try:
        logger.info(f"Aggregating document with model: {model}")
        
        # Combine all page texts
        all_text = "\n\n".join([page.get("extracted_text", "") for page in page_results])
        
        # Simulate processing time
        import time
        time.sleep(3)
        
        # Return mock aggregation result
        return {
            "document_overview": f"Document processed with {model}. Contains {len(page_results)} pages.",
            "markdown_content": f"# Document Analysis\n\n## Summary\n{all_text[:500]}...\n\n## Pages: {len(page_results)}",
            "processing_model": model,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Document aggregation failed: {e}")
        return {
            "document_overview": "Error during aggregation",
            "markdown_content": "# Error\n\nDocument aggregation failed",
            "processing_model": model,
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

def process_page_message(message: PageMessage):
    """Process individual page message from Kafka"""
    try:
        logger.info(f"Processing page {message.page_number} for job {message.job_id}")
        
        # Process with Vertex AI
        result = process_page_with_vertex_ai(message.image_data, message.llm_model)
        
        # Store result in MongoDB
        page_result = {
            "job_id": message.job_id,
            "page_number": message.page_number,
            "extracted_text": result["extracted_text"],
            "confidence_score": result["confidence_score"],
            "status": "completed",
            "created_at": datetime.utcnow(),
            "processing_model": message.llm_model
        }
        
        mongo_db.page_results.insert_one(page_result)
        logger.info(f"Stored result for page {message.page_number} of job {message.job_id}")
        
    except Exception as e:
        logger.error(f"Error processing page message: {e}")
        # Store error result
        error_result = {
            "job_id": message.job_id,
            "page_number": message.page_number,
            "extracted_text": f"Error: {str(e)}",
            "confidence_score": 0.0,
            "status": "error",
            "created_at": datetime.utcnow(),
            "processing_model": message.llm_model
        }
        mongo_db.page_results.insert_one(error_result)

def process_aggregation_message(message: AggregationMessage):
    """Process aggregation message from Kafka"""
    try:
        logger.info(f"Processing aggregation for job {message.job_id}")
        
        # Retrieve all page results for this job
        page_results = list(mongo_db.page_results.find({"job_id": message.job_id}))
        
        if len(page_results) != message.total_pages:
            logger.error(f"Page count mismatch for job {message.job_id}: expected {message.total_pages}, got {len(page_results)}")
            return
            
        # Aggregate with Vertex AI
        final_result = aggregate_document_with_vertex_ai(page_results, message.llm_model)
        
        # Store final result in MongoDB
        final_document = {
            "job_id": message.job_id,
            "document_overview": final_result["document_overview"],
            "markdown_content": final_result["markdown_content"],
            "status": "completed",
            "created_at": datetime.utcnow(),
            "processing_model": message.llm_model
        }
        
        mongo_db.final_results.insert_one(final_document)
        
        # Update job status
        mongo_db.jobs.update_one(
            {"job_id": message.job_id},
            {
                "$set": {
                    "status": "completed",
                    "completed_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        logger.info(f"Completed aggregation for job {message.job_id}")
        
    except Exception as e:
        logger.error(f"Error processing aggregation message: {e}")
        # Update job status to error
        mongo_db.jobs.update_one(
            {"job_id": message.job_id},
            {
                "$set": {
                    "status": "error",
                    "updated_at": datetime.utcnow(),
                    "error_message": str(e)
                }
            }
        )

async def kafka_consumer_task():
    """Background task to consume Kafka messages"""
    global kafka_consumer
    
    try:
        # Initialize Kafka Consumer
        kafka_consumer = KafkaConsumer(
            'page-processing-topic',
            'aggregation-trigger-topic',
            bootstrap_servers=[KAFKA_BOOTSTRAP_SERVERS],
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            group_id='doc-ocr-processing-group',
            auto_offset_reset='latest'
        )
        
        logger.info("Started Kafka consumer")
        
        for message in kafka_consumer:
            try:
                topic = message.topic
                value = message.value
                
                logger.info(f"Received message from topic: {topic}")
                
                if topic == 'page-processing-topic':
                    page_msg = PageMessage(**value)
                    process_page_message(page_msg)
                    
                elif topic == 'aggregation-trigger-topic':
                    agg_msg = AggregationMessage(**value)
                    process_aggregation_message(agg_msg)
                    
            except Exception as e:
                logger.error(f"Error processing Kafka message: {e}")
                
    except Exception as e:
        logger.error(f"Kafka consumer error: {e}")

@app.on_event("startup")
async def startup_event():
    """Initialize connections on startup"""
    init_connections()
    # Start Kafka consumer in background
    asyncio.create_task(kafka_consumer_task())

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up connections on shutdown"""
    if kafka_consumer:
        kafka_consumer.close()
    if kafka_producer:
        kafka_producer.close()
    if mongo_client:
        mongo_client.close()

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "OCR Processing Service is running"}

@app.get("/health")
async def health_check():
    """Detailed health check"""
    status = {
        "service": "running",
        "mongodb": "unknown",
        "kafka": "unknown",
        "gcp": "unknown"
    }
    
    try:
        # Check MongoDB
        mongo_client.admin.command('ping')
        status["mongodb"] = "connected"
    except:
        status["mongodb"] = "disconnected"
    
    try:
        # Check Kafka (simplified)
        if kafka_producer:
            status["kafka"] = "connected"
    except:
        status["kafka"] = "disconnected"
        
    # Check GCP (simplified)
    try:
        # This is a simple check - in production you'd test actual API calls
        if GCP_PROJECT_ID != "demo-project":
            status["gcp"] = "configured"
        else:
            status["gcp"] = "demo-mode"
    except:
        status["gcp"] = "error"
    
    return status

if __name__ == "__main__":
    logger.info("Starting OCR Processing Service")
    uvicorn.run(app, host="0.0.0.0", port=8001)