# SAST (static analysis) Lambda function, log group and async invocation settings.
#
# The function is created only when analysis_image_digest is set, because Lambda
# needs the image to already exist in ECR. Order: apply shared, push the image,
# then apply apps.

locals {
  analysis_function_name = "cloud-project-analysis"
  analysis_enabled       = var.analysis_image_digest != null
}

data "aws_ecr_repository" "analysis" {
  count = local.analysis_enabled ? 1 : 0
  name  = "cloud-project-analysis"
}

# Seven-day log group, created before the function so Lambda does not make its own.
resource "aws_cloudwatch_log_group" "analysis" {
  name              = "/aws/lambda/${local.analysis_function_name}"
  retention_in_days = 7
}

resource "aws_lambda_function" "analysis" {
  count = local.analysis_enabled ? 1 : 0

  function_name = local.analysis_function_name
  # Learner Lab cannot create IAM roles; LabRole covers DynamoDB, S3 and logs.
  role          = data.aws_iam_role.lab_role.arn
  package_type  = "Image"
  image_uri     = "${data.aws_ecr_repository.analysis[0].repository_url}@${var.analysis_image_digest}"
  architectures = ["x86_64"]

  timeout     = 60
  memory_size = 512

  environment {
    variables = {
      JOBS_TABLE_NAME       = data.aws_dynamodb_table.jobs.name
      ARTIFACTS_BUCKET_NAME = local.artifacts_bucket_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.analysis]
}

# Async invoke from the Job API: no automatic retries, drop events older than 5 minutes.
resource "aws_lambda_function_event_invoke_config" "analysis" {
  count = local.analysis_enabled ? 1 : 0

  function_name                = aws_lambda_function.analysis[0].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 300
}