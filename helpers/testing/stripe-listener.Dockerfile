FROM stripe/stripe-cli:v1.41.1@sha256:f1e91acd11134c1589c13f35b315f648e274a19074d9bfd2c2a5e39552eef620

COPY --chmod=0555 helpers/testing/stripe-listen-docker.sh /usr/local/bin/stripe-listen-docker
