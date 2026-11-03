# Use a very lightweight web server based on Alpine Linux
FROM nginx:alpine

# Copy the app files into the Nginx public folder
COPY index.html /usr/share/nginx/html/
COPY script.js /usr/share/nginx/html/

# Expose the standard HTTP port
EXPOSE 80
