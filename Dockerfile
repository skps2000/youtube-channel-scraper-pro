# Apify actor-node-playwright-chrome includes Chromium, Node.js, and all browser deps.
# See: https://docs.apify.com/sdk/js/docs/upgrading/upgrading-to-v3#dockerfile
FROM apify/actor-node-playwright-chrome:20

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Install production + dev deps (need TypeScript for compile step)
RUN npm --quiet set progress=false \
    && npm install \
    && echo "Installed NPM version:" \
    && npm --version

# Copy the rest of the source code
COPY . ./

# Compile TypeScript to JavaScript
RUN npm run build

# Prune dev dependencies after build to keep image lean
RUN npm prune --production

# Run the Actor
CMD npm start
