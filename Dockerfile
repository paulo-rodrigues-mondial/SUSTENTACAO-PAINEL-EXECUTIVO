# Dockerfile do Painel Executivo da Sustentação Mondial (Nginx estático — mesmo padrão do GMUD)
FROM nginx:alpine

RUN rm -rf /etc/nginx/conf.d/*

# A base (data/) nunca vai para o cache: quem recarrega vê a versão publicada
RUN printf 'server {\n\
    listen 80;\n\
    server_name localhost;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location /data/ {\n\
        add_header Cache-Control "no-store";\n\
    }\n\
    location /entrada/ {\n\
        deny all;\n\
    }\n\
    location /tools/ {\n\
        deny all;\n\
    }\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    gzip on;\n\
    gzip_types text/plain text/css application/javascript application/json;\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY . /usr/share/nginx/html
RUN rm -rf /usr/share/nginx/html/entrada/*.xlsx /usr/share/nginx/html/entrada/*.csv

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
