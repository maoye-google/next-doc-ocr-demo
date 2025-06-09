# Build stage
FROM node:18-alpine as build

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the app for production
RUN npm run build 

# Production stage
FROM nginx:alpine
# Copy built assets from the 'build' stage
COPY --from=build /app/build /usr/share/nginx/html
# Copy a custom Nginx configuration, if you have one (optional)
# COPY nginx.conf /etc/nginx/conf.d/default.conf
# Expose port 80 (Nginx default)

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Make port 80 available to the world outside this container
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]