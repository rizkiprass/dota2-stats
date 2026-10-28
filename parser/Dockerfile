# syntax=docker/dockerfile:1

#############################################
# Stage 1: build the odota/parser Java jar  #
#############################################
FROM maven:3.9.9-eclipse-temurin-21-noble AS java-build

# Pin to a specific upstream commit for reproducible builds.
# Bump PARSER_REF when you intentionally want to pick up new parser/clarity
# logic (e.g. support for a newer Dota replay format). Verify the new jar
# against a real replay locally before pushing, see the README build steps.
ARG PARSER_REPO=https://github.com/odota/parser.git
ARG PARSER_REF=ac6e79c6d7d227f0ee68a98164d2cb4f6a47c45d

WORKDIR /build

# Fetch the pinned commit explicitly. `git clone --branch` only accepts branch
# or tag names, and building from a moving branch like `master` lets Docker
# reuse a stale cached layer, silently shipping an old jar. Fetching by SHA
# keeps the layer reproducible and invalidates the cache when PARSER_REF changes.
RUN git init parser \
    && cd parser \
    && git remote add origin ${PARSER_REPO} \
    && git fetch --depth 1 origin ${PARSER_REF} \
    && git checkout FETCH_HEAD

# Add our thin file-based CLI wrapper (see parser/java/FileParse.java) so we
# can invoke the parser against a local file without running the upstream
# HTTP server (opendota.Main / port 5600).
COPY java/FileParse.java /build/parser/src/main/java/opendota/FileParse.java
COPY java/ParseLobbyType.patch /tmp/ParseLobbyType.patch
RUN git -C /build/parser apply /tmp/ParseLobbyType.patch

WORKDIR /build/parser
RUN mvn -q -DskipTests clean package

##########################################
# Stage 2: Lambda runtime (Python + JRE)  #
##########################################
FROM public.ecr.aws/lambda/python:3.12

# Amazon Corretto JRE 21, installed from Amazon Linux 2023 (AL2023) repos
# that ship with the Lambda Python 3.12 base image.
RUN dnf install -y java-21-amazon-corretto-headless && dnf clean all

ENV PARSER_JAR=/opt/parser/parser.jar
RUN mkdir -p /opt/parser
COPY --from=java-build /build/parser/target/*.jar ${PARSER_JAR}

COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY handler.py normalize.py item_ids.py ${LAMBDA_TASK_ROOT}/

CMD ["handler.lambda_handler"]
