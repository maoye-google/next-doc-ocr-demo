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
from kafka.admin import KafkaAdminClient, NewTopic
from pymongo import MongoClient
from google.cloud import aiplatform
from vertexai.generative_models import GenerativeModel, Part, FinishReason
import vertexai.preview.generative_models as generative_models
import google.auth

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment variables
KAFKA_BROKER = os.getenv("KAFKA_BROKER", "localhost:29092")
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017/ocr_demo")
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "demo-project")
GCP_LOCATION = os.getenv("GCP_LOCATION", "us-central1")
GOOGLE_APPLICATION_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

# Initialize FastAPI
app = FastAPI(title="OCR Processing Service", version="1.0.0")

# Global variables for connections
kafka_consumer = None
kafka_producer = None
mongo_client = None
mongo_db = None

model_endpoints = {
    # Map user-friendly names to actual Vertex AI model IDs
    'gemini-2.5-flash': 'gemini-2.5-flash-preview-05-20',
    'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite-001', 
    'gemini-2.5-pro': 'gemini-2.5-pro-001'
}

class PageMessage(BaseModel):
    job_id: str
    page_number: int
    image_data: str
    llm_model: str

class AggregationMessage(BaseModel):
    job_id: str
    llm_model: str
    total_pages: int

def create_kafka_topics():
    """Create required Kafka topics if they don't exist"""
    try:
        logger.info("=== CREATING KAFKA TOPICS IF NOT EXIST ===")
        
        # Initialize Kafka Admin Client
        admin_client = KafkaAdminClient(
            bootstrap_servers=[KAFKA_BROKER],
            api_version=(0, 10, 1)
        )
        
        # Get existing topics
        existing_topics = admin_client.list_topics()
        logger.info(f"Existing topics: {existing_topics}")
        
        # Define required topics
        required_topics = [
            NewTopic(
                name="page-processing-topic",
                num_partitions=1,
                replication_factor=1
            ),
            NewTopic(
                name="aggregation-trigger-topic", 
                num_partitions=1,
                replication_factor=1
            )
        ]
        
        # Create topics that don't exist
        topics_to_create = []
        for topic in required_topics:
            if topic.name not in existing_topics:
                topics_to_create.append(topic)
                logger.info(f"Will create topic: {topic.name}")
            else:
                logger.info(f"Topic already exists: {topic.name}")
        
        if topics_to_create:
            logger.info(f"=== CREATING {len(topics_to_create)} TOPICS ===")
            result = admin_client.create_topics(topics_to_create, validate_only=False)
            
            # Wait for creation to complete
            for topic_name, future in result.items():
                try:
                    future.result()  # The result itself is None
                    logger.info(f"=== TOPIC CREATED SUCCESSFULLY: {topic_name} ===")
                except Exception as e:
                    if "TopicExistsException" in str(e):
                        logger.info(f"Topic already exists (concurrent creation): {topic_name}")
                    else:
                        logger.error(f"Failed to create topic {topic_name}: {e}")
                        raise
        else:
            logger.info("=== ALL REQUIRED TOPICS ALREADY EXIST ===")
            
        admin_client.close()
        logger.info("=== KAFKA TOPICS CREATION COMPLETED ===")
        
    except Exception as e:
        logger.error(f"=== ERROR CREATING KAFKA TOPICS ===")
        logger.error(f"Error: {e}")
        logger.error(f"Exception type: {type(e).__name__}")
        # Continue anyway - topics might exist or be auto-created

def init_connections():
    """Initialize database and message queue connections with retry logic"""
    global kafka_consumer, kafka_producer, mongo_client, mongo_db
    
    max_retries = 10
    retry_delay = 5
    
    logger.info("=== DOC-OCR-PROCESSING INITIALIZING CONNECTIONS ===")
    logger.info(f"MongoDB URL: {MONGODB_URL}")
    logger.info(f"Kafka broker servers: {KAFKA_BROKER}")
    logger.info(f"GCP Project: {GCP_PROJECT_ID}")
    logger.info(f"GCP Location: {GCP_LOCATION}")
    
    # Retry logic for connections
    for attempt in range(max_retries):
        try:
            # Initialize MongoDB
            logger.info(f"=== CONNECTING TO MONGODB === (attempt {attempt + 1}/{max_retries})")
            mongo_client = MongoClient(MONGODB_URL, serverSelectionTimeoutMS=5000)
            mongo_db = mongo_client.get_default_database()
            
            # Test MongoDB connection
            mongo_client.admin.command('ping')
            logger.info("=== MONGODB CONNECTION SUCCESSFUL ===")
            
            # Initialize Kafka Producer with retry
            logger.info(f"=== CONNECTING TO KAFKA PRODUCER === (attempt {attempt + 1}/{max_retries})")
            kafka_producer = KafkaProducer(
                bootstrap_servers=[KAFKA_BROKER],
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                api_version=(0, 10, 1),  # Use older API version for compatibility
                retries=3,
                request_timeout_ms=30000
            )
            logger.info("=== KAFKA PRODUCER INITIALIZED ===")
            
            # Create Kafka topics if they don't exist
            create_kafka_topics()
            
            # Initialize GCP AI Platform with specific service account if provided
            if GOOGLE_APPLICATION_CREDENTIALS:
                if os.path.exists(GOOGLE_APPLICATION_CREDENTIALS):
                    logger.info(f"Using service account key for Vertex AI from GOOGLE_APPLICATION_CREDENTIALS: {GOOGLE_APPLICATION_CREDENTIALS}")
                else:
                    logger.warning(f"Service account key file specified in GOOGLE_APPLICATION_CREDENTIALS not found: {GOOGLE_APPLICATION_CREDENTIALS}. Falling back to default credentials.")
            else:
                logger.info("GOOGLE_APPLICATION_CREDENTIALS not set. Attempting to use default Google Cloud credentials for Vertex AI.")

            try:
                logger.info("=== INITIALIZING GCP AI PLATFORM ===")
                aiplatform.init(project=GCP_PROJECT_ID, location=GCP_LOCATION)
                logger.info(f"=== GCP AI PLATFORM INITIALIZED FOR PROJECT: {GCP_PROJECT_ID} ===")
            except Exception as e:
                logger.error(f"=== GCP AI PLATFORM INITIALIZATION FAILED: {e} ===")
                # Depending on requirements, you might want to raise an error here
                # if Vertex AI is critical for the service to function.

            # If we reach here, all primary connections successful
            logger.info("=== ALL CONNECTIONS INITIALIZED SUCCESSFULLY ===")
            return
            
        except Exception as e:
            logger.error(f"=== CONNECTION ATTEMPT {attempt + 1} FAILED: {e} ===")
            logger.error(f"Exception type: {type(e).__name__}")
            if attempt < max_retries - 1:
                logger.info(f"Retrying in {retry_delay} seconds...")
                import time
                time.sleep(retry_delay)
            else:
                logger.error("=== ALL CONNECTION ATTEMPTS FAILED ===")
                raise

def process_page_with_vertex_ai(image_data: str, model_key: str) -> Dict[str, Any]:
    """Process a single page image with Vertex AI"""
    try:
        actual_model_name = model_endpoints.get(model_key)
        if not actual_model_name:
            logger.error(f"Unknown model key: {model_key}. Available models: {list(model_endpoints.keys())}")
            raise ValueError(f"Invalid model key: {model_key}")

        logger.info(f"Processing page with Vertex AI model: {actual_model_name} (key: {model_key})")

        vertex_model = GenerativeModel(actual_model_name)

        # Decode base64 image data
        try:
            image_bytes = base64.b64decode(image_data)
        except Exception as e:
            logger.error(f"Failed to decode base64 image data: {e}")
            raise ValueError("Invalid base64 image data")

        # Assuming PNG, adjust if other types are common.
        # Consider dynamically determining mime_type if possible or passing it in PageMessage.
        image_part = Part.from_data(data=image_bytes, mime_type="image/png")

        prompt = "Extract all text from this image. Provide only the extracted text."

        generation_config = {
            "max_output_tokens": 8192,
            "temperature": 0.2,
            "top_p": 0.95,
        }

        safety_settings = {
            generative_models.HarmCategory.HARM_CATEGORY_HATE_SPEECH: generative_models.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            generative_models.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: generative_models.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            generative_models.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: generative_models.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            generative_models.HarmCategory.HARM_CATEGORY_HARASSMENT: generative_models.HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        }

        response = vertex_model.generate_content(
            [image_part, prompt],
            generation_config=generation_config,
            safety_settings=safety_settings,
            stream=False,
        )

        extracted_text = ""
        if not response.candidates:
            block_reason = response.prompt_feedback.block_reason if response.prompt_feedback else 'Unknown'
            logger.warning(f"No candidates from Vertex AI for model {actual_model_name}. Finish reason: {block_reason}")
            extracted_text = f"Error: No content generated. Reason: {block_reason}"
        elif response.candidates[0].finish_reason.name != "STOP":
            finish_reason_name = response.candidates[0].finish_reason.name
            logger.warning(f"Vertex AI generation finished with reason: {finish_reason_name} for model {actual_model_name}")
            extracted_text = f"Error: Generation finished unexpectedly. Reason: {finish_reason_name}"
        elif response.candidates[0].content.parts:
            extracted_text = response.candidates[0].text

        logger.info(f"Extracted Text : {extracted_text}")

        return {
            "extracted_text": extracted_text,
            "confidence_score": 0.95,  # Placeholder, Gemini doesn't provide OCR-like confidence
            "processing_model": model_key,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Vertex AI processing failed: {e}")
        return {
            "extracted_text": "Error during processing",
            "confidence_score": 0.0,
            "processing_model": model_key,
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

def aggregate_document_with_vertex_ai(page_results: List[Dict], model: str) -> Dict[str, Any]:
    """Aggregate all page results into final document summary"""
    try:
        logger.info(f"Aggregating document with model: {model}")
        
        # Sort page_results by page_number to ensure correct order
        sorted_page_results = sorted(page_results, key=lambda x: x.get("page_number", 0))
        
        # Combine all page texts with page number headers
        page_texts_with_headers = []
        for page in sorted_page_results:
            page_number = page.get("page_number", "Unknown")
            extracted_text = page.get("extracted_text", "")
            page_texts_with_headers.append(f"### Page {page_number}\n{extracted_text}")
        
        all_text = "\n\n---\n\n".join(page_texts_with_headers) # Use --- for a thematic break between pages
        
        # Simulate processing time
        import time
        time.sleep(3)
        
        overview = f"Document processed with {model}. Contains {len(page_results)} pages."
        record = {
            "document_overview": overview,
            "markdown_content": f"## Summary\n {overview} \n\n---\n\n## Extracted Texts\n{all_text[:50000]}...\n\n",
            "processing_model": model,
            "timestamp": datetime.utcnow().isoformat()
        }

        logger.info(str(record))

        return record
        
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
        logger.info(f"=== PROCESSING PAGE MESSAGE ===")
        logger.info(f"Job ID: {message.job_id}")
        logger.info(f"Page: {message.page_number}")
        logger.info(f"Model: {message.llm_model}")
        logger.info(f"Image data size: {len(message.image_data)} characters")
        
        # Process with Vertex AI
        logger.info(f"=== CALLING VERTEX AI ===")
        result = process_page_with_vertex_ai(message.image_data, message.llm_model)
        logger.info(f"=== VERTEX AI RESPONSE ===")
        logger.info(f"Extracted text length: {len(result.get('extracted_text', ''))}")
        logger.info(f"Confidence score: {result.get('confidence_score', 0)}")
        
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
        
        logger.info(f"=== STORING PAGE RESULT IN MONGODB ===")
        mongo_db.page_results.insert_one(page_result)
        logger.info(f"=== PAGE RESULT STORED SUCCESSFULLY ===")
        logger.info(f"Stored result for page {message.page_number} of job {message.job_id}")
        
    except Exception as e:
        logger.error(f"=== ERROR PROCESSING PAGE MESSAGE ===")
        logger.error(f"Error: {e}")
        logger.error(f"Exception type: {type(e).__name__}")
        
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
        
        try:
            mongo_db.page_results.insert_one(error_result)
            logger.info(f"=== ERROR RESULT STORED ===")
        except Exception as store_error:
            logger.error(f"=== FAILED TO STORE ERROR RESULT: {store_error} ===")

def process_aggregation_message(message: AggregationMessage):
    """Process aggregation message from Kafka"""
    try:
        logger.info(f"=== PROCESSING AGGREGATION MESSAGE ===")
        logger.info(f"Job ID: {message.job_id}")
        logger.info(f"Model: {message.llm_model}")
        logger.info(f"Expected total pages: {message.total_pages}")
        
        # Retrieve all page results for this job
        logger.info(f"=== RETRIEVING PAGE RESULTS FROM MONGODB ===")
        page_results = list(mongo_db.page_results.find({"job_id": message.job_id}))
        logger.info(f"Found {len(page_results)} page results in database")
        
        if len(page_results) != message.total_pages:
            logger.error(f"=== PAGE COUNT MISMATCH ===")
            logger.error(f"Expected: {message.total_pages}, Got: {len(page_results)}")
            logger.error("Aggregation cannot proceed - waiting for more pages")
            return
            
        logger.info(f"=== ALL PAGES AVAILABLE - PROCEEDING WITH AGGREGATION ===")
        
        # Aggregate with Vertex AI
        logger.info(f"=== CALLING VERTEX AI FOR AGGREGATION ===")
        final_result = aggregate_document_with_vertex_ai(page_results, message.llm_model)
        logger.info(f"=== AGGREGATION COMPLETE ===")
        
        # Store final result in MongoDB
        final_document = {
            "job_id": message.job_id,
            "document_overview": final_result["document_overview"],
            "markdown_content": final_result["markdown_content"],
            "status": "completed",
            "created_at": datetime.utcnow(),
            "processing_model": message.llm_model
        }
        
        logger.info(f"=== STORING FINAL RESULT IN MONGODB ===")
        mongo_db.final_results.insert_one(final_document)
        
        # Update job status
        logger.info(f"=== UPDATING JOB STATUS TO COMPLETED ===")
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
        
        logger.info(f"=== AGGREGATION FULLY COMPLETED FOR JOB {message.job_id} ===")
        
    except Exception as e:
        logger.error(f"=== ERROR PROCESSING AGGREGATION MESSAGE ===")
        logger.error(f"Error: {e}")
        logger.error(f"Exception type: {type(e).__name__}")
        
        # Update job status to error
        try:
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
            logger.info(f"=== JOB STATUS UPDATED TO ERROR ===")
        except Exception as update_error:
            logger.error(f"=== FAILED TO UPDATE JOB STATUS: {update_error} ===")

async def kafka_consumer_task():
    """Background task to consume Kafka messages"""
    global kafka_consumer
    
    logger.info("=== STARTING KAFKA CONSUMER TASK ===")
    
    try:
        # Initialize Kafka Consumer
        logger.info("=== INITIALIZING KAFKA CONSUMER ===")
        logger.info(f"Kafka Broker servers: {KAFKA_BROKER}")
        logger.info("Topics: page-processing-topic, aggregation-trigger-topic")
        logger.info("Consumer group: doc-ocr-processing-group")
        
        kafka_consumer = KafkaConsumer(
            'page-processing-topic',
            'aggregation-trigger-topic',
            bootstrap_servers=[KAFKA_BROKER],
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            group_id='doc-ocr-processing-group',
            auto_offset_reset='earliest',  # Changed from 'latest' to 'earliest' 
            consumer_timeout_ms=1000,  # Add timeout to prevent blocking
            enable_auto_commit=True,
            auto_commit_interval_ms=1000,
            api_version=(0, 10, 1),  # Match producer API version
            fetch_min_bytes=1,  # Fetch even small messages
            fetch_max_wait_ms=500  # Don't wait too long for batching
        )
        
        logger.info("=== KAFKA CONSUMER INITIALIZED SUCCESSFULLY ===")
        logger.info("=== WAITING FOR MESSAGES ===")
        
        # Add consumer loop monitoring
        message_count = 0
        poll_count = 0
        
        while True:
            try:
                # Poll for messages with timeout
                message_batch = kafka_consumer.poll(timeout_ms=5000)
                poll_count += 1
                
                if poll_count % 10 == 0:  # Log every 10 polls (50 seconds)
                    logger.info(f"=== CONSUMER POLL #{poll_count} - Still waiting for messages ===")
                
                if not message_batch:
                    continue  # No messages, continue polling
                
                # Process messages
                for topic_partition, messages in message_batch.items():
                    logger.info(f"=== RECEIVED {len(messages)} MESSAGES FROM {topic_partition.topic} ===")
                    
                    for message in messages:
                        message_count += 1
                        logger.info(f"=== PROCESSING MESSAGE #{message_count} ===")
                        
                        try:
                            topic = message.topic
                            value = message.value
                            
                            logger.info(f"=== RECEIVED KAFKA MESSAGE ===")
                            logger.info(f"Topic: {topic}")
                            logger.info(f"Partition: {message.partition}")
                            logger.info(f"Offset: {message.offset}")
                            logger.info(f"Key: {message.key}")
                            logger.info(f"Value type: {type(value)}")
                            
                            if topic == 'page-processing-topic':
                                logger.info("=== PROCESSING PAGE MESSAGE ===")
                                logger.info(f"Job ID: {value.get('job_id', 'UNKNOWN')}")
                                logger.info(f"Page: {value.get('page_number', 'UNKNOWN')}")
                                logger.info(f"Model: {value.get('llm_model', 'UNKNOWN')}")
                                logger.info(f"Image data length: {len(value.get('image_data', ''))}")
                                
                                page_msg = PageMessage(**value)
                                process_page_message(page_msg)
                                
                            elif topic == 'aggregation-trigger-topic':
                                logger.info("=== PROCESSING AGGREGATION MESSAGE ===")
                                logger.info(f"Job ID: {value.get('job_id', 'UNKNOWN')}")
                                logger.info(f"Model: {value.get('llm_model', 'UNKNOWN')}")
                                logger.info(f"Total pages: {value.get('total_pages', 'UNKNOWN')}")
                                
                                agg_msg = AggregationMessage(**value)
                                process_aggregation_message(agg_msg)
                            else:
                                logger.warning(f"=== UNKNOWN TOPIC: {topic} ===")
                                
                        except Exception as e:
                            logger.error(f"=== ERROR PROCESSING KAFKA MESSAGE ===")
                            logger.error(f"Error: {e}")
                            logger.error(f"Exception type: {type(e).__name__}")
                            logger.error(f"Message topic: {getattr(message, 'topic', 'UNKNOWN')}")
                            logger.error(f"Message value: {getattr(message, 'value', 'UNKNOWN')}")
                
            except Exception as poll_error:
                logger.error(f"=== ERROR DURING CONSUMER POLL ===")
                logger.error(f"Error: {poll_error}")
                logger.error(f"Exception type: {type(poll_error).__name__}")
                await asyncio.sleep(5)  # Wait before retrying
                
    except Exception as e:
        logger.error(f"=== KAFKA CONSUMER ERROR ===")
        logger.error(f"Error: {e}")
        logger.error(f"Exception type: {type(e).__name__}")

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