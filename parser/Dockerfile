# syntax=docker/dockerfile:1

#############################################
# Stage 1: build the odota/parser Java jar  #
#############################################
FROM maven:3.9.9-eclipse-temurin-21-noble AS java-build

# Pin to a specific upstream commit for reproducible builds.
# Update this when you intentionally want to pick up new parser logic.
ARG PARSER_REPO=https://github.com/odota/parser.git
ARG PARSER_REF=master

WORKDIR /build

RUN git clone --depth 1 --branch ${PARSER_REF} ${PARSER_REPO} parser

# Add our thin file-based CLI wrapper (see parser/java/FileParse.java) so we
# can invoke the parser against a local file without running the upstream
# HTTP server (opendota.Main / port 5600).
COPY java/FileParse.java /build/parser/src/main/java/opendota/FileParse.java

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

COPY handler.py normalize.py ${LAMBDA_TASK_ROOT}/

CMD ["handler.lambda_handler"]
