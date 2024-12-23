FROM node:18-alpine

WORKDIR /app

RUN mkdir -p logs

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

CMD ["npm", "start"]