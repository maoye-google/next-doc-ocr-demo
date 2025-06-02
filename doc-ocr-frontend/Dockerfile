# frontend/Dockerfile

# --- Stage 1: Build React App ---
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package.json package-lock.json* ./
# COPY yarn.lock ./

# Install dependencies
RUN npm install
# RUN yarn install

# Copy the rest of the application source code
COPY . .

# Set the API URL from build argument or use a default for build-time (if needed)
ARG BACKEND_HOST
ARG BACKEND_PORT

ENV BACKEND_HOST=$BACKEND_HOST
ENV BACKEND_PORT=$BACKEND_PORT

# Build the React application
RUN npm run build
# RUN yarn build

# --- Stage 2: Serve with Nginx ---
FROM nginx:alpine

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the build output from the builder stage to Nginx's web root
COPY --from=builder /app/build /usr/share/nginx/html

# Expose port 80 (default Nginx port)
EXPOSE 80

# Command to start Nginx
CMD ["nginx", "-g", "daemon off;"]
