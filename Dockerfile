# apify/actor-node-playwright-chrome includes Chromium + all browser deps pre-installed.
# Runs as non-root "myuser" — use --chown to avoid permission errors on npm install.
# See: https://docs.apify.com/sdk/js/docs/guides/docker-images
FROM apify/actor-node-playwright-chrome:20

# Copy package files with correct ownership for the non-root user
COPY --chown=myuser:myuser package*.json ./

# Install all deps (including devDeps for TypeScript compile)
RUN npm --quiet set progress=false \
    && npm install \
    && echo "Installed NPM version:" \
    && npm --version

# Copy the rest of the source with correct ownership
COPY --chown=myuser:myuser . ./

# Compile TypeScript → JavaScript
RUN npm run build

# Remove dev dependencies to keep the final image lean
RUN npm prune --omit=dev

# Run the Actor
CMD npm start
