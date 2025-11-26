# Specify the base Docker image
FROM apify/actor-node:20

# Copy package files first (cache optimization)
COPY package*.json ./

# Install dependencies (only production for speed, but we need dev for build step)
RUN npm install

# Copy source code
COPY . ./

# Build TypeScript to JavaScript
RUN npm run build

# Run the compiled code
CMD ["npm", "run", "start:prod"]