# apify/actor-node-playwright-chrome includes Chromium pre-installed.
# NOTE: This image sets NODE_ENV=production by default, so we must explicitly
# install devDependencies (TypeScript) needed for the build step.
# See: https://docs.apify.com/sdk/js/docs/guides/docker-images
FROM apify/actor-node-playwright-chrome:20

# Copy package files with correct ownership for the non-root "myuser"
COPY --chown=myuser:myuser package*.json ./

# Install ALL dependencies (including devDeps like TypeScript) for the build step
RUN npm --quiet set progress=false \
    && npm install --include=dev \
    && echo "Installed NPM version:" \
    && npm --version

# Copy the rest of the source
COPY --chown=myuser:myuser . ./

# Compile TypeScript → dist/
RUN npm run build

# Prune dev dependencies (TypeScript etc.) to keep the final image lean
RUN npm prune --omit=dev

# Run the Actor
CMD npm start
