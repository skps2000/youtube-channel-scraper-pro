# Specify the base Docker image. You can read more about
# the available images at https://docs.apify.com/sdk/js/docs/upgrading/upgrading-to-v3#dockerfile
FROM apify/actor-node:20

# Copy just package.json and package-lock.json
# to speed up the build using Docker layer cache.
COPY package*.json ./

# Install NPM packages, skip optional and development dependencies to
# keep the image small. Avoid logging too much and print the installed
# version of NPM.
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM version:" \
    && npm --version \
    && rm -r ~/.npm

# Next, copy the remaining files and directories with the source code.
# Since we do this after NPM install, quick build will be really fast
# for most source file changes.
COPY . ./

# Install typescript to compile the code
RUN npm install -g typescript

# Compile TypeScript
RUN tsc

# Run the image
CMD npm start
