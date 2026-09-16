FROM stripe/stripe-cli:v1.50.11@sha256:a2c30b01ff6b1f1de61819e98eef8f70c52e950f8103bd3fa4000d19e91d1824

COPY --chmod=0555 helpers/testing/stripe-listen-docker.sh /usr/local/bin/stripe-listen-docker
