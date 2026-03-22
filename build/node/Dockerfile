FROM node:20-bullseye-slim as cli

WORKDIR /usr/src/app

# Enable Corepack and install Yarn v4
RUN corepack enable && corepack prepare yarn@4.4.1 --activate

# Install necessary system packages
# We group these together to minimize Docker layers and clean up properly
RUN apt-get update && apt-get install -y \
    gettext-base \
    git \
    libsqlite3-dev \
    python3 \
    pip \
    cmake \
    g++ \
    vim \
    curl \
    locales \
    sudo \
    apt-transport-https \
    ca-certificates \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Install mkdocs
RUN pip install "mkdocs-techdocs-core==1.*"

# Install Docker CLI with proper cleanup
RUN curl -fsSL https://get.docker.com -o get-docker.sh && \
    sh get-docker.sh && \
    apt-get install -y docker-ce-cli && \
    rm -f get-docker.sh && \
    rm -rf /var/lib/apt/lists/*

# Set up environment variables and locale
ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8

# Configure locale first
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen

ARG USERNAME=node
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Set up sudo access for node user
RUN echo "node ALL=(root) NOPASSWD: /usr/bin/chown, /usr/bin/chmod" > /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

# Add node user to docker group
RUN usermod -aG docker node

# Set up oh-my-bash for node user - using a more reliable installation method
RUN mkdir -p /home/node/.oh-my-bash && \
    git clone https://github.com/ohmybash/oh-my-bash.git /home/node/.oh-my-bash && \
    cp /home/node/.oh-my-bash/templates/bashrc.osh-template /home/node/.bashrc && \
    chown -R node:node /home/node/.oh-my-bash /home/node/.bashrc

# Set custom aliases
RUN echo "alias dc=docker compose" >> /etc/bash.bashrc

# Grant passwordless sudo access for a broader range of commands
RUN echo "node ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers.d/node \
    && chmod 0440 /etc/sudoers.d/node

# Create cache directories
RUN mkdir -p /home/$USERNAME/.cache \
    /home/$USERNAME/.npm && \
    chown -R $USERNAME:$USERNAME \
        /home/$USERNAME/.cache \
        /home/$USERNAME/.npm

# Set custom history file location
ENV HISTFILE=/home/node/.bash_history

# Install TechDocs CLI globally
RUN npm install -g @techdocs/cli

# Switch to non-root user
USER $USERNAME

# Set the working directory
WORKDIR /workspace

FROM node:20-bullseye-slim as run

# Enable Corepack and install Yarn v4 in the run stage
RUN corepack enable && corepack prepare yarn@4.4.1 --activate

ARG USERNAME=node
WORKDIR /usr/src/app

RUN mkdir -p node_modules \
    && chown -R $USERNAME:$USERNAME node_modules

COPY build/node/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3300 7707

ENTRYPOINT ["/entrypoint.sh"]
CMD ["yarn", "dev"]
