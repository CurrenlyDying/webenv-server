# webenv-sandbox/Dockerfile
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Update base and install tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      # --- Base System ---
      bash \
      coreutils findutils procps \
      ca-certificates locales \
      less file \
      git \
      \
      # --- Editors ---
      nano \
      vim-tiny \
      micro \
      \
      # --- "Flex" CLI Tools ---
      bat \
      ripgrep \
      tree \
      jq \
      htop \
      tmux \
      lsof \
      \
      # --- Compilers & Runtimes ---
      build-essential \
      gdb strace \
      python3 python3-pip python3-venv \
      golang-go \
      nodejs npm \
      ruby-full \
      \
      # --- Archives & Text Utils ---
      man-db manpages-dev \
      patch \
      unzip zip tar xz-utils \
      grep gawk \
    && rm -rf /var/lib/apt/lists/*

# Optional: nicer prompt and some readline history settings
RUN echo 'PS1="webenv:\w\\$ "' >> /etc/bash.bashrc && \
    echo 'HISTCONTROL=ignoredups:erasedups' >> /etc/bash.bashrc && \
    echo 'PROMPT_COMMAND="history -a; history -n; $PROMPT_COMMAND"' >> /etc/bash.bashrc

# Default workdir (will get tmpfs-mounted over at runtime, but /root exists)
WORKDIR /root

# The CMD doesn't matter much because you exec /bin/bash from the host,
# but it's nice to have something harmless as default.
CMD ["sleep", "infinity"]
