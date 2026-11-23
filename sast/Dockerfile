# Analysis (SAST) Lambda image. Build from the sast/ folder:
#   docker buildx build --platform linux/amd64 --provenance=false --load -t analysis .
FROM public.ecr.aws/lambda/nodejs:24

COPY backend/package*.json ${LAMBDA_TASK_ROOT}/
RUN npm ci --omit=dev

COPY backend/handler.js backend/scanner.js backend/jobStore.js backend/storage.js backend/archive.js backend/report.js backend/errors.js ${LAMBDA_TASK_ROOT}/

CMD ["handler.handler"]