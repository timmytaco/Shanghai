FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

# Parse package.json vs strict installation since node_modules might not exist
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
