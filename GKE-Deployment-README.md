# GKE Deployment Guide for Doc-OCR Application

This document explains how to deploy the Doc-OCR application to Google Kubernetes Engine (GKE) using Google Cloud Build.

## Prerequisites

1. **Google Cloud Project**: Ensure you have a GCP project with billing enabled
2. **APIs Enabled**: Enable the following APIs in your project:
   - Container Registry API
   - Google Kubernetes Engine API
   - Cloud Build API
   - IAM API
   - Compute Engine API
   - Vertex AI API

3. **GKE Cluster**: Create a GKE cluster named `next-demo-cluster` in `us-central1` region:
   ```bash
   gcloud container clusters create next-demo-cluster \
     --region=us-central1 \
     --num-nodes=3 \
     --enable-autoscaling \
     --min-nodes=1 \
     --max-nodes=10 \
     --machine-type=e2-medium
   ```

4. **DNS Configuration**: Ensure the domain `doc-ocr.maoye.demo.altostrat.com` points to the static IP that will be created by the deployment.

## Deployment Instructions

### Method 1: Using Cloud Build (Recommended)

1. **Submit the build to Cloud Build**:
   ```bash
   gcloud builds submit --config cloudbuild.yaml .
   ```

   The Cloud Build process will automatically:
   - Grant necessary permissions to the Cloud Build service account
   - Create the Vertex AI service account `doc-ocr-vertex-ai-sa@$PROJECT_ID.iam.gserviceaccount.com`
   - Create a static IP named `doc-ocr-ip`
   - Build and push Docker images to Google Container Registry
   - Deploy all infrastructure components (MongoDB, ZooKeeper, Kafka)
   - Deploy application services (doc-ocr-backend, doc-ocr-frontend, doc-ocr-processing)
   - Configure SSL certificate and ingress routing

2. **Monitor the deployment**:
   ```bash
   # Check build status
   gcloud builds list --limit=1
   
   # Monitor deployment progress
   kubectl get pods -n doc-ocr --watch
   ```

### Method 2: Manual Deployment

If you prefer to deploy manually:

1. **Set environment variables**:
   ```bash
   export PROJECT_ID=$(gcloud config get-value project)
   export GKE_CLUSTER_NAME=next-demo-cluster
   export GKE_REGION=us-central1
   ```

2. **Get GKE credentials**:
   ```bash
   gcloud container clusters get-credentials $GKE_CLUSTER_NAME \
     --region=$GKE_REGION --project=$PROJECT_ID
   ```

3. **Build and push images**:
   ```bash
   # Build images
   docker build -t gcr.io/$PROJECT_ID/doc-ocr-backend:latest ./doc-ocr-backend
   docker build -t gcr.io/$PROJECT_ID/doc-ocr-processing:latest ./doc-ocr-processing
   docker build -t gcr.io/$PROJECT_ID/doc-ocr-frontend:latest ./doc-ocr-frontend
   
   # Push images
   docker push gcr.io/$PROJECT_ID/doc-ocr-backend:latest
   docker push gcr.io/$PROJECT_ID/doc-ocr-processing:latest
   docker push gcr.io/$PROJECT_ID/doc-ocr-frontend:latest
   ```

4. **Create service account and key**:
   ```bash
   # Create service account
   gcloud iam service-accounts create doc-ocr-vertex-ai-sa \
     --display-name="Doc OCR Vertex AI Service Account"
   
   # Grant permissions
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:doc-ocr-vertex-ai-sa@$PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/aiplatform.user"
   
   # Create key
   gcloud iam service-accounts keys create sa-key.json \
     --iam-account=doc-ocr-vertex-ai-sa@$PROJECT_ID.iam.gserviceaccount.com
   ```

5. **Create static IP**:
   ```bash
   gcloud compute addresses create doc-ocr-ip --global
   ```

6. **Deploy to Kubernetes**:
   ```bash
   # Create namespace
   kubectl apply -f k8s/Namespace.yaml
   
   # Create secret
   kubectl create secret generic vertex-ai-sa-key \
     --from-file=key.json=sa-key.json \
     --namespace=doc-ocr
   
   # Deploy infrastructure
   kubectl apply -f k8s/mongodb-StatefulSet.yaml
   kubectl apply -f k8s/mongodb-Service.yaml
   kubectl apply -f k8s/zookeeper-StatefulSet.yaml
   kubectl apply -f k8s/zookeeper-Service.yaml
   kubectl apply -f k8s/kafka-StatefulSet.yaml
   kubectl apply -f k8s/kafka-service.yaml
   
   # Wait for infrastructure
   kubectl wait --for=condition=ready pod -l app=mongodb --timeout=300s -n doc-ocr
   kubectl wait --for=condition=ready pod -l app=zookeeper --timeout=300s -n doc-ocr
   kubectl wait --for=condition=ready pod -l app=kafka --timeout=600s -n doc-ocr
   
   # Deploy applications (substitute PROJECT_ID)
   sed "s/\${PROJECT_ID}/$PROJECT_ID/g" k8s/doc-ocr-processing-Deployment.yaml | kubectl apply -f -
   sed "s/\${PROJECT_ID}/$PROJECT_ID/g" k8s/doc-ocr-backend-Deployment.yaml | kubectl apply -f -
   kubectl apply -f k8s/doc-ocr-backend-Service.yaml
   sed "s/\${PROJECT_ID}/$PROJECT_ID/g" k8s/doc-ocr-frontend-Deployment.yaml | kubectl apply -f -
   kubectl apply -f k8s/doc-ocr-frontend-Service.yaml
   
   # Deploy ingress and certificate
   kubectl apply -f k8s/ManagedCertificate.yaml
   kubectl apply -f k8s/Ingress.yaml
   ```

## Verification

1. **Check pod status**:
   ```bash
   kubectl get pods -n doc-ocr
   ```

2. **Check services**:
   ```bash
   kubectl get services -n doc-ocr
   ```

3. **Check ingress**:
   ```bash
   kubectl get ingress -n doc-ocr
   ```

4. **Get static IP**:
   ```bash
   gcloud compute addresses describe doc-ocr-ip --global --format="value(address)"
   ```

5. **Check certificate status**:
   ```bash
   kubectl describe managedcertificate doc-ocr-ssl-cert -n doc-ocr
   ```

## Post-Deployment

1. **DNS Configuration**: Point your domain `doc-ocr.maoye.demo.altostrat.com` to the static IP address.

2. **SSL Certificate**: The managed certificate may take 10-60 minutes to provision. Monitor its status:
   ```bash
   kubectl get managedcertificate -n doc-ocr
   ```

3. **Access the Application**: Once the certificate is active, access your application at:
   - Frontend: https://doc-ocr.maoye.demo.altostrat.com
   - Backend API: https://doc-ocr.maoye.demo.altostrat.com/api

## Troubleshooting

1. **Pod Issues**:
   ```bash
   kubectl describe pod <pod-name> -n doc-ocr
   kubectl logs <pod-name> -n doc-ocr
   ```

2. **Service Issues**:
   ```bash
   kubectl describe service <service-name> -n doc-ocr
   ```

3. **Ingress Issues**:
   ```bash
   kubectl describe ingress doc-ocr-ingress -n doc-ocr
   ```

4. **Certificate Issues**:
   ```bash
   kubectl describe managedcertificate doc-ocr-ssl-cert -n doc-ocr
   ```

## Cleanup

To remove the deployment:

```bash
# Delete Kubernetes resources
kubectl delete namespace doc-ocr

# Delete static IP
gcloud compute addresses delete doc-ocr-ip --global

# Delete service account
gcloud iam service-accounts delete doc-ocr-vertex-ai-sa@$PROJECT_ID.iam.gserviceaccount.com

# Delete container images (optional)
gcloud container images delete gcr.io/$PROJECT_ID/doc-ocr-backend:latest --force-delete-tags
gcloud container images delete gcr.io/$PROJECT_ID/doc-ocr-processing:latest --force-delete-tags
gcloud container images delete gcr.io/$PROJECT_ID/doc-ocr-frontend:latest --force-delete-tags
```

## Architecture Overview

The deployed architecture includes:

- **Infrastructure Layer**: MongoDB (database), ZooKeeper (coordination), Kafka (message queue)
- **Application Layer**: 
  - `doc-ocr-backend`: FastAPI service for OCR processing
  - `doc-ocr-processing`: Background service for Vertex AI integration
  - `doc-ocr-frontend`: React web application
- **Network Layer**: Ingress with Google-managed SSL certificate
- **Security Layer**: Service account with minimal required permissions

All components run in the `doc-ocr` namespace with appropriate resource limits and health checks configured.