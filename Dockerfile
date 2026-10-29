# Usiamo un web server leggerissimo basato su Alpine Linux
FROM nginx:alpine

# Copiamo i file dell'app nella cartella pubblica di Nginx
COPY index.html /usr/share/nginx/html/
COPY script.js /usr/share/nginx/html/

# Esponiamo la porta standard HTTP
EXPOSE 80
